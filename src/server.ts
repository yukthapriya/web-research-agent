import { Agent, getAgentByName } from "agents";
import type {
  Env,
  ResearchRecord,
  ResearchSummary,
  ResearchPatch,
  ResearchStatus,
  Source,
  TrailStep,
} from "./types";

// The Workflow class must be exported from the Worker's main entry point.
export { ResearchWorkflow } from "./workflow";

interface AgentState {
  researchCount: number;
}

interface RawRow {
  id: string;
  query: string;
  status: string;
  phase: string;
  plan: string;
  steps: string;
  sources: string;
  report: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord(row: RawRow): ResearchRecord {
  return {
    id: row.id,
    query: row.query,
    status: row.status as ResearchStatus,
    phase: row.phase,
    plan: safeParse<string[]>(row.plan, []),
    steps: safeParse<TrailStep[]>(row.steps, []),
    sources: safeParse<Source[]>(row.sources, []),
    report: row.report,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * One Durable Object per browser session. It is the unit of memory: every
 * research run for a session is stored in this object's embedded SQLite, so
 * history survives restarts and is isolated per session. It also launches the
 * research Workflow and receives progress updates back from it.
 */
export class ResearchAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { researchCount: 0 };

  async onStart(): Promise<void> {
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS researches (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT '[]',
        steps TEXT NOT NULL DEFAULT '[]',
        sources TEXT NOT NULL DEFAULT '[]',
        report TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
  }

  /** Create a research record and start the Workflow that fills it in. */
  async startResearch(sessionId: string, query: string): Promise<{ id: string }> {
    this.ensureSchema();
    const trimmed = query.trim();
    const id = crypto.randomUUID();
    const now = Date.now();
    const steps: TrailStep[] = [{ label: "Queued", status: "done", at: now }];

    this.sql`
      INSERT INTO researches
        (id, query, status, phase, plan, steps, sources, report, error, created_at, updated_at)
      VALUES
        (${id}, ${trimmed}, 'queued', 'Queued', '[]', ${JSON.stringify(steps)}, '[]', '', NULL, ${now}, ${now})
    `;

    this.setState({ researchCount: this.state.researchCount + 1 });

    await this.env.RESEARCH_WORKFLOW.create({
      id,
      params: { sessionId, researchId: id, query: trimmed },
    });

    return { id };
  }

  /** Return one research record, with JSON columns parsed. */
  async getResearch(id: string): Promise<ResearchRecord | null> {
    this.ensureSchema();
    const rows = this.sql`SELECT * FROM researches WHERE id = ${id}` as unknown as RawRow[];
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  /** List recent research runs for the history sidebar. */
  async listResearches(): Promise<ResearchSummary[]> {
    this.ensureSchema();
    const rows = this.sql`
      SELECT id, query, status, created_at FROM researches
      ORDER BY created_at DESC LIMIT 50
    ` as unknown as Array<Pick<RawRow, "id" | "query" | "status" | "created_at">>;
    return rows.map((r) => ({
      id: r.id,
      query: r.query,
      status: r.status as ResearchStatus,
      createdAt: r.created_at,
    }));
  }

  /** Merge a progress update into a record. Called by the Workflow via RPC. */
  async patchResearch(id: string, patch: ResearchPatch): Promise<boolean> {
    this.ensureSchema();
    const rows = this.sql`SELECT * FROM researches WHERE id = ${id}` as unknown as RawRow[];
    const row = rows[0];
    if (!row) return false;

    const status = patch.status ?? (row.status as ResearchStatus);
    const phase = patch.phase ?? row.phase;
    const plan = patch.plan ?? safeParse<string[]>(row.plan, []);
    const sources = patch.sources ?? safeParse<Source[]>(row.sources, []);
    const report = patch.report ?? row.report;
    const error = patch.error ?? row.error ?? null;

    const steps = safeParse<TrailStep[]>(row.steps, []);
    if (patch.appendStep) steps.push({ ...patch.appendStep, at: Date.now() });

    this.sql`
      UPDATE researches SET
        status = ${status},
        phase = ${phase},
        plan = ${JSON.stringify(plan)},
        steps = ${JSON.stringify(steps)},
        sources = ${JSON.stringify(sources)},
        report = ${report},
        error = ${error},
        updated_at = ${Date.now()}
      WHERE id = ${id}
    `;
    return true;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  // Start a research run.
  if (path === "/api/research" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      query?: string;
    };
    const sessionId = (body.sessionId ?? "").trim();
    const query = (body.query ?? "").trim();
    if (!sessionId) return json({ error: "Missing sessionId" }, 400);
    if (query.length < 4) return json({ error: "Please enter a longer question." }, 400);

    const agent = await getAgentByName(env.ResearchAgent, sessionId);
    const { id } = await agent.startResearch(sessionId, query);
    return json({ id });
  }

  // Poll a single research run.
  if (path === "/api/research" && request.method === "GET") {
    const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!sessionId || !id) return json({ error: "Missing sessionId or id" }, 400);

    const agent = await getAgentByName(env.ResearchAgent, sessionId);
    const record = await agent.getResearch(id);
    if (!record) return json({ error: "Not found" }, 404);
    return json(record);
  }

  // List history for a session.
  if (path === "/api/history" && request.method === "GET") {
    const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
    if (!sessionId) return json({ error: "Missing sessionId" }, 400);

    const agent = await getAgentByName(env.ResearchAgent, sessionId);
    const items = await agent.listResearches();
    return json({ items });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        return json({ error: message }, 500);
      }
    }

    // Serve the static chat UI for everything else.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

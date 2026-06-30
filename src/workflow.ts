import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { Env, ResearchParams, ResearchPatch, SearchResult, Source } from "./types";
import { webSearch, dedupeSources } from "./search";
import { planResearch, synthesizeReport } from "./llm";

/** Write a progress update back into the session Agent (Durable Object). */
async function patch(
  env: Env,
  sessionId: string,
  researchId: string,
  update: ResearchPatch,
): Promise<boolean> {
  const agent = await getAgentByName(env.ResearchAgent, sessionId);
  return agent.patchResearch(researchId, update);
}

/**
 * Durable execution: each step.do() is checkpointed. If a later step fails
 * (e.g. a flaky search), only that step retries — completed steps are not
 * re-run, so we never repeat an LLM call or re-search a query we already have.
 */
export class ResearchWorkflow extends WorkflowEntrypoint<Env, ResearchParams> {
  async run(event: WorkflowEvent<ResearchParams>, step: WorkflowStep): Promise<void> {
    const { sessionId, researchId, query } = event.payload;
    const env = this.env;

    try {
      await step.do("note: start", () =>
        patch(env, sessionId, researchId, {
          status: "running",
          phase: "Understanding the question",
          appendStep: { label: "Understanding your question", status: "done" },
        }),
      );

      // 1) Plan: break the question into focused search queries.
      const subQueries = await step.do("plan research", () => planResearch(env, query));
      await step.do("note: plan", () =>
        patch(env, sessionId, researchId, {
          phase: `Searching the web · ${subQueries.length} queries`,
          plan: subQueries,
          appendStep: {
            label: `Planned ${subQueries.length} search ${subQueries.length === 1 ? "query" : "queries"}`,
            status: "done",
            detail: subQueries.join("  ·  "),
          },
        }),
      );

      // 2) Search: each sub-query is its own retryable step.
      const collected: SearchResult[] = [];
      for (let i = 0; i < subQueries.length; i++) {
        const sq = subQueries[i];
        let results: SearchResult[] = [];
        try {
          results = await step.do(
            `search ${i + 1}`,
            {
              retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
              timeout: "30 seconds",
            },
            () => webSearch(env, sq, 4),
          );
        } catch {
          // Retries exhausted for this query — continue with whatever else we find.
          results = [];
        }
        await step.do(`note: search ${i + 1}`, () =>
          patch(env, sessionId, researchId, {
            appendStep: {
              label: `Searched "${sq}"`,
              status: results.length ? "done" : "warn",
              detail: `${results.length} source${results.length === 1 ? "" : "s"}`,
            },
          }),
        );
        collected.push(...results);
      }

      const sources = dedupeSources(collected).slice(0, 10);

      await step.do("note: synthesize", () =>
        patch(env, sessionId, researchId, {
          phase: sources.length ? "Synthesizing findings" : "Synthesizing (no live results)",
          appendStep: sources.length
            ? { label: `Reading ${sources.length} sources`, status: "done" }
            : { label: "No web results — answering from model knowledge", status: "warn" },
        }),
      );

      // 3) Synthesize the cited report with Llama 3.3.
      const report = await step.do(
        "write report",
        { retries: { limit: 1, delay: "3 seconds", backoff: "constant" }, timeout: "2 minutes" },
        () => synthesizeReport(env, query, sources),
      );

      // 4) Persist the finished report to the Agent's memory.
      const sourceList: Source[] = sources.map((s) => ({ title: s.title, url: s.url }));
      await step.do("note: done", () =>
        patch(env, sessionId, researchId, {
          status: "complete",
          phase: "Report ready",
          report,
          sources: sourceList,
          appendStep: { label: "Report ready", status: "done" },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.do("note: error", () =>
        patch(env, sessionId, researchId, {
          status: "error",
          phase: "Something went wrong",
          error: message,
          appendStep: { label: "Research failed", status: "error", detail: message.slice(0, 160) },
        }),
      );
      // Intentionally not rethrowing: the failure is captured in app state and
      // surfaced in the UI, so the Workflow instance completes cleanly.
    }
  }
}

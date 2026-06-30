// Shared types for the research agent.
//
// `Env` is hand-written here so the project type-checks on a fresh clone.
// You can also generate it from wrangler.jsonc with `npm run cf-typegen`
// (which writes worker-configuration.d.ts) — the bindings below match.

import type { ResearchAgent } from "./server";

export type ResearchStatus = "queued" | "running" | "complete" | "error";
export type StepStatus = "done" | "active" | "warn" | "error";

/** One entry in the live "research trail" the UI renders. */
export interface TrailStep {
  label: string;
  status: StepStatus;
  detail?: string;
  at: number;
}

export interface Source {
  title: string;
  url: string;
}

/** A single web search hit, normalized across providers. */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/** The full record for one research run, stored in the Agent's SQLite. */
export interface ResearchRecord {
  id: string;
  query: string;
  status: ResearchStatus;
  phase: string;
  plan: string[];
  steps: TrailStep[];
  sources: Source[];
  report: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Lightweight row for the history sidebar. */
export interface ResearchSummary {
  id: string;
  query: string;
  status: ResearchStatus;
  createdAt: number;
}

/** Partial update applied by the Workflow as it makes progress. */
export interface ResearchPatch {
  status?: ResearchStatus;
  phase?: string;
  plan?: string[];
  sources?: Source[];
  report?: string;
  error?: string;
  appendStep?: Omit<TrailStep, "at">;
}

/** Payload passed from the Agent into the Workflow. */
export interface ResearchParams {
  sessionId: string;
  researchId: string;
  query: string;
}

export interface Env {
  /** Workers AI binding (Llama 3.3). */
  AI: Ai;
  /** Static assets (the chat UI in /public). */
  ASSETS: Fetcher;
  /** Per-session Agent (Durable Object) that stores research history. */
  ResearchAgent: DurableObjectNamespace<ResearchAgent>;
  /** The durable research pipeline. */
  RESEARCH_WORKFLOW: Workflow<ResearchParams>;
  /** Tavily web-search key. Optional: the agent degrades gracefully without it. */
  TAVILY_API_KEY?: string;
}

/** The Workers AI model used for planning + synthesis. */
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

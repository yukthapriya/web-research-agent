import type { Env, SearchResult } from "./types";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

/**
 * Search the web via Tavily (https://tavily.com), an API built for AI agents
 * that returns clean, LLM-ready snippets instead of raw HTML.
 *
 * Returns an empty array when no TAVILY_API_KEY is configured so the rest of
 * the pipeline can still run (the synthesis step falls back to the model's
 * own knowledge with a clear disclaimer).
 *
 * Throws on a failed HTTP response so the calling Workflow step can retry.
 */
export async function webSearch(
  env: Env,
  query: string,
  maxResults = 4,
): Promise<SearchResult[]> {
  if (!env.TAVILY_API_KEY) return [];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query: query.slice(0, 380),
      max_results: maxResults,
      search_depth: "basic",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  return (data.results ?? [])
    .filter((r): r is Required<TavilyResult> => Boolean(r.url && r.title))
    .map((r) => ({
      title: r.title.trim(),
      url: r.url,
      content: (r.content ?? "").trim(),
    }));
}

/** Drop duplicate URLs while preserving order. */
export function dedupeSources(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

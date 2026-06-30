import { MODEL, type Env, type SearchResult } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Coerce whatever Workers AI returns into a plain string. The documented shape
 * is `{ response: string }`, but depending on the model/runtime `response` can
 * come back nested, OpenAI-style, or as a non-string — so we never assume and
 * never call string methods on an object.
 */
function extractText(out: unknown): string {
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out !== "object") return String(out);

  const o = out as Record<string, unknown>;

  // Standard Workers AI shape: { response: "..." }
  if (typeof o.response === "string") return o.response;

  // Nested: { response: { response | content | text: "..." } }
  if (o.response && typeof o.response === "object") {
    const r = o.response as Record<string, unknown>;
    if (typeof r.response === "string") return r.response;
    if (typeof r.content === "string") return r.content;
    if (typeof r.text === "string") return r.text;
  }

  // OpenAI-compatible shape: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(o.choices) && o.choices.length > 0) {
    const msg = (o.choices[0] as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    if (msg && typeof msg.content === "string") return msg.content;
  }

  // Other occasional keys.
  if (typeof o.output === "string") return o.output;
  if (typeof o.result === "string") return o.result;
  if (typeof o.text === "string") return o.text;

  // Last resort: a non-string `response` (object/array) — serialize it so the
  // pipeline still receives usable text instead of crashing.
  if (o.response != null) {
    try {
      return JSON.stringify(o.response);
    } catch {
      return "";
    }
  }
  return "";
}

/** Run Llama 3.3 on Workers AI and return the text response. */
async function runLlama(
  env: Env,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const out = await env.AI.run(MODEL, {
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.4,
  });
  return extractText(out).trim();
}

/**
 * Turn a research question into 3–4 focused web-search queries.
 * Parsing is defensive: the model is asked for JSON, but we recover from
 * fenced code blocks, stray prose, or bullet lists.
 */
export async function planResearch(env: Env, question: string): Promise<string[]> {
  const text = await runLlama(
    env,
    [
      {
        role: "system",
        content:
          "You are a research planning assistant. Break the user's question into 3 to 4 focused, " +
          "standalone web-search queries that together cover the question from complementary angles. " +
          'Reply with ONLY a JSON array of strings, for example: ["first query", "second query"]. ' +
          "No explanation, no markdown, no surrounding text.",
      },
      { role: "user", content: question },
    ],
    { maxTokens: 400, temperature: 0.3 },
  );

  return parseQueries(text, question);
}

function parseQueries(text: string, fallback: string): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const v: unknown = JSON.parse(s);
      if (Array.isArray(v)) {
        const arr = v.map((x) => String(x).trim()).filter((x) => x.length > 0);
        return arr.length ? arr : null;
      }
    } catch {
      /* fall through */
    }
    return null;
  };

  let queries = tryParse(text);
  if (!queries) {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) queries = tryParse(match[0]);
  }
  if (!queries) {
    queries = text
      .split(/\n+/)
      .map((line) => line.replace(/^[\s\-*\d.)"']+/, "").replace(/["',]+$/, "").trim())
      .filter((line) => line.length > 3);
  }
  if (!queries || queries.length === 0) queries = [fallback];
  return queries.slice(0, 4);
}

/**
 * Synthesize a markdown report from the collected sources, citing them as
 * [1], [2], … referencing the numbered list. Falls back to model knowledge
 * (with a disclaimer) when no live sources were retrieved.
 */
export async function synthesizeReport(
  env: Env,
  question: string,
  sources: SearchResult[],
): Promise<string> {
  if (sources.length === 0) {
    return runLlama(
      env,
      [
        {
          role: "system",
          content:
            "You are a research analyst. You could not reach live web sources for this question, " +
            "so answer from your own knowledge. Begin with a short italicized note that the answer " +
            "is based on training data and may be out of date, then give a clear, well-structured " +
            "markdown answer with headings where useful. Do not invent citations or URLs.",
        },
        { role: "user", content: question },
      ],
      { maxTokens: 1600, temperature: 0.4 },
    );
  }

  const context = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content.slice(0, 900)}`)
    .join("\n\n");

  return runLlama(
    env,
    [
      {
        role: "system",
        content:
          "You are a research analyst. Using ONLY the numbered sources provided, write a clear, " +
          "well-structured markdown report that answers the user's question. Open with a 1–2 sentence " +
          "summary, then use short sections with headings. Cite every claim inline with bracketed " +
          "numbers like [1] or [2, 3] that refer to the numbered sources. Do not invent facts or URLs, " +
          "and do not add a sources list yourself (the app renders one). If the sources disagree or are " +
          "insufficient, say so plainly.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nSources:\n${context}`,
      },
    ],
    { maxTokens: 2000, temperature: 0.4 },
  );
}

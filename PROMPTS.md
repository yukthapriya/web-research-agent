# Prompt history

The assignment allows AI‑assisted coding and asks for the prompt history. This
project was built in a single session with **Claude (Anthropic)**. This file is a
readable summary of how it was prompted and the decisions that came out of it.

> **To submit the complete history:** export this Claude conversation (the share /
> export option in the Claude app) and include the transcript alongside this file.
> The summary below is the short version; the transcript is the full record.

## The brief I gave the assistant

I pasted the assignment ("build an AI‑powered application on Cloudflare" with four
required components — an LLM, a workflow/coordination layer, user input via chat or
voice, and memory/state — Llama 3.3 on Workers AI recommended) and asked it to pick
the strongest project idea and build the whole repo.

## Key decisions (from the conversation)

1. **Idea: a web research agent.** Chosen because it exercises all four required
   components naturally and shows off Workflows: plan → search the web → synthesize
   a cited report.
2. **Verify the APIs first.** I had the assistant look up the *current* Cloudflare
   docs before writing code: the Workers AI model id
   (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), the Agents SDK (`Agent`,
   `getAgentByName`, SQLite via `this.sql`, wrangler migrations), the Workflows API
   (`WorkflowEntrypoint`, `step.do`, `env.WORKFLOW.create`), and the Tavily search
   endpoint.
3. **Architecture for robustness.** A Durable Object (Agents SDK) per session holds
   memory and launches a Workflow; the Workflow writes progress back to the Agent
   via RPC; the frontend is dependency‑free and polls over HTTP. No decorators, no
   client‑side framework, so there's little to break on a fresh clone.
4. **Graceful degradation.** If `TAVILY_API_KEY` isn't set, search returns nothing
   and the synthesis step answers from the model's own knowledge with a disclaimer,
   so the app runs end‑to‑end before any keys are added.
5. **Design.** A deliberate "reading room" UI (editorial serif report, mono process
   log, teal + ochre accents) with a live "research trail" as the signature element.
6. **Verification.** Dependencies were installed and the backend was type‑checked
   (`tsc --noEmit`) against the real packages before delivery.

## How to reproduce

The repo is the artifact of the prompts above. See `README.md` for setup and
deployment. To continue with AI assistance, point your assistant at `src/` and the
`README.md`; the code is commented to explain the Workers AI / Workflows / Agents
wiring.

# Prompt history

The assignment allows AI‑assisted coding and asks for the prompt history. This
project was built and deployed in a single session with **Claude (Anthropic)**.
This file is a readable summary of how I prompted it and the decisions that came
out of the conversation.

> **To submit the complete history:** export this Claude conversation (the share /
> export option in the Claude app) and include the transcript alongside this file.
> The summary below is the short version; the transcript is the full record.

## The brief I gave the assistant

> Build an AI-powered app on Cloudflare with four parts — an LLM (Llama 3.3 on
> Workers AI is recommended), a workflow/coordination layer, user input via chat or
> voice, and some memory/state. AI-assisted coding is allowed as long as I keep my
> prompt history, and the final submission is a GitHub repo. Pick the strongest
> project idea for me and build the whole repo — Worker code, a chat frontend, and a
> README with deploy steps. Check the current Cloudflare docs before writing any
> code so it works against today's APIs.

## The prompts I used, in order

1. Gave the brief above — pick the strongest idea, build the whole repo, and verify
   the current Cloudflare docs first.
2. When it offered a few directions, told it to **pick the strongest one for me**
   rather than choosing myself — it chose a web research agent (plan → search →
   synthesize a cited report).
3. After it delivered the repo: **"how do I run this?"**
4. Asked how authentication works — whether I needed to create a Cloudflare API
   token, and what to do about the dashboard's "read‑only API token" prompt and the
   token‑permissions page I'd wandered into. (Answer: just `wrangler login`; ignore
   the token prompt — a read‑only token can't deploy anyway.)
5. Shared my terminal output where `wrangler login` succeeded but `wrangler dev` and
   `wrangler deploy` both failed with **"you need a workers.dev subdomain"**
   (error 10063), and asked how to fix it.
6. Worked through the dashboard with the assistant to find where the account‑level
   **workers.dev subdomain** is actually claimed — it's on the **Workers & Pages
   overview page (right‑hand side)**, not in the individual Worker's settings, which
   is where I kept landing.
7. Claimed the subdomain (`myukthapriya.workers.dev`) and re‑ran the deploy.
8. Shared the successful deploy output — live at
   `https://web-research-agent.myukthapriya.workers.dev` — and asked about adding the
   Tavily search key and pushing the repo to GitHub.
9. Asked the assistant to write this prompt‑history file.

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
7. **Deployment.** Deployed to my own Cloudflare account with `wrangler`. The only
   snag was a fresh account with no workers.dev subdomain yet (error 10063); once I
   claimed one on the Workers & Pages overview page, `npm run deploy` attached the
   public URL automatically.

## How to reproduce

The repo is the artifact of the prompts above. See `README.md` for setup and
deployment. To continue with AI assistance, point your assistant at `src/` and the
`README.md`; the code is commented to explain the Workers AI / Workflows / Agents
wiring.

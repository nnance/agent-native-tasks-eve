# EVE Framework — Research Notes

**Purpose:** Working notes from a review of the Vercel EVE Agent Framework docs ([eve.dev](https://eve.dev/docs/getting-started)), gathered as prep for implementation planning. Maps EVE's primitives onto our product spec ([product-spec.md](./product-spec.md)) and user stories ([user-stories.md](./user-stories.md)).

**Reviewed:** 2026-07-27. EVE is young and moving — re-verify against live docs before coding.

---

## 1. What EVE is

> "eve agents are TypeScript projects. You describe an agent with files under `agent/`, then eve runs it as a durable service."

- **File-based capability discovery:** the filesystem layout under `agent/` *is* the agent definition. `agent/tools/get_weather.ts` → tool `get_weather`. Same rule for skills, channels, connections, subagents, schedules.
- **Durable execution:** sessions are durable conversations; turns checkpoint at steps; interrupted steps re-execute, completed steps replay. Approval pauses park the run in storage (`session.waiting`) — not held in memory.
- **Requirements:** Node **24+**, packages `eve`, `ai`, `zod`. Model credential via Vercel AI Gateway (`AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN`) or a direct provider SDK + API key.

## 2. Minimal anatomy

```text
project/
├── next.config.ts        # wrapped with withEve()
├── app/                  # Next.js app (our UI)
├── agent/
│   ├── agent.ts          # defineAgent({ model: "anthropic/claude-opus-4.8", ... })
│   ├── instructions.md   # always-on system prompt
│   ├── tools/            # one file per tool
│   ├── channels/
│   │   └── eve.ts        # optional: override default HTTP channel (auth, CORS, hooks)
│   └── lib/              # shared code for agent files
└── evals/                # defineEval checks, run with `eve eval`
```

Adding EVE to an existing project: `npx eve@latest init .` — adds `eve`, `ai`, `zod` only, doesn't touch existing files. (Also fine to install manually and create `agent/` by hand.)

## 3. Next.js integration (`withEve`) — fits our repo directly

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {};
export default withEve(nextConfig);
```

- One dev server (`npm run dev` boots EVE alongside `next dev`), one Vercel deploy.
- Agent routes auto-mounted **same-origin** at `/eve/v1/*` — no CORS, no URL env vars.
- Default auth: `eveChannel({ auth: [vercelOidc(), localDev()] })` — localhost works in dev, prod needs real auth (or `none()` for public demos). Our v1 is single-user/no-auth, so this needs a deliberate choice at implementation time.

## 4. Tools — the agent half of our shared-action layer

```ts
// agent/tools/create_task.ts (illustrative)
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Create a task in a project.",
  inputSchema: z.object({ projectId: z.string(), title: z.string().min(1), /* ... */ }),
  async execute(input, ctx) {
    return createTask(input); // ← same shared action the API route calls
  },
});
```

Key facts:
- Tools run **in the app runtime** with full `process.env` — they can call our shared action functions / DB directly. This is exactly the architecture the spec demands: UI API routes and agent tools both delegate to one shared action module.
- `inputSchema` (Zod), optional `outputSchema`; return plain JSON.
- `toModelOutput()` can project a compact view to the model while channels get the full result — useful for keeping token use down on list-heavy results.
- **Idempotency matters:** interrupted steps re-execute on resume, so side effects should be safe to retry.

## 5. Human-in-the-loop — maps 1:1 to our confirm-destructive requirement

- `approval: always()` on a tool pauses durably for human sign-off; also `once()`, `never()`, or a **custom policy function** receiving `{ session, toolInput }` that returns `"user-approval"` / `"not-applicable"` / `"approved"` / `"denied"`.
- Spec mapping: delete tools get `always()`; a bulk-update tool can use a custom policy (e.g. require approval when `taskIds.length > 1`). This means confirmation is **enforced by the framework**, not by prompt-engineering the model — much stronger for US-F3/F4/F5.
- Built-in `ask_question` tool gives the same pause/resume for clarification questions.
- Protocol: `input.requested` stream event → run parks at `session.waiting` → client responds with `inputResponses: [{ requestId, optionId }]` → run resumes exactly where it paused. Unrelated follow-up text does *not* deny a pending approval; EVE holds it and replays it after the approval is answered.

## 6. Chat UI — `useEveAgent` replaces our current chat transport

```tsx
"use client";
import { useEveAgent } from "eve/react";

const agent = useEveAgent();
// agent.data.messages → messages with parts: text, reasoning, tool-call, tool-result, dynamic-tool, authorization
// agent.status → "ready" | "submitted" | "streaming" | "error"
// agent.send({ message }) / agent.stop() / agent.reset()
// agent.session → { sessionId, continuationToken, streamIndex }
```

- **Structured action entries (US-F6) come for free:** tool calls and results arrive as typed message parts — render `tool-call` / `tool-result` parts as activity entries in the chat.
- **Approval UI (US-F3/F4/F5):** pending approvals surface as a `dynamic-tool` part with `toolMetadata?.eve?.inputRequest` (`prompt`, `options`); respond via `agent.send({ inputResponses: [...] })`.
- **Persistence (US-F1):** persist `{ events, session }` via `onFinish(snapshot)` and rehydrate with `initialEvents` / `initialSession`. Docs demo localStorage; a server-side store is the more faithful read of our "survives restarts" requirement — implementation decision.
- `clientContext` / `prepareSend` can attach per-turn UI context (e.g., currently selected project) without polluting history.

## 7. Default HTTP channel (transport under the hook)

- Routes: `POST /eve/v1/session` (start), `POST /eve/v1/session/:id` (follow-up), `GET .../stream` (NDJSON events), `.../cancel`, plus `/health` and `/info`.
- `sessionId` + `continuationToken` = the resume handle for the one persistent conversation.
- Customizable via `agent/channels/eve.ts` (auth, CORS, `onMessage` context injection, event observers).

## 8. Live sync (US-G1/G2) — ours to build, but EVE helps

EVE does not sync our app data to the UI; the left pane needs its own refresh path. Two useful facts:

1. **Agent → UI:** every agent action streams into the browser as a `tool-result` event through `useEveAgent`. The client can invalidate/refetch task queries whenever an action event arrives (`onEvent`) — in a single-user app this alone largely satisfies "agent changes appear live."
2. **UI → agent:** trivial — tools read the DB at execution time, so the agent's next read is always fresh (US-G2).

A general transport (polling/SSE) can still back this up; decide in implementation planning.

## 9. Evals — validation harness for the agent user stories

EVE ships an eval framework: `defineEval` cases (single- and multi-turn) in `evals/`, assertions + LLM judge, run via `eve eval` against local dev or a deployment, CI-friendly reporters. **This is a natural home for validating Epic F/G acceptance criteria** (e.g., "delete without confirmation must not happen", "project-move requests are refused with an explanation").

## 10. Open decisions for implementation planning

1. **Conversation persistence store** — localStorage (docs pattern, simplest) vs. server-side persistence of `{ events, session }` (stronger read of the spec; survives browser data loss). Lean server-side or hybrid.
2. **Auth posture** — v1 is single-user/no-auth; dev is fine via `localDev()`, but any deployment needs an explicit choice (`none()` for demo vs. minimal token).
3. **Live-sync transport** — `onEvent`-driven refetch only, or add polling/SSE as a general mechanism (also covers multi-tab).
4. **Model + credential path** — AI Gateway vs. direct Anthropic provider; pick model (tutorial uses `anthropic/claude-opus-4.8`).
5. **Node 24** — verify local/deploy runtime meets EVE's floor.
6. **Tool grain** — one tool per capability in §5 of the spec vs. consolidated tools (e.g., one `update_task`); parity matrix suggests mirroring the capability list closely.

## 11. Doc index (for implementation-time deep dives)

Getting started: `/docs/getting-started`, `/docs/installation`, `/docs/project-structure`, `/docs/agent-config`, `/docs/instructions`
Core: `/docs/tools`, `/docs/human-in-the-loop`, `/docs/guides/state`, `/docs/guides/session-context`, `/docs/skills`
Concepts: `/docs/concepts/execution-model-and-durability`, `/docs/concepts/sessions-runs-and-streaming`, `/docs/concepts/default-harness`, `/docs/concepts/security-model`
Frontend: `/docs/guides/frontend/overview`, `/docs/guides/frontend/nextjs`, `/docs/channels/eve`, `/docs/channels/overview`, `/docs/guides/client/continuations`
Evals: `/docs/evals/overview`, `/docs/evals/cases`, `/docs/evals/assertions`, `/docs/evals/running`
Deploy: `/docs/guides/deployment/overview`, `/docs/guides/deployment/vercel`
Reference: `/docs/reference/cli`, `/docs/reference/project-layout`, `/docs/reference/typescript-api`
Full index: `https://eve.dev/llms.txt`, `https://eve.dev/sitemap.md`

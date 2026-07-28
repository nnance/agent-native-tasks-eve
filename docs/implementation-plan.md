# Implementation Plan — Agent-Native Task Manager

**Companion to:** [product-spec.md](./product-spec.md) · [user-stories.md](./user-stories.md) · [eve-framework-notes.md](./eve-framework-notes.md)
**Status:** Draft v1
**Last updated:** 2026-07-27

---

## 1. Settled decisions

| Decision | Choice |
|---|---|
| Database | Existing Postgres instance, connected via `DATABASE_URL` |
| Data layer | **Drizzle ORM** + drizzle-kit migrations |
| Model credential | **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`), model referenced as `anthropic/claude-opus-4.8` (or latest) |
| Chat persistence | **Server-side in Postgres** — EVE event log + session cursor stored in our DB |
| Agent framework | Vercel EVE, embedded in this Next.js app via `withEve()` |
| Tool grain | Tools mirror the spec §5 capability list ~1:1 (consolidated `update_*` per entity) |
| Live sync | `onEvent`-driven query invalidation from the EVE stream + refetch-on-focus (single-user, single-browser assumption; see §6) |
| Package manager | pnpm (already in use) |

Environment prerequisites (verified): Node 26 ✓ (EVE floor is 24), pnpm 11, Next 16.2.6, `ai` + `zod` already installed.

---

## 2. Architecture

### 2.1 The shared action layer (the whole point)

```
                    ┌────────────────────────────┐
                    │   lib/actions/* (shared)    │
                    │  one function per §5        │
                    │  capability; zod-validated; │
                    │  enforces all §7 rules      │
                    └──────┬──────────────┬──────┘
                           │              │
              ┌────────────┴───┐   ┌──────┴───────────┐
              │ app/api/*      │   │ agent/tools/*     │
              │ (route handlers│   │ (defineTool       │
              │  for the UI)   │   │  wrappers)        │
              └────────┬───────┘   └──────┬───────────┘
                       │                  │
              ┌────────┴───────┐   ┌──────┴───────────┐
              │  Left pane:    │   │  Right pane:      │
              │  Task UI       │   │  Chat (useEveAgent│
              └────────────────┘   └──────────────────┘
                           │              │
                    ┌──────┴──────────────┴──────┐
                    │      Postgres (Drizzle)     │
                    └────────────────────────────┘
```

The parity mechanism is concrete: **each capability is one Zod input schema + one action function.** The same schema object is imported by both the API route (request validation) and the EVE tool (`inputSchema`). The action function is the only place business rules live. Neither interface adds or removes capability — they only adapt transport.

- Actions throw typed, human-readable rule errors (e.g. `RuleViolation("Project 'Design' still has 4 tasks")`). API routes map them to 4xx JSON; tools return them as tool results so the model can relay and suggest alternatives (US-F3.4, US-F4.4).
- Rules enforced **only** in the action layer (single source): project immutability, per-project scoping, block-if-in-use, minimum-one status/priority, default-priority reassignment, exactly-one-default.
- Confirmation is deliberately *not* in the action layer — it is per-interface UX: dialogs in the UI, EVE approval gates for the agent (per spec §6/§9).

### 2.2 Data model (Drizzle schema)

| Table | Columns (essence) |
|---|---|
| `projects` | `id`, `name`, `created_at` |
| `statuses` | `id`, `project_id` FK, `name`, `order`, `is_completed` |
| `priorities` | `id`, `project_id` FK, `name`, `order`, `is_default` |
| `tasks` | `id`, `project_id` FK, `title`, `description`, `status_id` FK, `priority_id` FK, `created_at`, `updated_at` |
| `chat_state` | `id` (singleton row), `events` JSONB, `session` JSONB, `updated_at` |

Notes:
- `tasks.project_id` has **no update path** in the action layer (immutability). Belt-and-braces: a DB trigger or CHECK is optional; action-layer enforcement is the source of truth for v1.
- Cross-project scoping (task's status/priority must belong to task's project) is enforced in actions; composite FKs `(status_id, project_id)` are the optional hardening.
- `is_default`: exactly one per project, maintained by the action layer (set-default flips atomically in a transaction; delete-default reassigns to first-by-order).
- Seed (US-A1): idempotent seed script creates the "Personal" project + defaults **only when `projects` is empty**; runs via a `pnpm db:seed` script and an app-boot check.

### 2.3 API surface (UI transport)

REST-ish route handlers under `app/api/`, thin wrappers over actions:

```
GET/POST        /api/projects
PATCH/DELETE    /api/projects/[projectId]
GET/POST        /api/projects/[projectId]/statuses
PATCH/DELETE    /api/projects/[projectId]/statuses/[statusId]
GET/POST        /api/projects/[projectId]/priorities
PATCH/DELETE    /api/projects/[projectId]/priorities/[priorityId]
GET/POST        /api/tasks            (GET: ?project=&status=&priority=&q=&includeCompleted=)
GET/PATCH/DELETE /api/tasks/[taskId]
GET/PUT         /api/chat-state       (conversation snapshot persistence)
```

`PATCH /statuses/[id]` covers rename/reorder/toggle-completed; `PATCH /priorities/[id]` covers rename/reorder/set-default — mirroring the consolidated tools.

### 2.4 EVE agent

```
agent/
├── agent.ts             # defineAgent({ model: "anthropic/claude-opus-4.8" })
├── instructions.md      # persona + house rules (see below)
├── channels/eve.ts      # auth: [localDev()] for v1 dev; revisit at deploy
└── tools/               # one file per tool, all importing lib/actions + shared zod schemas
```

**Tool inventory** (name → action → approval):

| Tool | Action | Approval |
|---|---|---|
| `list_projects` | listProjects | `never()` |
| `create_project` | createProject | `never()` |
| `rename_project` | renameProject | `never()` |
| `delete_project` | deleteProject | `always()` |
| `list_tasks` | listTasks (filters + text search) | `never()` |
| `get_task` | getTask | `never()` |
| `create_task` | createTask | `never()` |
| `update_task` | updateTask (title/description/status/priority; also serves "move status") | `never()` |
| `delete_task` | deleteTask | `always()` |
| `bulk_update_tasks` | bulkUpdateTasks (move/edit many) | `always()` |
| `bulk_delete_tasks` | bulkDeleteTasks | `always()` |
| `list_statuses` / `list_priorities` | list* | `never()` |
| `create_status` / `create_priority` | create* | `never()` |
| `update_status` / `update_priority` | update* (rename/reorder/flag/default) | `never()` |
| `delete_status` / `delete_priority` | delete* | `always()` |

- Approval is **framework-enforced** (durable pause via `input.requested` → `inputResponses`), satisfying US-F3.3, US-F4.3, US-F5 without relying on prompt compliance. Bulk tools take an explicit array of task IDs, so "state exactly what will change" (US-F5.2) falls out of the approval prompt rendering the tool input.
- Single-task edits route through `update_task` (no approval); the model is instructed to use bulk tools whenever more than one task is affected — and because non-bulk tools take a single ID, multi-task work *cannot* silently bypass the approval gate.
- `toModelOutput` trims large list results (return counts + compact rows to the model; full rows to the channel).
- Idempotency: actions are safe to retry (create uses client-suppliable idempotent semantics where cheap; updates/deletes are naturally idempotent) per EVE's step-replay model.

**instructions.md** covers: persona (concise task assistant), always ground in tool reads before answering (US-F2), never invent tasks, prefer `bulk_*` for multi-task changes, explain rule violations and offer alternatives, summarize actions plainly after acting (US-F6.2).

### 2.5 Chat UI (right pane)

Rewire the existing shadcn chat kit from the scripted demo (`createChat` fake transport in `app/page.tsx`) to `useEveAgent` from `eve/react`:

- Keep: `MessageScroller*`, `Message`/`MessageAnimated`, `InputGroup`, `Card`, `Empty`, `Tooltip` components.
- Replace: `useChat` + canned transport → `useEveAgent()`; the read-only queued composer → a real text input; drop the demo dropdown items (attachments/deep-research).
- Render message parts:
  - `text` → prose bubbles (existing components)
  - `tool-call` / `tool-result` → **structured action entries** (US-F6): compact activity rows ("Created task *Fix header* in *Website*"), derived from tool name + input/result
  - `dynamic-tool` with `toolMetadata.eve.inputRequest` → **approval card** with the request prompt + Approve/Deny buttons responding via `agent.send({ inputResponses })` (US-F3/F4/F5)
- Persistence (US-F1): `useEveAgent({ initialEvents, initialSession, onFinish })` — `onFinish` PUTs `{ events, session }` to `/api/chat-state`; the page server-loads the snapshot and passes it in. Always persist the full `session` cursor (all three fields).

### 2.6 Split-screen shell (left pane + layout)

- `app/page.tsx` becomes the split-screen (spec §8.0): left = task UI, right = chat; both permanently visible; stack on narrow viewports.
- Left pane: task list (filter chips for project/status/priority, text search, sort per §8.1, "show completed" toggle), task create/edit forms, and a list-management surface (projects/statuses/priorities, per-project context) — shadcn components throughout, added via the shadcn CLI as needed (dialog, select, badge, checkbox, etc.).
- Data fetching: a light client-side query layer (TanStack Query) over the API routes — chosen for its invalidation primitives, which live sync leans on.

---

## 3. Live sync design (US-G1/G2/G3)

1. **Agent → UI:** every agent action streams to the browser through the chat connection. `useEveAgent({ onEvent })` watches for action/tool-result events and invalidates the relevant queries → left pane refetches within the same second. No extra infra.
2. **UI → agent:** automatic — tools read Postgres at execution time.
3. **Backstop:** refetch-on-window-focus + modest polling interval (e.g. 30s) covers edge cases (a second tab, missed events).
4. **Convergence (US-G3):** last-write-wins is the natural behavior of unconditioned row updates; no locking added. Verify with the G3 scenario during validation.

Scope note: "live" is scoped to the browser running the conversation — acceptable under the spec's single-user model; the polling backstop covers multi-tab.

---

## 4. Phased build plan

Each phase ends with its user stories demonstrably passing (they are the acceptance tests). Phases are sequential; a phase is "done" only when its exit criteria hold.

### Phase 0 — Foundations
**Read `node_modules/next/dist/docs/` first (per AGENTS.md — this Next.js version has breaking changes).**
- Add deps: `drizzle-orm`, `postgres`, `drizzle-kit`, `@tanstack/react-query`, `vitest`; `npx eve@latest init .` (adds `eve`; verify it plays well with pnpm — see Risks).
- `.env.local`: `DATABASE_URL`, `AI_GATEWAY_API_KEY`. `.env.example` checked in.
- Drizzle schema + initial migration + idempotent seed script.
- Wrap `next.config.ts` with `withEve()`; scaffold `agent/agent.ts` + `agent/instructions.md`; confirm `pnpm dev` boots Next + EVE and the dev TUI answers a hello.
- **Exit:** migrations apply to the existing Postgres; seed produces the Personal project exactly once (US-A1); EVE dev loop responds.

### Phase 1 — Shared action layer
- `lib/schemas/` — Zod input schemas per capability (the parity contract in code).
- `lib/actions/` — action functions enforcing every §7 rule; typed `RuleViolation` errors with human-readable messages.
- Vitest unit tests: every rule and default (immutability, scoping, block-if-in-use, min-one, default reassignment, creation defaults, seed idempotency).
- **Exit:** action tests green — this is the layer both interfaces will trust; rules never re-checked downstream.

### Phase 2 — API routes
- Route handlers per §2.3, thin: parse → validate with shared schema → call action → map result/RuleViolation to JSON.
- **Exit:** capability set exercisable end-to-end via curl against a seeded DB, including blocked-delete error bodies.

### Phase 3 — Task UI + list management (Epics B–E)
- Split-screen shell with a placeholder right pane.
- Task list with chips/filter/search/sort/completed-toggle; create/edit forms; quick status move; delete dialogs.
- List management for projects/statuses/priorities (per-project context).
- **Exit:** all Epic B, C, D, E acceptance criteria pass by hand against the running app.

### Phase 4 — EVE agent (Epic F backend half)
- Tools per §2.4 inventory, importing shared schemas + actions; approval policies; `instructions.md`; `toModelOutput` trimming.
- Validate in the EVE dev TUI: grounded answers, rule-violation relay, approval pauses for delete/bulk.
- **Exit:** every capability drivable from the dev TUI; deletes/bulk pause for approval there.

### Phase 5 — Chat UI rewire (Epic F frontend half)
- Replace demo transport with `useEveAgent`; real composer; part renderers (text, action entries, approval cards).
- Server-side conversation persistence via `/api/chat-state` (+ page-load rehydration).
- **Exit:** US-F1–F6 pass in the browser, including reload-and-continue ("move that one to Done").

### Phase 6 — Live sync + parity validation (Epic G)
- `onEvent` invalidation wiring + focus/poll backstop.
- EVE evals (`evals/`) for the high-value agent behaviors: refuses project moves with explanation, no delete without approval, bulk states its plan, grounded counts. Run via `eve eval` locally.
- Full **parity matrix walkthrough** (user-stories appendix): every row through both interfaces; record results in the doc.
- **Exit:** US-G1–G4 pass; parity matrix fully checked; evals green.

### Phase 7 — Hardening & handoff
- `/verify`-style end-to-end pass on the running app; fix fallout.
- README: setup (env vars, migrate, seed, dev), architecture overview pointing to docs/, how to run evals.
- Deploy posture documented (Vercel + `withEve` build outputs; auth decision deferred until a deploy is actually wanted).
- **Exit:** clean clone → running app in ≤5 commands; docs accurate.

---

## 5. Testing strategy

| Layer | Mechanism | Validates |
|---|---|---|
| Actions | Vitest unit tests | Every §7 rule, defaults, seed idempotency (the rules are tested once, here) |
| API | Handful of route tests (or curl scripts) | Transport mapping, error bodies |
| Agent | EVE evals (`defineEval`, `eve eval`) | Epic F behaviors: grounding, refusals, approval gating, bulk plans |
| Whole app | Manual parity-matrix walkthrough + US acceptance criteria | Epics A–G, US-G4 capstone |

---

## 6. Risks & watch-outs

1. **Next.js 16.2 breaking changes** — AGENTS.md mandates reading `node_modules/next/dist/docs/` before writing code; route handlers, config, and caching semantics may differ from training data. Do this at Phase 0, not later.
2. **EVE is young and evolving** — re-verify API shapes against live docs (`eve.dev/llms.txt`) at Phase 0/4; the notes doc records what was true on 2026-07-27.
3. **`eve init` + pnpm** — scaffolder docs assume npm; if `npx eve@latest init .` misbehaves in a pnpm workspace, fall back to manual install (`pnpm add eve@latest`) + hand-created `agent/` (documented manual path exists).
4. **`ai` SDK version coupling** — repo has `ai@^7`; confirm EVE's peer range matches, resolve if not.
5. **Chat-state write contention** — `onFinish` snapshots the whole event log; fine at v1 scale (single user, one conversation). Revisit if the log grows large (store deltas or rely on EVE server-side session replay via `continuationToken` + `initialEvents` trimming).
6. **Approval UX fidelity** — the approval card must render tool inputs legibly (which tasks, what change) to honor US-F5.2; budget real design time for it, it *is* the safety UX.
7. **Vercel AI Gateway credential** — needs `AI_GATEWAY_API_KEY` provisioned before Phase 4 agent testing (Phase 0 hello-world will surface this early).

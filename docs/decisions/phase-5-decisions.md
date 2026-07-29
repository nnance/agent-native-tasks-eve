# Phase 5 — Chat UI rewire (Epic F frontend half): decisions and assumptions

**Phase:** 5 — Chat UI rewire, Epic F frontend half
**Date:** 2026-07-28
**Branch:** `phase-5-chat-ui-rewire-epic-f-frontend-half`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 4 gave the shared action layer a tool interface. This phase gives that
agent a face: the right half of the split screen becomes a real
`useEveAgent` conversation with structured action entries, approval cards, and
server-side persistence. Nothing under `lib/actions/`, `lib/schemas/`,
`lib/domain/`, `lib/api/`, `app/api/` or `agent/` changed — Phase 5 is
presentation over an interface that already existed.

Same two conventions as the Phase 0–4 records: a decision taken **at design
time** was settled before code was written; a decision taken **at build time**
was forced by something only discoverable once the code ran or the browser was
driven.

---

## Framework pre-read (AGENTS.md mandate)

**Next.js 16.2.6.** Read
`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
and `.../03-api-reference/04-functions/connection.md`. Two findings shaped the
code:

1. **A page with no request-time API is prerendered.** `app/page.tsx` became
   async and started reading the conversation snapshot, but it reads no
   `params`, no `searchParams`, no `cookies()` — so Next 16 statically
   prerendered `/`. `pnpm build` marked it `○`. That would have baked one
   build-time transcript into the HTML and broken US-F1.3 under `next start`
   while working perfectly under `next dev`. `await connection()` is the
   documented fix for exactly this shape ("useful when a component doesn't use
   Request-time APIs, but you want it to be rendered at runtime"). It is a
   function call, not route-segment config, and needs no `cacheComponents` —
   which stays off.
2. **No route-segment config anywhere.** Route handlers are dynamic by default
   in Next 16, `cacheComponents` is off, and this phase adds no route handler
   and no `next.config.ts` change.

**EVE 0.27.8.** Read before any code was written, against the installed
package rather than recalled:
`docs/guides/frontend/{overview,nextjs}.mdx`,
`docs/tools/human-in-the-loop.md`, and the declarations under
`dist/src/client/{message-reducer-types,eve-agent-store,client,session,session-utils,types}.d.ts`,
`dist/src/react/use-eve-agent.d.ts`, `dist/src/runtime/input/types.d.ts`, plus
the compiled `dist/src/harness/input-extraction.js`. Six findings, each
verified against the installed tree:

1. **There is exactly one tool part type.** `EveMessagePart` is
   `text | reasoning | file | step-start | authorization | dynamic-tool`. There
   is no `tool-call` part and no `tool-result` part.
2. **The approval prompt is boilerplate.** `extractApprovalRequests` builds
   every tool approval as `prompt: "Approve tool call: <toolName>"`, options
   `[{id:"approve",label:"Yes"},{id:"deny",label:"No"}]`,
   `display: "confirmation"`, `allowFreeform: false`.
3. **`preserveCompletedSessions` defaults to `false`.** The `Client`
   constructor reads `options.preserveCompletedSessions ?? false`, and
   `useEveAgent`'s store-owned session never passes it.
4. **`onFinish` fires at every turn boundary.** `EveAgentStore.send` calls it
   from a `finally` block — after completion, error, abort, and a turn parked
   at `session.waiting` for an approval.
5. **`next start` never boots the agent** (measured; see below).
6. **`agent-browser wait` has no `--timeout`** — `--help` lists one only under
   `--download`.

---

## Decisions taken at design time

### One renderer over one part type, branching on `state` — not the plan's three

Implementation plan §2.5 reads as three part types: "`tool-call` /
`tool-result` → structured action entries" and "`dynamic-tool` with
`toolMetadata.eve.inputRequest` → approval card". **The installed runtime has
one.** `node_modules/eve/dist/src/client/message-reducer-types.d.ts` defines
`EveMessagePart` as a union of `text`, `reasoning`, `file`, `step-start`,
`EveAuthorizationPart` and `EveDynamicToolPart`, and every tool call — gated or
not, read or write — is projected onto the single `dynamic-tool` type,
discriminated by `state`:

```
input-streaming → input-available
  → [approval-requested → approval-responded]
  → output-available | output-error | output-denied
```

Implementing the plan's prose literally would have matched nothing: no part in
the app ever has type `"tool-call"`, so **every tool call would have vanished
from the transcript** while the code looked correct. `components/chat/tool-part.tsx`
is therefore a one-line dispatcher on `part.state`, and that single line is
what makes "generic across all seven gated tools" true by construction rather
than by discipline — including `update_task`, whose gate is the
input-dependent `afterFirstTaskInTurn` policy and can pause an ordinary edit
mid-turn.

This is recorded loudly rather than fixed silently, because the plan is
authoritative on architecture and a future reader will otherwise assume the
divergence was carelessness.

### The approval card states the case itself; eve's prompt is suppressed

US-F5.2 requires the card to state "exactly what it is about to do — which
tasks, what change, how many". The obvious implementation is to render
`request.prompt`, which every proposal for this phase assumed was crafted
copy. It is not. `dist/src/harness/input-extraction.js` builds it as:

```js
prompt: `Approve tool call: ${toolName}`,
options: [{ id: "approve", label: "Yes" }, { id: "deny", label: "No" }]
```

So the card would have read *"Approve tool call: bulk_delete_tasks — Yes /
No"*: no titles, no count, no change. `agent/instructions.md`'s per-tool
approval wording shapes the model's **message**, not this prompt.

The card therefore derives everything from `part.toolName` and `part.input`
via `lib/chat/describe-tool-call.ts`, and suppresses `request.prompt` whenever
`display === "confirmation"`. For `ask_question` (`display` `"text"` or
`"select"`) the prompt **is** the model's real question, so it is rendered
verbatim and prominently. One component, two shapes, distinguished by data.

### The chat pane owns its `ClientSession`

The docs' minimal recipe passes `initialSession` and lets `useEveAgent` build
the session. We do not use it. The hook constructs
`new Client({ auth, headers, host }).session(initialSession)` and never passes
`preserveCompletedSessions`, which `Client` defaults to `false`; `advanceSession`
then calls `createInitialSessionState()` — destroying `sessionId`,
`continuationToken` and `streamIndex` — on any `session.completed` boundary.
The next send would open a fresh server-side conversation and "move that one to
Done" would resolve against nothing.

`ChatPane` holds
`new Client({ host: "", preserveCompletedSessions: true }).session(persistedCursor)`
in `useState` and passes it as `session`. In practice a conversation-mode turn
parks at `session.waiting`, so the cursor would survive either way — but
US-F1.4 is a graded exit criterion, this costs four lines, and it is exactly
what eve's own scaffolded chat template does. `EveAgentStore`'s constructor
confirms `initialEvents` is still honoured when an external session is
supplied (`this.#events = [...init.initialEvents ?? []]`), so no rendering
fidelity is lost. No Stop button ships, so `reset()`'s external-session
behaviour is irrelevant.

### Ids are resolved to names client-side, through the cache the left pane warms

Every gated tool's input carries only ids. `lib/chat/use-entity-labels.ts`
resolves them in two tiers over the existing TanStack cache: **tier 1 always**,
`useProjects()` + `useTasks({ includeCompleted: true })`, because `TaskDto`
denormalises the project, status and priority names onto every row; **tier 2
only** when a status or priority ref survives tier 1 — in practice only
`delete_status` / `delete_priority`, whose targets are by definition used by no
task — a `useQueries` fan-out over each project's statuses and priorities,
reusing `queryKeys.*` and the same URLs `useStatuses`/`usePriorities` use.

No new API route, no new schema, no new dependency, and the card can never show
a name the task list disagrees with. It lives in `lib/chat/` rather than
`lib/queries/` because that directory's own doc comment fixes it at one file
per API resource and this is cross-resource by nature.

### An unresolved id degrades to a short id, never to a fabricated name

`shortId(id)` — the first 8 characters — in muted monospace with the full id in
`title`. Approve and Deny are never blocked on resolution. Blocking a safety
control on a background fetch is worse than a degraded label, and inventing a
plausible title on a delete confirmation would be actively dangerous. The
model's own message names the item in prose as a backstop.

### Every tool call gets an action entry, reads included

US-F6.1 says "each action", not each write, and product spec §6 says each
action is rendered "not buried in prose". Reads get the quietest treatment (a
muted row with a magnifier glyph). Showing them also makes the grounding
US-F2 requires **visible evidence** rather than an implicit claim: the user can
see the agent looked before it answered.

### Buttons are generated from `request.options`, and say the verb

Option ids come from `request.options[].id` at runtime. The mandated
`approval-approve` / `approval-deny` testids attach to whichever options are
literally `"approve"` / `"deny"`; anything else renders as
`approval-option-<id>`, plus `approval-freeform` / `approval-freeform-submit`
when `allowFreeform` is set. `extractApprovalRequests` always produces exactly
those two ids for tool approvals, so the fixed testids are always present for
the seven gates — but `ask_question` is a live built-in with arbitrary options,
and reading ids at runtime is correct for both shapes with no extra component.

The confirm button's **copy** is ours: "Delete 3 tasks", not "Approve" and not
eve's "Yes". A control should name exactly what happens when it is used, and
"Yes" next to a permanent multi-task delete is the weakest possible
confirmation copy. Plan §2.7 fixes the testids, not the labels.

### Severity keys the accent, rather than blanket red

`destructive` → the destructive token; `write` → the primary emerald;
`read` → muted; `question` → plain. A bulk status change that cried wolf in the
same red a delete uses would erode the signal exactly where it matters.

### `onFinish` also invalidates the query cache

Documented as the chat pane's own cache hygiene, explicitly **not** Phase 6's
live sync. Without it the label resolver goes stale the moment the agent
creates or renames anything, and the next approval card in the same
conversation degrades to short ids — a direct US-F5.2 regression. Three lines;
Phase 6 replaces it with finer-grained `onEvent` invalidation.

### `onFinish` only, no `onEvent` persistence

`EveAgentStore.send` calls `onFinish` from its `finally` block on every turn
settle, including a turn parked at `session.waiting` for an approval, so an
approval-parked turn is persisted and survives a reload. **Verified in the
browser**: an approval card was left on screen, the page reloaded, and the card
came back from the snapshot. Plan §8 risk 5 already names and accepts the
remaining window (a hard browser close mid-turn loses that turn).

### The pure/hook split in `lib/chat/`

`describe-tool-call.ts` is framework-free with relative `.ts` imports — the
same dual-target trick `lib/actions/chat-state.ts` uses — so it runs under bare
`node --test` as well as through the Next bundler. No component-testing library
is inside the §1.1 dependency policy, so a pure module is the only way this
phase's highest-risk logic gets real automated coverage; `tests/unit/chat/`
covers all seven gated tools, `create_task`, a read tool, `ask_question`, an
unknown tool, unresolved ids, and twelve malformed inputs that must not throw.

`components/message-animated.tsx` keeps **no `eve` import** and gained a
generic `renderPart` render prop instead, so it stays a reusable shadcn-layer
component and all agent-runtime knowledge lives in `components/chat/*`.

### Tool input is parsed with the shared zod schemas, and never throws

The seven gated tools' inputs are checked with the exact `lib/schemas` objects
the route and the tool parse — making the shared contract a third consumer
rather than a fourth hand-rolled shape — with a generic key scan
(`taskId`, `taskIds`, `projectId`, `statusId`, `priorityId`) covering the
twelve non-gated tools. Every export is total, because this sits on a live
render path underneath an Approve button: a malformed or hallucinated call must
degrade to raw ids, not blank the card.

### The one cast lives in `ChatPane`

`putChatStateSchema` is envelope-only by design — eve's event and session
interiors belong to a young runtime. `app/page.tsx` passes the action's own
return shape through untouched; `ChatPane` accepts
`{ events: unknown[]; session: Record<string, unknown> | null }` and casts once,
in the component that actually knows what eve expects. The Server Component
stays free of agent-runtime knowledge.

### `@ai-sdk/react` removed

It was the fake-transport demo's only consumer, grep confirms zero remaining
imports anywhere in `app/`, `components/`, `lib/`, `agent/`, `tests/` or
`scripts/`, and it is not on §1.1's allowed list. Phase 5 is precisely the
phase where its last justification disappears.

---

## Decisions taken at build time

### `next start` cannot boot the agent, so the harness does

**Measured, not inferred.** With `next start` alone against a production build,
`GET /eve/v1/health` through the Next origin answered **500** with
`ECONNREFUSED 127.0.0.1:4274`; `.next/routes-manifest.json` contained the
rewrite `/eve/v1/:path+ → http://127.0.0.1:4274/eve/v1/:path+` exactly as
expected. With `eve start --host 127.0.0.1 --port 4274` running alongside, the
same request answered `{"ok":true,"status":"ready",…}`.

The cause is structural: `withEve()` spawns the production server inside
`resolveEveDestinationPrefix`, which it calls only from `rewrites()`, and Next
evaluates `rewrites()` at **build** time. `next start` reads the finished
rewrite out of the manifest. `eve/docs/guides/frontend/nextjs.mdx` states the
same requirement in prose.

So `startE2eServer({ eve: true })` starts it — guarded on
`.output/server/index.mjs`, `DATABASE_URL` overridden in the child env only,
health-polled, torn down as a process group **after** the Next server because it
holds a fixed port. Opt-in per suite, so 01–05 stay fast and unchanged (48/48
still green). `pnpm test:e2e` gained `pnpm exec eve build &&`, and `/.output` is
gitignored and eslint-ignored.

### Node-side polling for agent turns

`agent-browser wait --help` lists `--timeout` only under `--download`, so plan
§4.5's 90s agent-turn waits cannot be a single CLI call, and raising the
`execFile` timeout would not help because the CLI's own internal wait expires
first. `waitUntil` plus `slowWaits()` poll from Node with short calls well
inside the existing timeout, and fail with the label and elapsed time so a hung
turn reports legibly. Strictly additive; 01–05 keep their defaults.

### The approval card owns its own visibility

The message scroller implements "your question stays at the top" with a
per-message anchor plus a viewport-height spacer under the last message.
Measured in the browser, that put a **live approval card entirely below the
fold** — card top 637 in a viewport ending at 454 — behind a scroll-to-bottom
button; and scrolling to `end` then landed a full viewport *past* the last real
content, because the spacer counts toward `scrollHeight`.

A control the user has to go looking for is not a safety gate. This pane opts
out of both halves (`scrollAnchor={false}`, `spacerClassName="h-0"`), and
`ApprovalCard` additionally calls `scrollIntoView({ block: "nearest" })` on
mount so the guarantee lives on the control rather than in the scroller's
heuristics. `nearest` is a no-op when the card is already visible. Verified
after the fix: exactly one card, fully inside the viewport, across a reload.

### Only the newest message can render a live approval card

After a reload, an **already-answered** `ask_question` came back as
`approval-requested`. The cause is by design in eve: the event that resolves it
client-side is `client.input.responded`, a reducer-facing projection event that
the docs state is deliberately **not** exposed through `events` — the array we
persist. So a replayed transcript grows a scrollback of live-looking Approve
buttons for decisions the user already made, which is the worst available
failure mode for a safety control.

eve parks the whole turn on an `input.requested`, and its frontend guide places
the pending request on "a `dynamic-tool` part of the latest message". So
`ToolPart` takes a `live` flag, true only for the newest message; every earlier
`approval-requested` part renders as history. Measured after the fix: one card,
not two. (Refined in review: "newest message" became "newest message that is
not the user's" — see below.)

### The composer closes while a request is pending, and `live` skips the user's own messages

Reversing the assumption recorded below, on review. Two facts collide:

1. `useEveAgent` runs with `optimistic: true` by default, so
   `agent.send({ message })` projects the user's text into
   `agent.data.messages` **immediately**, before eve confirms anything
   (`EveAgentStore#y` emits `client.message.submitted`).
2. The composer was open while a turn was parked at `session.waiting`, because
   `agent.status` is back to `ready` there — the store calls `onFinish` from a
   `finally` block on that boundary too.

So an entirely ordinary act — typing "wait, why?" while a delete confirmation
was on screen — appended a user message, moved `messages.at(-1)`, and demoted
the assistant message carrying the still-pending request to `live: false`. The
card downgraded to a plain action entry and its Approve and Deny buttons left
the transcript with no other way back, while the server-side turn stayed
durably parked waiting for exactly that answer and every later message queued
behind it. That is the failure mode plan §8 risk 6 asks this phase to spend
design effort on, and eve's own docs make the trigger normal rather than
exotic.

Both halves are fixed, because either alone leaves a sharp edge:

- **An approval card no longer depends on its position in the transcript at
  all.** Position was never evidence for a tool approval: answering one always
  advances the part on the *server* — `output-available`, `output-error` or
  `output-denied` — so a part still reading `approval-requested` is still
  genuinely parked, reload or no reload. The reload guard above was really
  about `ask_question`, which has no `execute` and therefore no server-side
  event that ever advances it; that one keeps the position rule, now measured
  against the newest message **that is not the user's** so an optimistic
  projection cannot blink it out either. Verified in the browser after the
  change: a reloaded transcript containing an answered question shows zero
  cards, while a reload with a genuinely pending approval shows exactly one and
  keeps the composer closed.
- **The composer and Send are disabled while that message carries an
  unresolved *approval***, with a one-line `chat-blocked` note saying why. eve
  would hold the follow-up rather than deny the call, so this is not needed for
  *correctness*; it is needed because a message the agent cannot answer until
  you decide buys the user nothing while a destructive call sits waiting.

Approvals only, deliberately: eve's two HITL shapes differ in exactly the way
that matters here. A follow-up sent under an approval is *held* until the
approval is answered; one sent under an `ask_question` "clears that pending
request before the model continues" and starts the next turn. Typing past a
question is therefore a supported, sensible move — "never mind, show me my
tasks" — and the composer stays open for it. Typing past a delete confirmation
is not. `06-agent-chat`'s `turnSettled` helper learned the same distinction: a
turn parked on an approval is durably idle, not a hang.

It cannot wedge the pane: Approve and Deny stay enabled, and answering either
projects `client.input.responded`, which resolves the part locally and reopens
the composer even for a request the server has long since forgotten.
`06-agent-chat` asserts the closed composer, the visible reason, the intact
card, and the reopening.

### Resolved names are remembered, so the transcript does not forget

Also from review. `useEntityLabels` reads only rows that **currently exist**,
and `onFinish` invalidates those queries at every turn boundary — so the moment
the agent deleted something, every name it had vanished from the cache and the
settled entry for that very delete rewrote itself from "Deleted Archive the old
logo files" to "Deleted 7f3a1c2b", in front of the user, right after they
approved it. Every earlier mention of the row degraded with it.

The hook now keeps a monotone cache: an id that has ever resolved keeps its
name, and a fresh name always wins over a remembered one, so a rename still
lands. Nothing is fabricated — an id that never resolved is still absent, and
`describeToolCall` still degrades it to a short id. A transcript is a record of
what happened; it does not get to forget.

### Three prose defects the browser pass caught

Each was found by driving the real agent and **looking at the screenshot**, not
by reading the code:

1. **An empty Reasoning box.** A reasoning part streamed in with no text
   rendered as a labelled empty container. Parts whose paragraphs are empty now
   render nothing.
2. **Literal markdown.** The model writes light markdown whether or not you ask
   it to, and `**Draft the launch plan**` reached the transcript with its
   asterisks intact. `components/message-animated.tsx` gained a deliberately
   minimal renderer for the three constructs that actually turn up — bullet
   lines, `**bold**`, `` `code` `` — and nothing else. It is **not** a markdown
   parser: §1.1 forbids adding one, and a hand-rolled parser trying to be
   complete would be a far bigger liability than a few unstyled characters.
   Anything unrecognised renders as the literal text the model wrote.
3. **A restored transcript opened on an old question.** The scroller's default
   `last-anchor` landed a reloaded conversation mid-scroll on the first user
   message, which also left autoscroll disengaged for everything streaming in
   afterwards. `defaultScrollPosition="end"`.

### A single-target approval card does not repeat itself

The first build rendered "Delete “Draft the launch plan”" as the headline and
then a one-row `TASK / Draft the launch plan` manifest directly beneath it. The
manifest now renders only when `count > 1`; for a single target the
`approval-target-<id>` hook sits on the headline, which already names it. The
testid contract is unchanged and the card lost an accessory.

### `describeToolCall` returns both tenses

`headline` is imperative ("Delete 3 tasks") for a pending call and for the
confirm button; `pastHeadline` is past tense ("Deleted 3 tasks") for a settled
action entry. Building both in the summariser keeps the renderers from doing
string surgery on a finished sentence.

### `singularize` special-cases `-us`

The generic noun derivation turned `status` into `statu`. Words ending in `us`
or `ss` are left alone. Caught by the unit test before it reached a screen.

### The E2E reset uses `DELETE`, and the first agent turn gets 120s

Two harness findings from the first full runs, both recorded rather than
papered over.

`TRUNCATE` needs an `AccessExclusiveLock` on every table. From this phase the
agent suite runs a **second** process against the same database, so the
truncate blocked the eve server's writer while that writer held the row locks
the truncate was waiting for — `40P01 deadlock detected`, on two tests of the
first full `06` run. `DELETE` takes only `RowExclusiveLock`, so the cycle
cannot form; the identity restart is not missed, because every key is a UUID.

Separately, a stabilisation run timed out on the **first** turn of the file at
90s while every other turn in the same run settled in 15–24s: that turn pays a
cold eve workflow and a cold model connection the rest do not. The budget is
now 120s. Raising a synchronisation budget to match measured behaviour is not
the same as retrying flake away — no assertion moved. In the same pass the
grounded-read test stopped waiting on `list_tasks` by name and now waits for
the turn to settle and asserts a settled *read* plus the two fixture titles:
the story's claim is "answered from current data", and pinning it to one tool
name would fail a correct answer reached a slightly different way.

---

## Assumptions

| Assumption | Basis | If wrong |
| --- | --- | --- |
| The eve server on 4274 is the exact target baked into `.next/routes-manifest.json`. | Read out of the manifest after `pnpm build`: `http://127.0.0.1:4274/eve/v1/:path+`. `withEve` reads `EVE_NEXT_PRODUCTION_PORT` and defaults to 4274; the harness sets neither, so build and runtime agree. | Every agent turn in `06` fails with a 502. Fix by exporting the same `EVE_NEXT_PRODUCTION_PORT` for both, or by reading the destination out of the manifest in `startE2eServer`. |
| A `pnpm dev` is not holding port 4274 when the E2E suite runs. | The port is fixed by the baked rewrite; nothing else in the repo binds it. | The health poll fails. The harness names this as the likeliest cause in its error message rather than leaving it to guesswork. |
| `ask_question` renders sanely through `ApprovalCard`. | eve's docs state approvals and questions share one protocol and produce the same `input.requested` pause; the component branches on `request.display`, `options` and `allowFreeform` rather than on tool name. | A question renders with the wrong control. Phase 4 recorded `ask_question` as live but unexercised; this phase closes the gap by construction rather than by test, since forcing model ambiguity deterministically is outside its control. |
| Two requests resolve every id a typical approval card references. | `TaskView` denormalises project, status and priority names onto every row, so `useProjects()` + `useTasks({includeCompleted:true})` cover every task and every list in use. | The tier-2 fan-out fires more often than expected — O(projects) extra cached requests. Bounded and invisible at this product's scale. |
| With an explicit "using a single bulk update" instruction, the model calls `bulk_update_tasks` once. | `instructions.md` and `update_task`'s own description both push toward the bulk tool, and the edit gate makes the looping path visibly worse. | The bulk test sees separate `update_task` cards and fails. The fix is a tighter prompt, never a loosened legibility assertion — tool-choice quality is Phase 6's evals. |
| ~~The composer may stay open while an approval is pending.~~ **Reversed in review** — see "The composer closes while a request is pending" below. | — | — |

---

## Known gaps carried forward

- **No Stop button.** `agent.stop()` only detaches the client stream — the
  server turn keeps running and billing — so a bare Stop would be misleading
  UX. A real cancel needs `session.cancel({ turnId })` guarded on an observed
  `turn.started` event. We already own a `ClientSession`, so it is cheap to add;
  nothing in US-F1–F6 asks for it.
- **Whole-snapshot persistence.** `PUT /api/chat-state` is last-write-wins with
  no delta path (plan §8 risk 5, inherited). A hard browser close mid-turn loses
  that turn's events; the next turn re-persists everything else.
- **US-F6.2 is not E2E-asserted.** "The reply summarizes in plain language what
  changed" is prose, and plan §4.5 forbids asserting the assistant's wording.
  It is verified by inspection in the browser packet.
- **The bulk edit gate is still process-scoped** (Phase 4's note). N parallel
  `update_task` calls in one turn surface as one free write plus N−1 separate
  approval cards, not one card covering N. The UI renders each correctly; the
  consolidation is a backend concern.

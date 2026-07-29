# Phase 6 — Live sync + parity validation (Epic G): decisions and assumptions

**Phase:** 6 — Live sync + parity validation, Epic G
**Date:** 2026-07-29
**Branch:** `phase-6-live-sync-parity-validation-epic-g`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 5 gave the agent a face. This phase makes the two halves of the split
screen one live surface: an agent action now lands in the left pane without a
refresh, a UI change is visible to the agent's very next answer, and concurrent
edits converge. It also closes the phase's other half — evals for the
behaviours no E2E assertion can reach.

Nothing under `lib/actions/`, `lib/schemas/`, `lib/domain/`, `lib/api/`,
`app/api/` or `agent/` changed. The product code touched is two files:
`lib/chat/tool-invalidation.ts` (new) and `components/workspace/chat-pane.tsx`.

Same two conventions as the Phase 0–5 records: a decision taken **at design
time** was settled before code was written; a decision taken **at build time**
was forced by something only discoverable once the code ran or the browser was
driven.

---

## Framework pre-read (AGENTS.md mandate)

**Next.js 16.2.6.** Re-read
`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`.
It changed nothing, and confirming that was the point: this phase adds no route
handler, no page, no `next.config.ts` change and no route-segment config. The
`onEvent` wiring lives entirely inside `chat-pane.tsx`, which has been a
`"use client"` component since Phase 5, so the client boundary does not move
and `app/page.tsx`'s load-bearing `await connection()` is untouched.

**EVE 0.27.8.** Read against the installed package, not recalled:

- `docs/evals/{overview,cases,assertions,judge,running,targets}.mdx`
- `dist/src/protocol/message.d.ts`, `dist/src/runtime/actions/types.d.ts`
- `dist/src/client/eve-agent-store.d.ts`, `dist/src/client/session-utils.js`
- `dist/src/evals/types.d.ts`, `dist/src/evals/judge.js`,
  `dist/src/evals/context.js`

Four findings shaped the code, each of which contradicted something the plan
or the framework notes said in prose:

1. **The event is `action.result`, not "tool-result".** `message.d.ts` declares
   exactly two action events: `actions.requested` (pre-execution) and
   `action.result` (settled, with `data.status` of `completed` / `failed` /
   `rejected`). The payload is `data.result`, a `RuntimeActionResult` whose
   tool-call variant is `{ callId, isError?, kind: "tool-result", output,
   toolName }`. A handler matching the string `"tool-result"` on `event.type`
   would silently never fire.
2. **`onEvent` is observe-only, over authoritative events.**
   `eve-agent-store.d.ts` declares
   `readonly onEvent?: (event: HandleMessageStreamEvent) => void` and documents
   it as observe-only; the store calls it for server events and never for its
   own optimistic client projections. An invalidation from it therefore cannot
   race a write that has not happened.
3. **A parked turn has no `message`.** `session-utils.js`'s
   `extractCompletedMessage` keeps only `message.completed` events whose
   `finishReason !== "tool-calls"` — which excludes every assistant step that
   ends by calling a tool, and therefore every pre-approval message. See the
   build-time record below; this cost two evals a flat 0%.
4. **The judge is `autoevals`, and its `input` is the last prompt.**
   `evals/judge.js` passes `getInput()` (the text of the most recent `send`) as
   autoevals' `input` and grades `on ?? t.reply` as `output`. `ClosedQA` is a
   binary Y/N grader.

---

## Decisions taken at design time

### Invalidation keys off `action.result` with `status: "completed"`

`queryFamiliesForEvent` fires only for a settled *successful write*:
`type === "action.result"`, `data.status === "completed"`,
`data.result.kind === "tool-result"`, `isError !== true`, and the output is not
this repo's own failure envelope.

`actions.requested` is excluded on its own terms: it fires before execution,
when nothing durable has changed, so refetching on it would re-read the old
rows and never re-read the new ones. `rejected` is excluded because it is eve's
marker for a call the user denied at an approval gate — a denied delete touched
nothing, and refetching for it is the one thing that could make a denial *look*
effective.

Plan §5.1's sentence has been corrected in place, with a note saying what it
used to say and why that was wrong. `docs/eve-framework-notes.md` carries the
same loose phrasing but is explicitly a dated snapshot ("re-verify against live
docs before coding"), so it is left as the record it is.

### The mapping is a pure module returning symbolic families, not query keys

`lib/chat/tool-invalidation.ts` returns
`"tasks" | "projects" | "statuses" | "priorities"`, and `chat-pane.tsx` maps
each to `queryKeys[family].all` at the call site.

The module then imports no React and no `@tanstack/react-query`, so it runs
under bare `node --test` with no shims — the same dual-target trick
`describe-tool-call.ts` uses, and the reason this phase's highest-risk logic
has real automated coverage without a component-testing library (which §1.1's
dependency policy does not allow). `lib/queries/keys.ts` stays the single owner
of key shapes.

### The tool → family table is exhaustive and hand-authored

All nineteen product tools are listed, the five read tools included with an
empty set. An unknown tool name returns `[]`.

`describe-tool-call.ts` derives display wording from a naming heuristic; this
deliberately does not reuse it. Display wording degrading gracefully is fine.
Invalidation silently missing a tool is a pane that quietly lies — no error
anywhere, just stale data. An exhaustive table fails loudly enough for one
browser pass to catch, and `tests/unit/chat/tool-invalidation.test.ts` reads
`agent/tools/` off disk and subtracts a commented allowlist of eve built-ins,
so a twentieth product tool turns that into a red unit test the moment the file
lands.

### The family sets mirror `lib/queries/*.ts` exactly, and are not re-derived

`delete_project` → all four (it cascades through statuses and priorities, and
the pane may still be filtered by the project that vanished). `create_project`
and `rename_project` → `projects` + `tasks`, not statuses/priorities: those
queries are keyed by the *selected* project, and a brand-new project is not
selected. Every status/priority write → its own family plus `tasks`, because
`TaskView` denormalises status name and order, priority, and project name onto
every task row.

Those sets were designed and reviewed in Phase 3 and encode real reasons.
Re-deriving them from first principles would produce a second, divergent
opinion about the same question, and the two halves would drift.

### `onFinish`'s blanket sweep is removed, not kept alongside

`onFinish` is now persistence only.

`onEvent` is a strict refinement of the sweep: every family it touched is still
invalidated, per completed mutation rather than per turn, and *earlier*. So the
US-F5.2 label-resolver hygiene the sweep existed for is better served — a
`create_project` mid-turn now refreshes labels before an approval card for a
later call in the same turn renders. Keeping both would manufacture exactly the
redundant refetching this phase's own fetch-storm check exists to catch. One
thing is genuinely lost: a dropped stream that the turn boundary would have
swept up. `app/providers.tsx`'s refetch-on-focus plus 30s poll is §5.3's
documented backstop for that, and `07` now asserts it.

### Failure outputs skip invalidation, but only our own envelope

`isFailedToolOutput` returns `true` only for a plain object with an explicit
`ok === false`. `agent/lib/tool-result.ts` is authored in this repo and every
product tool returns through `runAction()`, so parsing that shape is reading
our own contract rather than guessing at an eve-owned `JsonValue`. A blocked
rule or a not-found id changed nothing, so refetching four families for it is
waste. Requiring an explicit `false` keeps the safe default: an unrecognised
output shape still invalidates, because a needless refetch is cheap and a
missed one is a stale pane.

### US-G3 uses two sessions, but only one of them drives the agent

Session A drives the agent; session B drives the inline status select on the
same task row.

This is what US-G3.1 literally asks for ("when the UI **and** agent modify the
same task"), and it is what §5.4's "unconditioned row updates, last-write-wins"
actually claims. Racing two *agent* turns would instead exercise eve's
stale-continuation-token rejection — `chat_state` is a single global row keyed
by `CHAT_STATE_ID`, so both browsers hydrate the same cursor — which is a
session-concurrency bug class the framework rejects by design and which proves
nothing about row convergence. The arrangement has a bonus: B receives no eve
events at all, so its convergence is the first real test of §5.3's poll
backstop "for a second tab".

### US-G3 is split into a sequenced test and a raced one

US-G3.1 awaits the UI write to completion before the agent turn starts, so
"last write wins" has a determinate answer and is hard-asserted. US-G3.2
overlaps them, reads the winner out of Postgres afterwards, asserts it is one
of the two candidate values, and then asserts *both* panes converge on that
value.

US-G3 has two acceptance criteria and they want different tests. AC1 is
deterministically assertable only when ordering is controlled. AC2 is the
interesting claim under a real race, and asserting convergence to whatever the
database says is both honest and stronger than picking a winner: a merge, a
null, or an optimistic-update revert all fail it.

### The live bound is 5 seconds, measured from the settled action entry

Every US-G1 assertion starts its clock at the chat pane's `action-entry`
reaching `data-state="output-available"` — the same settled event that fires
`onEvent` — and nothing in `07-live-sync.test.ts` ever calls `reload()`.

Plan §5.1 claims "within the same second"; the wait is polled from Node over
the CLI at a one-second cadence, so five seconds asserts that claim without
turning poll granularity into flake. It is **not** airtight against the 30s
backstop firing coincidentally inside the window, and the file says so rather
than pretending otherwise. The mechanism is proven where it can be proven
deterministically: the unit test's exact mapping, and the read-only control
turn in the fetch-storm test, which is only near-zero if invalidation is keyed
on mutating tool names.

### Evals assert prose and protocol facts; they never read database rows

Row-level assertions stay exclusively in `06-agent-chat.test.ts` and
`07-live-sync.test.ts`. This is the plan's own division of labour for the
phase, made structural rather than conventional so the two suites cannot drift
into redundancy — `06` already walks the full delete approval cycle against
real rows, far more reliably than an eval would.

### Every eval gate is deterministic; every judge is soft with a bar

All 25 gates are tool-call facts, `parked()`, or substring/regex checks. Every
`t.judge.autoevals.*` is `.atLeast(…)`. The phase's "evals green" exit
criterion is a clean `pnpm eval`; `pnpm eval --strict` is captured alongside as
evidence.

This goes with eve's documented defaults rather than against them, and it means
the gate is reproducible: a judge model having an off day cannot turn the exit
criterion red, while genuine prose regressions still surface as tracked scores.

### `scripts/eval.ts` wraps `eve eval` to keep it off the dev database

`eve eval` boots its own target and has no `--database-url` flag; the agent
under test reaches Postgres through whatever `DATABASE_URL` it inherits, which
unwrapped is the **dev** database. Evals execute real, unreviewed agent tool
calls including deletes and bulk operations, so the project's "tests never
touch the dev database" rule applies verbatim even though `evals/` sits outside
`tests/`.

The wrapper is the same shape `tests/e2e/harness/server.ts` and
`tests/api/support/server.ts` already use: `resolveTestDbUrl()` (the one guard,
never re-derived), assert `AI_GATEWAY_API_KEY` so a skipped run cannot look
like a pass, spawn the existing `scripts/reset.ts --target=test` rather than
duplicating a destructive routine, then spawn `eve eval` with `DATABASE_URL`
overridden **in the child's environment** — never on the command line, where a
credential would reach a process listing.

It is a standalone `"eval"` script, not folded into `test` or `test:all`,
following the `verify:agent` precedent: it makes real, billable model calls.

### Eval isolation is by construction, not by reset

`eve eval` runs discovered files concurrently (eve's default is 8; capped at 4
here), unlike the E2E suite's serial `--test-concurrency=1`. A per-eval wipe
would race siblings still in flight. So `scripts/eval.ts` resets once before
the runner starts, and from there every eval creates its own uniquely-named
project and **every prompt names that project explicitly** — an unscoped
`list_tasks` from a sibling can then never change an assertion.

Fixtures write through `lib/actions` directly, with no HTTP: the agent's own
tools reach `lib/actions` too, so a round trip through Next would exercise a
layer the evals are not grading and would require a second server.

### The judge model follows the repo's one model-selection convention

`process.env.EVE_EVAL_JUDGE_MODEL ?? process.env.EVE_MODEL ??
"anthropic/claude-sonnet-5"` — the exact resolution `agent/agent.ts` already
uses, plus one opt-in override. No new required credential, and no unverified
model id guessed against this environment's gateway catalog.

### No new dependency

`eve` (evals), `@tanstack/react-query` (invalidation) and `agent-browser`
(E2E) are all already installed. Tests stay on `node:test` +
`node:assert/strict`; unique tokens come from `crypto.randomUUID()`. §1.1's
table gains no row.

---

## Decisions taken at build time

### A parked turn's `.message` is `undefined`, and it cost two evals a 0%

Both HITL evals first graded `{ on: asked.message }`. Both scored a flat 0%
while every deterministic gate passed — and inspecting
`.eve/evals/<ts>/…events.ndjson` showed the agent's actual text was exactly
right ("I'll move all 3 tasks in … to In Progress").

The cause is in `eve/dist/src/client/session-utils.js`:

```js
function isFinalMessageCompleted(event) {
  return event.type === "message.completed" && event.data.finishReason !== "tool-calls"
}
```

Every assistant step that ends by calling a tool carries
`finishReason: "tool-calls"`, so a turn that parked on an approval has *no*
final message and `turn.message` is `undefined`. The judge was grading an empty
string. `messageIncludes` was unaffected, because it joins assistant text
across the scope's events rather than reading `message` — which is why the
deterministic assertions on the same text passed throughout.

`evals/support/transcript.ts` now joins the assistant text out of the turn's
own events. `assertions.mdx` names the typed event stream as the sanctioned
escape hatch for exactly this, so this is the documented move rather than a
workaround.

### The two HITL criteria were also simplified, and that change is unmeasured

`autoevals`' ClosedQA is a binary Y/N grader, and the first drafts of the two
HITL criteria were compound questions with a clause the grader could not verify
from the text alone ("*before asking for approval*, does the reply …"). They
were rewritten as single declarative properties at the same commit as the
empty-string fix above.

Stated plainly because the temptation is to claim a diagnosis here: **the two
changes were not isolated from each other.** The empty string alone explains
both 0% scores, and the criterion rewrite may have contributed nothing. It is
phrased on the grader's documented terms rather than on evidence, and the
comments in both eval files say so. All four judges score 100% after the two
changes together.

### One eval criterion was wrong about the product's own contract

`never-deletes-without-approval` first graded whether the agent *asks the user
to confirm*. `agent/instructions.md` forbids exactly that: "do not ask a yes/no
question and wait … state exactly what you are about to do … and then call the
tool. That pause **is** the confirmation." The agent's reply — "I'll delete the
task … now." — was precisely what it had been told to produce, and the eval was
mis-specified rather than catching a regression. It now grades what the
contract actually asks for: name the task, describe the deletion as not yet
carried out.

Worth stating plainly because it is the failure mode evals invite — an eval
that encodes the author's expectation rather than the product's contract fails
green code and, worse, would have licensed "fixing" the agent to match.

### `factuality` is gated at 0.6, and that is the scale, not a loosened bar

`autoevals`' `Factuality` buckets a submission against the reference: 1.0
"identical", **0.6 "a superset that is fully consistent"**, 0.4 subset, 0
contradiction. A good answer to "how many tasks are in …" *is* a superset — it
names the project and often the tasks — and measured exactly 0.6. A 0.7 bar
would fail the correct answer and pass only a terse restatement of the
reference. The number that must be right is gated deterministically by
`t.check(counted.message, includes("7"))`.

### Run-level assertions on `t` are evaluated after `test` returns

`t.parked()` and `t.calledTool(…, { status: "pending" })` failed in
`never-deletes-without-approval` because the eval answers the approval later,
so by the time `t`'s assertions ran the turn had resumed and completed. Both
moved onto the turn returned by `t.send(...)`, which snapshots the moment the
claim is about. `requireToolCall` had the related trap: it defaults to
`status: "completed"`, matched nothing on a pending bulk call, and aborted the
rest of the test body — it was dropped in favour of the explicit
`calledTool(…, { status: "pending", count: 1 })` that follows it.

### Both US-G3 tests turn on "show completed" first

The first run failed both with "session A to show Done" timing out. The cause
is correct behaviour: Done is a completed status, so by US-B2.3 the row leaves
the default list and its status chip goes with it. Both sessions now opt into
showing completed tasks before anything is written, so the convergence
assertions read a chip that stays in the DOM whichever way the race lands.

### `update_task` is awaited through an approval-tolerant helper

A later full-file run failed US-G3.1 with `update_task` never settling.
`agent/tools/update_task.ts` uses `afterFirstTaskInTurn`, which keys on task
identity within the turn, so a model that issues a second `update_task` call —
a corrected id after a `not_found`, a redundant retry — parks the turn on an
approval card and the settled entry never arrives.

That is correct, deliberate, `06`-owned behaviour, and it is not what a
convergence test has anything to say about. `settledAction()` clears the card
and carries on. Approving rather than skipping keeps the test's subject intact:
the write still happens, still last.

### The fetch-storm bounds, and what was actually measured

Measured on the run captured in `docs/verification/phase-6/`:

| Turn | `/api/tasks` | all `/api/` |
| --- | --- | --- |
| read-only ("how many tasks are in …") | **0** | **1** (the `chat-state` PUT) |
| single mutation ("move … to Done") | **2** | **5** |

Bounds are 4 / 12 and 8 / 25 — roughly 2× with headroom for the 30s poll
firing inside a long turn. The regression these catch is order-of-magnitude:
invalidating per stream delta rather than per completed action would produce
hundreds. An exact count against a live poll would only be a flake generator.

The read-only row is the load-bearing one. **Zero** `/api/tasks` requests
across a full read-only agent turn is only true if invalidation is keyed on
mutating tool names, and it is the one deterministic proof of the mechanism
that lives in the browser suite.

### Four tests in `02` and `05` were fixed, outside this phase's scope

The full-suite run that closes this phase failed four tests — three in `05`,
one in `02` — every one of which passed when its file was run alone. Neither
file drives the agent, and `useEveAgent` emits no stream events without a send,
so `onEvent` never fires in either: not a Phase 6 regression. But §4.5's
standing rule is that flake is never retried away, and on inspection neither
was flake:

- `openLists()` (in both `04` and `05`) waited for `manage-project-select`,
  which renders when the **projects** query resolves. The statuses and
  priorities panels are separate queries keyed by the selected project, so
  every test that then clicked a control inside a row was racing a fetch —
  "Element not found: `priority-delete-<id>`" at 3.8s. Both helpers now also
  wait for the panel's loading state to clear, which covers the empty and error
  renderings too. `04` had the identical latent race and was fixed with it.
- `02`'s US-B3.1/3.2 had **no** settle point on the status and priority filter
  chips. `click` returns when the event dispatches, not when the new query
  key's fetch has landed, so the assertion read the previous filter's list and
  saw three rows where one was expected. Now uses the `waitCount` idiom the
  search test three tests below already used.

This is scope Phase 6 did not ask for. It was taken on because the phase's own
exit evidence is a full-suite run, and a suite that fails four tests under
latency is not evidence — and because Phase 7 needs the full suite green as its
completion gate. No assertion was weakened or removed; the fixes are the same
class Phase 3's record already documents ("three harness waits, each from a
real race the first run exposed").

### `TURN_MS` raised from 120s to 180s in `06` and `07`

The full-suite run after the settle-point fix went 60/62. Both failures were
agent turns that never settled inside two minutes, in two different files —
and the whole run's wall time was 23% longer than the run before it.

One of the two is diagnostic: it was `07`'s fetch-storm test timing out on
`turnSettled()` after a **read-only** question. `turnSettled()` already counts
a park at `chat-blocked` as settled, so that turn was genuinely still in flight
at 120 seconds — not parked, not stuck on an approval.

**What made it slow is not established, and the first version of this record
claimed it was.** It said "gateway latency", which was a guess dressed as a
finding. The evidence since points elsewhere: a later confirming run failed
eleven tests outright with **forty** `connect ETIMEDOUT` errors against the
Neon test project, and a manual probe immediately afterwards took 3.2s to
answer `select 1` from cold. Every tool the agent calls reaches Postgres
through `lib/actions`, so a cold or throttled test database stalls an entire
turn — which fits both timeouts at least as well as model latency, and fits the
four separate `ETIMEDOUT` episodes seen across this phase's runs much better.
Model/gateway latency is not ruled out; it is simply not evidenced.

Raised to 180s in both, following the precedent Phase 5's record set when it
raised 90s to 120s for the same reason: "raising a synchronisation budget to
match measured reality is not the same as retrying flake away: no assertion
moved." None moved here either. `06` then ran clean, US-F3.2/3.5 included, in
20.6s.

US-G3.2 additionally gets its own `RACE_TURN_MS` of 300s. It is the only test
in the suite that perturbs the world **mid-turn** — the UI write goes out while
the agent is still reading and deciding — so the agent can legitimately do more
work than in any other test here: re-read a row whose status is no longer what
it just saw, and account for the discrepancy. Measured at 44s, 46s, and one run
past 180s. A slow turn in that test is the scenario behaving correctly.

Stated plainly so the pattern is visible rather than buried: this phase raised
a timing budget three times. Each raise is backed by a measurement and none
changed an assertion, but three raises in one phase is the point at which the
next person should be suspicious rather than reassured. The thing that would
settle it is a run with the eve server's per-turn timings captured, which this
harness does not currently keep.

### The Neon test project is intermittently unreachable, and it is the phase's main source of noise

Four separate episodes across this phase's runs:

1. and 2. Two `pnpm eval` runs failed inside `scripts/reset.ts` with `ETIMEDOUT`
   on `CREATE SCHEMA IF NOT EXISTS "drizzle"`, immediately after the drop
   succeeded. Both retried clean with no change.
3. The two 120s turn timeouts above — cause unproven, but this is the leading
   suspect.
4. A full `pnpm test:e2e` run failed **eleven** tests with **forty**
   `connect ETIMEDOUT 54.92.227.85:5432`. `06` collapsed entirely because
   `resetTestDatabase()` in `beforeEach` could not connect; `02`'s two failures
   were the app rendering an empty list and an empty `<select>` for the same
   reason. A probe minutes later answered `select 1` in 3.2s from cold.

No retry loop was added anywhere. A retry around a destructive reset is the
kind of convenience that hides a real outage, and a retry inside the E2E
harness would convert an infrastructure failure into a slow pass. The failures
are loud, they name the host and port, and that is the correct behaviour.

The practical consequence for whoever runs this next: a red full-suite run
should be checked against `ETIMEDOUT` before anything else is suspected.

---

## Assumptions

- **`agent-browser`'s `--json` request records carry `url`, `method` and
  `status`.** Verified against a live session before the parser was written:
  the envelope wraps `{ requests: [...] }`, and each record carries
  `url`/`method`/`status`/`timestamp`/`resourceType`/`requestId`/`headers`/
  `responseHeaders`/`mimeType`. Capture is on by default; no `--enable` flag is
  needed. `browser.networkRequests()` normalises defensively anyway, so an
  envelope change surfaces as an empty list rather than a `TypeError` inside a
  test that is only counting.
- **`eve eval` with no `--url` boots a healthy local target for this app.**
  Verified: every eval run in this phase booted one (`target
  http://127.0.0.1:<port>/`) and the agent's tools reached the test database
  through the inherited `DATABASE_URL`. No `--url` fallback was needed.
- **Two `agent-browser --session`s drive the same app concurrently without
  interfering.** Verified across both US-G3 tests: `e2e-07-live-sync` and
  `e2e-07-live-sync-b` hold independent pages, and session B receives no eve
  stream — its screenshot shows an empty chat pane next to a converged task
  row. Useful to Phase 7's parity capstone too.
- **A session receiving no eve events converges within 45s.** Verified: session
  B converged inside `BACKSTOP_MS` on every run, via `refetchInterval: 30_000`
  plus `staleTime: 5_000`. The value was not raised.
- **`t.respondAll("approve")` answers eve's generated approval.** Verified:
  the delete eval's post-approval `calledTool("delete_task", { status:
  "completed", count: 1 })` gate passes, so `approve` is the right option id
  (matching `extractApprovalRequests` in
  `eve/dist/src/harness/input-extraction.js`, recorded in Phase 5).
- **`.eve/` is gitignored.** Verified with `git check-ignore -v .eve` →
  `.gitignore:42`. `eve eval` writes `.eve/evals/<timestamp>/` artifacts on
  every run and none of them are tracked.
- **`07-live-sync`'s runtime is acceptable within the serial E2E budget.** The
  captured run is 229s for six tests, comparable to `06`. If it ever becomes a
  problem, US-G1.2's three prompts are the obvious thing to split — but not
  before Phase 7, which needs the full suite green as its completion gate.
- **The intermittent full-suite failures are caused by the Neon test project,
  not by this phase's code.** This is the one assumption in the list that is
  *not* verified — it is a strong correlation across four runs, not a proof.
  Basis, mechanism, and what would settle it are set out in full under
  [Known gaps](#known-gaps-and-what-phase-7-inherits) below. If it is wrong —
  if the slow turns have a separate cause — then the fix belongs in the harness
  or the agent, and emphatically not in a larger timeout.

---

## Deviations from the implementation plan

Three, all recorded above with their reasoning; collected here so a reader
comparing this branch against `docs/implementation-plan.md` can find them
without reading the whole record.

1. **Plan §5.1's event name was corrected in place.** The plan said
   `useEveAgent({ onEvent })` watches "action/tool-result events". No such
   event exists on the eve 0.27.8 wire, and a handler matching that string
   would have silently never fired — a permanently stale pane with no error
   anywhere. The implementation keys off `action.result` with
   `status: "completed"` instead, read out of
   `node_modules/eve/dist/src/protocol/message.d.ts`. §5.1 was edited to say
   so, with a note on what it used to say. This is the same discipline Phase 5
   was forced into when the plan's "tool-call/tool-result parts" turned out to
   be a single `dynamic-tool` part type. Details:
   [Invalidation keys off `action.result`](#invalidation-keys-off-actionresult-with-status-completed).

2. **Seven missing settle points were fixed across `tests/e2e/02`, `04` and
   `05`** — Phase 3 files this phase does not own, and scope the plan did not
   assign to Phase 6. They are real races (`openLists()` waited on the projects
   query rather than the panel's own; the filter chips had no settle point at
   all), exposed rather than caused by database latency. Taken on because this
   phase's exit evidence *is* a full-suite run, and a suite that drops four
   tests under latency is not evidence. No assertion was weakened or removed.
   Details:
   [Four tests in `02` and `05`](#four-tests-in-02-and-05-were-fixed-outside-this-phases-scope).

3. **`TURN_MS` raised from 120s to 180s in `06` (a Phase 5 file) and `07`, plus
   a 300s `RACE_TURN_MS` for US-G3.2 alone.** Each raise is backed by a
   measurement and none moved an assertion, following the precedent Phase 5 set
   when it raised 90s to 120s. Stated plainly because three raises in one phase
   is the point at which a reader should be suspicious rather than reassured —
   which is why the fourth raise was deliberately refused. Details:
   [`TURN_MS` raised](#turn_ms-raised-from-120s-to-180s-in-06-and-07).

One addition the build blueprint did not call for, which is an amendment rather
than a departure: **`evals/support/transcript.ts`**. It is required because a
parked turn's `.message` is `undefined` in eve 0.27.8 —
`extractCompletedMessage` drops any `message.completed` whose `finishReason` is
`"tool-calls"`, which every pre-approval message is. Without it the two HITL
evals grade an empty string and score 0%. Details:
[A parked turn's `.message` is `undefined`](#a-parked-turns-message-is-undefined-and-it-cost-two-evals-a-0).

Everything else follows the plan: no new dependency (§1.1's table gains no
row), the test layout stays `tests/unit` / `tests/api` / `tests/e2e` per §4.1,
convergence is unconditioned last-write-wins per §5.4, and the focus/poll
backstop is §5.3's as written.

---

## Known gaps and what Phase 7 inherits

### The full E2E run is not reliably green

Stated plainly, because it is the least comfortable fact in this record and
Phase 7's completion gate depends on it.

**Run in isolation, everything passes, repeatedly.** `pnpm test:unit` +
`pnpm test:api` 368/368. `06` 8/8. `07` 6/6, twice, captured in
`docs/verification/phase-6/07-live-sync.txt`. `pnpm eval` and
`pnpm eval --strict` 4/4 with all 25 gates.

**Run as one `pnpm test:e2e`, the suite intermittently loses one or two tests.**
Across five full runs this phase: 58/62, 60/62, 51/62 (the Neon outage),
60/62, and the run this record closes on. Every failure fell into three
classes, and two of them are now fixed:

1. **Missing settle points** (`02`, `04`, `05`) — real bugs, fixed, described
   above. These were the majority.
2. **Neon unreachable** — an outage, loud and self-identifying, described above.
3. **One agent turn exceeding its budget** — `06`'s US-F3.2/3.5 once, `07`'s
   fetch-storm turn once, `07`'s US-G3.1 once. Never the same test twice, never
   in an isolated run, and never with an error — the turn is simply still in
   flight when the budget expires.

**Class 3 is very probably class 2.** The final run of the phase makes the
correlation hard to miss: it carried 35 `ETIMEDOUT`s, `07` collapsed outright
because `migrateTestDatabase()` could not connect, `03` and `04` failed with
connection errors — and in that same window `06`'s US-F3.2/3.5 and US-F1.3/1.4
each sat past 180 seconds waiting for an ordinary turn (a single status move, a
pronoun follow-up) that takes 15–30s in a healthy run. The run before it, also
`ETIMEDOUT`-ridden, behaved the same way.

The mechanism that fits: every tool the agent calls reaches Postgres through
`lib/actions`. When the database is refusing connections, a tool call stalls
inside `postgres.js`'s connect timeout rather than erroring, so the turn simply
never settles and nothing surfaces in the browser at all — precisely the
observed symptom. The two agent-turn failures carry no `ETIMEDOUT` of their own
because the timeout is swallowed by a retry inside the driver, not because the
database was healthy for them.

This is a strong correlation across four runs, not a proof. What would make it
a proof is instrumentation the harness does not currently have: per-turn
timings from the eve server and per-query timings from the pool, so the next
occurrence names the slow layer instead of leaving it to inference. That is the
right Phase 7 task, and it is worth doing *before* US-G4's capstone leans on a
full green run.

What was deliberately not done: raise the budget a fourth time. Three raises in
one phase is where inflating a timeout stops being synchronisation and starts
being concealment — and if the cause is a database that is refusing
connections, no budget is large enough to be honest.

### Not finished: one clean full-suite run

The single piece of this phase's scope that was not landed is **a single
end-to-end `pnpm test:e2e` run with all 62 tests green**. The best result was
60/62, and the two closing attempts were wrecked by the Neon test database (35
and 40 `connect ETIMEDOUT` respectively, one of which took out the entire `07`
suite at its `migrateTestDatabase()` step).

Every phase deliverable is nonetheless green *in isolation*, and each is
captured as evidence in `docs/verification/phase-6/`: `07` is 6/6 twice, `06`
is 8/8, unit + API are 368/368, and the evals are 4/4 on both `pnpm eval` and
`pnpm eval --strict`. The exit criteria are met; what is missing is the single
combined run that would let Phase 7 lean on the whole suite as a gate.

### Carried forward to Phase 7

- **Root-cause the slow-agent-turn failures to certainty, before US-G4's
  capstone leans on a full green run.** This is the recommended *first* Phase 7
  task. The instrumentation that would settle it — per-turn timings from the
  eve server and per-query timings from the `postgres` pool — is what the
  harness currently lacks.
- **US-G4, parity across the whole capability set, is untouched.** It is Phase
  7's scope, and `tests/e2e/README.md`'s coverage table now marks it as the one
  remaining Epic G gap.
- `tests/e2e/README.md`'s coverage table now lists US-G1.1 through US-G3.2. The
  one remaining Epic G gap is **US-G4**, the parity capstone, which Phase 7
  owns as `08-parity.test.ts`.
- `evals/` is a working, green tree with a config, a fixture module, a
  transcript helper, and four evals. Adding a fifth is a file plus a
  uniquely-named project.
- `browser.networkRequests()` and `clearNetworkRequests()` exist in the
  harness, verified against the real CLI payload, if Phase 7 wants a request
  budget of its own.
- `agent/lib/bulk-edit-gate.ts`'s process-scoped memory remains a documented
  gap, unchanged by this phase. The `settledAction()` helper in `07` is the
  first place a test has had to work around it.

# Phase 2 — API routes: decisions and assumptions

**Phase:** 2 — API routes
**Date:** 2026-07-28
**Branch:** `phase-2-api-routes`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 2 builds the first of the two front doors onto Phase 1's action layer:
thin route handlers under `app/api/` that adapt transport and add no logic of
their own, plus `tests/api/` driving them over real HTTP with `node:test` and
the built-in `fetch`. The phase's whole claim is a negative one — that nothing
in `app/api/**` decides anything — so most of what follows is about keeping
that true under pressure.

Same two conventions as the Phase 0, 0r and 1 records: a decision taken **at
design time** was settled before code was written; a decision taken **at build
time** was forced by something only discoverable once the code ran.

---

## Decisions

### The error vocabulary lives in one wrapper, and unknown errors are rethrown

**Where does the parse → action → status-code mapping live, given roughly
twenty handlers need it?** In a new `lib/api/` directory: `respond.ts`
(`BadRequest`, `errorResponse`, `respond`) and `request.ts` (`readJsonObject`),
joined later by `scope.ts`. `respond()` takes a callback, so a handler body is
three to six lines.

The alternative — a hand-copied four-branch `catch` in every file — makes the
status vocabulary unauditable the moment one copy drifts. `lib/api/` is named
for its consumer rather than something generic like `http/`, which signals that
nothing outside `app/api/**` should import it; Phase 4's tools will need their
own, differently-worded mapping of the same two errors, and this is a model for
that rather than a shared dependency of it.

The load-bearing detail is the last branch: `errorResponse` **rethrows anything
it does not recognise**, so a genuine defect surfaces as a framework 500.
Flattening an unknown error into a plausible 4xx would hide bugs behind a
response body that looks like a considered answer. `tests/unit/api/respond.test.ts`
asserts the rethrow directly.

The full vocabulary:

| Outcome | Status | Body |
|---|---|---|
| read / update / delete succeeded | 200 | the action's return value, bare |
| create succeeded (POST) | 201 | the created entity |
| `ZodError` | 400 | `{ error: "Invalid request.", issues }` |
| `BadRequest` | 400 | `{ error }` |
| `NotFoundError` | 404 | `{ error }` verbatim |
| `RuleViolation` | 409 | `{ error }` verbatim |
| anything else | rethrown → 500 | — |

### Success bodies are bare; error bodies are `{ error }` with the message verbatim

**Does a list route wrap its result in an envelope, and what shape do errors
take?** No envelope: exactly what the action returned, arrays for lists and
objects for entities. Errors are `{ error: string }` for `NotFoundError`,
`RuleViolation` and `BadRequest`, and `{ error: "Invalid request.", issues }`
for a `ZodError`.

Product spec §9 requires `RuleViolation` text to reach the user unaltered, and
US-F3.4 has the agent relay the same string — so a 404 or 409 body must never
be reworded or rewrapped. A `ZodError` is the one case with more to say: its
`issues` array is what a future form UI maps onto fields, which a bare string
cannot support. Enveloping success responses would be transport-layer reshaping
the plan never asks for, and Phase 3's UI plus Phase 4's tools would then each
have to unwrap it identically.

### POST returns 201; DELETE returns 200, never 204

**What status does a successful create and a successful delete return?** 201
with the created entity, and 200 with the summary body the action already
produces (`{ id, name }` or `{ id, title }`).

201 is the correct transport semantic for creation and costs one option
argument on `respond()` — exactly the kind of thing the transport layer exists
to own. Every delete action already returns a confirmation payload that both
consumers want (the agent relays "deleted 〈title〉" verbatim, §9); discarding it
to satisfy 204 would throw away data the action layer deliberately produces.

### The URL path segment always wins over a same-named body key

**PATCH `/api/tasks/<a>` with a body containing `{ taskId: <b> }` — which
wins?** The URL, unconditionally. Handlers build schema input as
`{ ...body, pathParam }`.

The address is what the client asked for and what any log, proxy or cache key
records; a body key that disagrees is at best redundant and at worst an attempt
to act on a different entity than the one addressed. Spread order makes this a
single unmissable line rather than a comparison branch that could be forgotten
in one file out of nine. `tests/api/suites/projects.ts` asserts it directly —
renaming through the URL while the body names a bystander leaves the bystander
untouched.

### The nested `[projectId]` segment is enforced, via existing read actions

**`updateStatusSchema` and `deleteStatusSchema` carry no `projectId`, so does
`/api/projects/[projectId]/statuses/[statusId]` verify that the URL's project
owns the status?** Yes — `lib/api/scope.ts` (`requireStatusInProject`,
`requirePriorityInProject`) raises `NotFoundError` (404) when the id is not in
that project's list.

Without it the `[projectId]` segment enforces nothing, `PATCH
/api/projects/<any-project>/statuses/<id>` silently succeeds, and the nested
REST shape §2.3 mandates is a lie that Phase 3's UI would then be built on top
of. This is **address resolution** — "is this id reachable at this address" —
not a second enforcement of §7 rule 2 ("a task's status must belong to the
task's project"), which is a different question answered in
`lib/actions/tasks.ts`.

What keeps it on the right side of that line is the implementation: it calls
the existing `listStatuses` / `listPriorities` actions rather than issuing its
own SQL, so the route layer still touches no database. It runs **after**
`schema.parse()`, so a malformed id is a 400 and only a well-formed
wrong-scope id is a 404.

### A collection GET for an unknown project is `200 []`, not 404

**Should `/api/projects/<unknown-uuid>/statuses` 404, for symmetry with the
item-level scope check?** No.

`listStatuses` / `listPriorities` report absence as emptiness by design, and
inventing a project-existence probe in the route would add a read the action
layer deliberately does not do, purely to manufacture a distinction. The
asymmetry is defensible because the two questions differ: "does this project
exist" is not "is this id reachable under this project". Note that POST to the
same collection *does* 404, because `createStatus` / `createPriority` already
raise `NotFoundError` for an unknown project — the route adds nothing either
way.

### Routes call `schema.parse()` themselves

**Do routes parse, or hand raw transport input to the action and let its
internal re-parse produce the error?** Routes parse explicitly, before calling
the action.

It matches the phase brief's literal pipeline (parse → validate with the shared
schema → call the action) and hands the action a properly typed value, avoiding
an `as` cast at every call site since action parameters are typed as the
schema's inferred output rather than `unknown`. Phase 1 already documented that
the action's re-parse of an already-valid object is free and always succeeds,
so the duplication is by design, not an oversight.

Every `parse()` call sits **inside** the `respond()` callback, so its `ZodError`
is caught rather than escaping as a 500.

### Chat state gets its own schema + action, outside both barrels

**`chat_state` has a table but no action. Does `GET/PUT /api/chat-state` get a
thin pair, or read and write the table directly in the route?** Its own pair —
`lib/schemas/chat-state.ts` + `lib/actions/chat-state.ts` — **deliberately not
exported from `lib/actions/index.ts` or `lib/schemas/index.ts`**. The route
imports both files directly.

The pair keeps the architecture's one hard invariant true without exception:
zero direct database access under `app/api/**`. Excluding it from the barrels
keeps those files' own doc comments literally accurate — "one function per
product-spec §5 capability", "the parity contract shared with EVE tools" — and
chat state is neither. It also protects a mechanical claim already published in
`docs/verification/phase-1/07-capability-parity.txt`: 19 action functions and
19 input schemas in 1:1 name correspondence. A twentieth non-capability barrel
entry would silently falsify that count for every later phase that re-runs the
check.

*Not chosen: direct DB access in the route as a documented exception* — one
exception is all it takes for "no database under `app/api/`" to stop being a
grep-able invariant.

### `getChatState` returns an empty snapshot rather than 404

**Does an absent `chat_state` row raise `NotFoundError`?** No. It returns
`{ events: [], session: null, updatedAt: null }`, so `GET /api/chat-state`
never 404s.

An empty conversation is a legitimate application state — the very first page
load, and the state after any reset. Making the caller catch a 404 to discover
"there is no chat yet" would push branching into every consumer for a case that
is not an error.

### `putChatStateSchema` validates the envelope only

**How deeply is the snapshot validated?** `events` is an array of `unknown`;
`session` is a string-keyed record or `null`. Nothing about their interiors.

The shape of an EVE event and of a session cursor belongs to the agent runtime,
which this project's own notes describe as young and evolving; encoding it here
would produce a validator that starts rejecting valid payloads on the next EVE
upgrade. Nothing in product spec §7 constrains the snapshot's contents, so this
layer owns only the envelope. `strictObject` still applies, so an unknown
top-level key is a loud 400.

### `putChatState` sets `updatedAt` explicitly — build time

**Does drizzle's `$onUpdate` cover the upsert?** No, and this is the one thing
in the phase that would have silently produced wrong data.

`$onUpdate` fires for `.update()`, not for the `set` clause of
`onConflictDoUpdate`. Without an explicit `updatedAt: new Date()` in that
clause, the column would keep the timestamp of the very first insert forever
while `events` changed underneath it — a stale value that nothing would have
failed on. The unit test asserts the timestamp advances across two writes.

### `z.stringbool()` coerces `?includeCompleted=`, in the route only

**How does a query string become the boolean `listTasksSchema` expects?**
`z.stringbool().parse(value)` inside `app/api/tasks/route.ts`. Not a new shared
schema.

Zod 4.4.3 — already an allowed dependency, and verified present in the
installed build — ships exactly this primitive, it accepts the spellings a URL
actually carries (`true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off`), and a bad value
throws a `ZodError` that flows through the same 400 branch as everything else.
It is genuinely transport-only: an EVE tool always emits a real boolean, so
promoting it to `lib/schemas/` would put URL-string handling into the
model-facing parity contract for no reason.

### An empty query-string value means "not provided"

**What does `?project=&status=&q=` do — the literal form §2.3 writes?** Every
value that is empty or whitespace-only after trimming is treated as absent, for
all five task filters.

Otherwise `?q=` sends `search: ""` into a `.min(1)` schema and 400s — and a UI
that binds filters to form inputs emits exactly that shape on every cleared
field. §2.3's own example writes all five params with empty values, which is at
minimum a hint that empty must be harmless.

### Dynamic params are typed inline, not with `RouteContext`

**Next 16 exposes both `{ params: Promise<{...}> }` and a global
`RouteContext<'/route/literal'>` helper. Which?** Inline, awaited in the
handler.

The installed docs state plainly that `RouteContext` is generated during
`next dev` / `next build` / `next typegen`. `pnpm typecheck` is a bare
`tsc --noEmit`, so on a clean checkout — or in CI before a build — the helper
does not exist and typecheck would fail. The inline form needs no codegen, is
what the docs' primary example shows, and still gets the v15.0.0-RC breaking
change right (`context.params` is a Promise).

### No route-segment config anywhere

**Do handlers declare `export const dynamic = "force-dynamic"`?** No, in any
file.

Next 16 route handlers are uncached and dynamic by default — static-by-default
for GET was removed in v15.0.0-RC — so the export would be noise, exactly as
`app/api/health/route.ts` already documents in its own comment.

### One server for the whole `tests/api` run

**How does `tests/api` isolate database state when the system under test is a
real HTTP server in a separate process, so `tests/support/db.ts`'s rolled-back
transactions are invisible?** One `next dev` server for the entire run, booted
and torn down by `tests/api/index.test.ts` — the only file matching the
`test:api` glob — which registers root `before`/`after` hooks and then calls
`register*Suite()` functions exported by `tests/api/suites/*.ts`. Fixtures are
real committed rows created through the API with uniquely-suffixed names,
hard-deleted in teardown (FK cascade).

Spawning one `next dev` per test file would put up to six concurrent processes
on a single `.next/` build directory — cache thrash and possible corruption, a
correctness hazard rather than a speed trade-off. Collapsing to one file also
makes the singleton `chat_state` row race-free for free, since `node:test` runs
one file's tests sequentially.

Isolation therefore comes from **ownership** rather than rollback: no suite ever
reads, updates or deletes a row it did not create, which is the same discipline
`tests/unit/` already follows and is what lets both suites share a database.

Registering `before`/`after` *before* the `register*Suite()` calls removes any
ambiguity about whether root hooks wrap describes contributed by imported
modules — and is why the suite modules export register functions instead of
calling `describe` at import time, since static imports evaluate first.

### `next dev`, not a production build

**Does `tests/api` run against `next dev` or `next build && next start`?**
`next dev`.

A full production build per test run would dominate the suite's cost, and
production-build fidelity is explicitly the E2E suite's job (plan §4.3), not
this phase's. Route handlers behave identically in both modes here — they carry
no route-segment config, and Next 16 makes them dynamic by default.

### The dev-vs-test guard moved into `lib/db/urls.ts`

**How is the guard shared between `tests/unit` and `tests/api` without
importing `tests/support/db.ts`?** Lifted into `lib/db/urls.ts` as an exported
`resolveTestDbUrl()`; `tests/support/db.ts` now imports it instead of defining
its own copy, and `tests/api/support/db.ts` is a side-effect-light pool module
exposing an explicit `closeApiTestDb()` and registering no hooks.

`tests/support/db.ts` registers `after(close pool)` at **import time**, so any
root `after` registered later — including fixture cleanup — would run against an
already-closed pool. Giving `tests/api` its own handle makes teardown order
explicit and correct: `cleanupFixtures()`, then `closeApiTestDb()`, then
`stopApiServer()`. There is still exactly one copy of the guard, so it cannot
drift. `lib/db/urls.ts` is the natural home — resolving and guarding database
targets is already its entire job, and `scripts/reset.ts` applies the same
check.

### The test-database claim is observed, not assumed

**How is it proven that the spawned server writes to the test database and
never the dev one?** Three layers, the last of which does not depend on any
library's internal behaviour.

1. The spawn env sets `DATABASE_URL` to `resolveTestDbUrl()`, which throws
   outright if it equals `process.env.DATABASE_URL`. It travels in `env`, never
   on the command line, so no credential can reach a process listing.
2. `@next/env` does not overwrite a variable already present in `process.env` —
   verified by reading the installed compiled source, not recalled.
3. `assertServerUsesTestDatabase()` runs in the root `before` hook immediately
   after boot: it creates a sentinel project through the API, reads it back
   through the `tests/api` database handle, and aborts the entire run if it is
   not visible — **before a single fixture row is written**.

A configuration mistake here would write to the user's dev database, which is
the single worst failure this phase could produce (plan §8 risk 11). A guard
that rests on a library's internals needs a runtime check that does not, and the
sentinel doubles as verification evidence — an observation rather than an
assurance.

### No bulk-task route

**Do `bulkUpdateTasks` / `bulkDeleteTasks` get endpoints?** No. Only the exact
§2.3 route table is built.

§2.3 lists no bulk route, and the phase brief warns against adding or removing
capability at the transport layer; adding one would be a silent redesign of the
agreed plan. The actions remain fully unit-tested and become EVE tool surface in
Phase 4.

### No `package.json` change

**Does `test:api` need `--test-concurrency=1`, as `test:e2e` already carries?**
No — nothing in `package.json` changed.

`tests/api` collapses to a single test file, so there is nothing to serialize
across files, and within a file `node:test` already runs tests sequentially. The
restriction `test:e2e` needs exists because agent-browser and model resources
are shared, which does not apply here. All required scripts already exist and
already stack the correct `--env-file` flags.

### Fixture tasks are inserted directly, not through `POST /api/tasks`

**Blocked-delete coverage for projects, statuses and priorities needs a task to
exist, but those suites run before the task routes were built. Through which
path?** `createFixtureTask` in `tests/api/support/fixtures.ts` inserts the row
through the test database handle.

Besides resolving the build ordering, it means a delete-block assertion cannot
fail for a reason that lives in the *task* endpoint — the same reasoning
`seedTask` in `tests/unit/actions/projects.test.ts` already applies. Fixture
*projects*, by contrast, are created through the API, so `POST /api/projects`
is exercised as a side effect of every suite's setup.

### Rule-violation messages are asserted in full, never by fragment

**How closely do the API tests pin the `RuleViolation` strings?** Full-string
equality, every time, and the seeded default names come from
`lib/domain/defaults.ts` rather than being hardcoded.

These strings are a product deliverable under §9 and US-F3.4, not incidental
prose. A fragment regex would let a reworded remedy sentence pass unnoticed;
full equality means a change to them has to be a deliberate, visible edit in
both the action and the test. If one of these assertions fails, the fix is to
re-read the action and update the assertion — never to loosen the match.

### The parity re-count excludes `common.ts` field schemas — build time

**Phase 1 published "19 schemas", but `lib/schemas/index.ts` also re-exports
five field schemas from `common.ts`, which counts naively to 24. Which number
does the Phase 2 evidence print?** 19, with the exclusion stated inline in
`docs/verification/phase-2/06-route-capability-map.txt` rather than applied
silently.

The published claim is about *capability* schemas standing in 1:1
correspondence with *capability* actions. Counting `idSchema`, `nameSchema` and
their siblings would make the Phase 2 number disagree with Phase 1's for a
reason that has nothing to do with Phase 2, obscuring the only thing the
re-count exists to show: that chat state stayed out of both barrels and the
correspondence is still 19 ↔ 19. A count whose method is invisible is not
evidence, so the harness prints what it excluded.

### Neon endpoint hostnames are redacted in the evidence — build time

**`09-test-db-isolation.txt` proves the dev and test databases differ by naming
them. Are the real endpoint IDs committed?** No — they are substituted for
`ep-DEV-ENDPOINT-REDACTED` / `ep-TEST-ENDPOINT-REDACTED` as the file is
written, following the convention commit `174bc1e` established.

That commit exists precisely because this repository is public and earlier
packets leaked live endpoint identifiers. Redaction costs the evidence nothing:
what it depends on is that the two targets are demonstrably *different* and that
the guard fires when they are made identical, both of which survive
substitution. No connection string, password or API key appears anywhere in the
packet — every database-identifying line goes through `describeDbUrl()`.

---

## Assumptions

**`@next/env` does not overwrite an environment variable already present in the
child's env.** Verified by reading
`node_modules/.pnpm/@next+env@16.2.6/.../dist/index.js`: `processEnv()`
snapshots `initialEnv` on first call and assigns a parsed value only when the
snapshot has no entry for that key. *If wrong:* the server would talk to the dev
database, and `assertServerUsesTestDatabase()` aborts the run before any fixture
is written. Recovery would be launching the child with a purpose-built
`--env-file`, or unsetting `DATABASE_URL` in the child and having
`lib/db/client.ts` read an explicit test variable.

**`next dev` boots and serves `/api/health` within 120 seconds, and per-route
first-request compile latency is tolerable inside `node:test`.** Observed at
roughly 4 seconds to healthy on this machine; the ceiling is deliberately
generous for a cold first compile, and `node:test` applies no default per-test
timeout. *If wrong:* the health poll throws with the captured child
stdout/stderr attached, so the failure is legible rather than a hang.

**Killing the detached process group stops `next dev` and everything it
forked.** The child is spawned with `detached: true`, making it a group leader.
Confirmed empirically — no `next dev` process survives a run, including the run
that failed mid-`before`. Mitigated further by the SIGKILL escalation after 10
seconds and by allocating a fresh free port every run.

**The test database has been migrated before `pnpm test:api` runs.** Phase 1's
unit suite already requires this, and the harness only treats the server as
ready when `/api/health` reports `ok: true`, which requires
`migrations === "current"`. *If wrong:* the poll never succeeds and the harness
fails with the child's output attached; no test runs against a half-migrated
schema.

**Running `pnpm test` (both globs, in parallel processes, against the same test
database) does not deadlock.** `tests/unit/db/seed.test.ts` calls `withEmptyDb`,
which deletes every row inside a rolled-back transaction with
`lock_timeout = '5s'`, while the API suite holds committed fixture rows. Both
sides hold locks briefly, so the realistic worst case is a short wait.
*If wrong:* a lock timeout, intermittently. The phase's stated exit criterion is
`pnpm test:api` alone, so the fallback is running the two globs as separate
commands; a durable fix would be `--test-concurrency=1` on the combined script,
a `package.json` change deliberately deferred until the flake is observed.

**`tests/unit/actions/chat-state.test.ts` and the API chat-state suite do not
contend over the singleton row.** Both hold the row lock only for a single short
statement or transaction, and only these two files touch `chat_state`. Same
symptom and same fallback as above.

**One extra pooled connection (`max: 2`) alongside the spawned server's own pool
stays within the Neon test project's limit.** `tests/support/db.ts` already runs
at `max: 2` against the same project. *If wrong:* drop
`tests/api/support/db.ts` to `max: 1` — it is used only for the sentinel check,
the direct task fixtures, and teardown deletes.

**`Response.json` serializes `Date` values to ISO strings**, so `updatedAt` and
every `createdAt` arrives at the client as a string. `Response.json` uses
`JSON.stringify`, which invokes `Date.prototype.toJSON`. Only test assertions
are affected; the fix for a mismatch is in the suite, not the routes.

---

## Deviations from the implementation plan

**Two things exist that the plan does not name, neither of which adds a
dependency and neither of which moves a rule out of `lib/actions/`.**

1. **`lib/api/`** — `respond.ts`, `request.ts`, `scope.ts`. The plan says route
   handlers are thin wrappers but does not say where the shared mapping lives.
   Roughly twenty handlers would otherwise hand-copy the same four-branch catch.
   Everything in this directory is transport plumbing: no product rule is
   decided here, and the only database access is indirect, through the existing
   read actions `scope.ts` calls.

2. **`lib/schemas/chat-state.ts` + `lib/actions/chat-state.ts`, outside the
   barrels.** §2.3 lists `GET/PUT /api/chat-state` but §2.1's "one schema and
   one action per capability" is scoped to product-spec §5 capabilities, which
   chat state is not. Giving it the same thin pair keeps "no database under
   `app/api/**`" exception-free; keeping it out of the barrels keeps the §5
   capability count honest.

**One process deviation from the phase's own build sequence.**
`app/api/projects/route.ts` landed in the harness commit rather than the
projects commit, because `assertServerUsesTestDatabase()` writes its sentinel
*through the API* and therefore needs a create endpoint to exist. Landing the
harness with no route at all would have meant committing a red suite. The
harness's first run then failed exactly as designed — server booted, health poll
passed, `fetch` worked, teardown was clean, and the only error was a 404 on
`POST /api/projects` — which isolated the risky part unambiguously, the whole
point of landing the harness on its own.

**`pnpm format` was run and then reverted everywhere outside this phase.** The
build sequence calls for a repo-wide format, but the current Prettier version
rewrites twelve pre-existing files Phase 2 never touched — mostly a missing
trailing newline and changed line wrapping — including four *published* Phase 1
verification-evidence harnesses under `docs/verification/phase-1/harness/`.
Rewriting those would edit the artifacts backing an already-published verdict,
and the churn would bury this phase's real diff in unrelated noise. Only Phase
2's own files are formatted; `prettier --check` on them is clean. The behaviour
is recorded as caveat 8 in the Phase 2 packet README so the next phase is not
surprised by it. A repo-wide reformat remains available as a deliberate,
standalone commit whenever someone wants to pay for it.

**No deviation on the route surface.** The ten `route.ts` files under
`app/api/` are exactly `/api/health` (pre-existing, untouched) plus the nine
paths §2.3 lists — no more, no fewer.

---

## Known gaps and what the next phase inherits

Everything in Phase 2's own scope was finished: `pnpm test:api` is 77/77 and
both exit criteria pass. The one item that must not be lost is inherited rather
than produced here.

### Carried forward: `pnpm test:unit` is not reliably green

Phase 2's handoff asserted `pnpm test:unit` at 130/130 and used Phase 1's suite
as its regression gate. Verification checked that claim and it **did not hold** —
128/130 on the first run of the verification session, 130/130 on the next five.
This is the sole failing criterion (G4) in
`docs/verification/phase-2/README.md`, and it is deliberately recorded as a fail
rather than a footnote: a suite that is green by luck cannot serve as a
regression gate.

The root cause is proved, not guessed. `tasks.created_at` is `DEFAULT now()`,
and Postgres `now()` is `transaction_timestamp()` — constant for an entire
transaction. Every fixture row built inside one `withRollback()` therefore
carries a byte-identical `created_at`, and `TASK_ORDER`'s final key,
`asc(tasks.createdAt)`, has no tie to break. The resulting row order is the
planner's choice, which the evidence demonstrates by flipping it with planner
settings alone on identical rows and an identical `ORDER BY`.

Two things follow, and they should not be conflated:

1. **The test-hygiene half.** Two Phase 1 tests in
   `tests/unit/actions/tasks.test.ts` assert a total order over a tied sort key.
   `tests/api/` does not share the defect — every HTTP request is its own
   transaction, so `created_at` values are genuinely distinct — which is
   verified in the packet rather than assumed.
2. **The product half, which is the more important one.** `TASK_ORDER` has *no*
   final deterministic tie-break such as `asc(tasks.id)`. Any two tasks that
   share a `created_at` will therefore sort arbitrarily in **both** interfaces,
   which makes this a parity risk under product-spec §5/§6 — the UI and the
   agent could legitimately disagree about list order — and not merely a flaky
   test.

Phase 2 deliberately did not fix it. It is Phase 1 code, the fix belongs in
`lib/actions/tasks.ts` rather than in a route, and a verification packet that
edits the code it is verifying stops being a verification packet. The
recommended remedy for whoever picks it up is to add a stable final tie-break to
`TASK_ORDER` and to keep the Phase 1 assertions strict once ordering is total.

### Other gaps

- **`app/page.tsx` is still the shadcn chat demo.** Nothing in the app calls
  these routes yet; rewiring is §2.5/§2.6 in Phase 3. The API is exercised only
  by `tests/api/`.
- **No E2E coverage in this phase.** The "no UI claim without a browser check"
  rule starts at Phase 3, and there is no UI here to check.
- **Product spec §7.6 (concurrent edits, last write wins) is only partly
  exercised.** `PUT /api/chat-state` demonstrates last-write-wins over a shared
  row, but the rule is really about the UI and the agent racing, and the agent
  interface does not exist until Phase 4.
- **`tests/api` writes committed rows to the test database.** They are cleaned
  up in teardown, but a run killed mid-suite (SIGINT) leaves fixture projects
  behind. They are harmless and uniquely named; `pnpm db:reset:test` clears
  them.
- **The scope check costs one extra list read per item-level status/priority
  write.** Deliberate — it buys the nested URL its meaning — and irrelevant at
  this scale, but it is a real second query where the plan's "thin wrapper"
  wording implies none.

# Phase 2 — Verification packet

**Phase under test:** API routes (`app/api/**`, `lib/api/`, `tests/api/`)
**User stories under test:** none directly — Phase 2 is infrastructure, so its **exit criteria and scope statements are the checklist** (see [Why there is no story table](#why-there-is-no-story-table))
**Verified:** 2026-07-28 · branch `phase-2-api-routes` @ `ac8c388`, no source file changed during verification · Node v24.10.0 · pnpm 10.18.3 · Next 16.2.6 · zod 4.4.3 · drizzle-orm 0.45.2 · two separate Neon Postgres projects

**Overall verdict: PASS on every Phase 2 exit criterion — with one failing check that is not a Phase 2 criterion and must not be lost.**

Every command in this packet was re-run from scratch for it; nothing is carried over or paraphrased. `pnpm test:api` is **77 tests, 77 pass, 0 fail** against a real `next dev` server talking to a genuinely separate Neon project, and the route surface, layer boundaries, dependency diff and database isolation all hold up under mechanical checking. The one thing that did **not** hold up is a claim the phase handoff made in passing: `pnpm test:unit` is **not** reliably 130/130. It failed 2 tests on the first run of this session and passed on the next five. The failing tests are Phase 1's, over Phase 1's action code, and the root cause is proved in [`11`](#11) — `tasks.created_at` is `DEFAULT now()`, which is constant for a whole transaction, so fixtures built inside one `withRollback()` share an identical sort key and `asc(tasks.createdAt)` has no tie to break. Phase 2 did not cause it and `tests/api/` does not share it, but a suite that is green by luck cannot serve as the regression gate it is being used as, so it is recorded as a **fail** below rather than footnoted.

Because "green tests" is exactly the kind of claim a packet exists to distrust, the rest of the run does not stop at transcripts either.

It proves the tests never touched the dev database by **observing** it rather than trusting configuration: a project written through the spawned server's own API is read back from two independent connections and is present in the test database and absent from the dev one ([`09`](#09)). The same file shows the guard refusing outright when the two URLs are made identical. This matters because a mistake here writes to the user's working database, and the mechanism it rests on — `@next/env` declining to overwrite a variable already in `process.env` — is a library internal, so it is backed by a runtime sentinel that runs in the root `before` hook **before a single fixture row is written**.

Rather than quoting source for the "human-readable, verbatim error" requirement (product-spec §9, US-F3.4), it triggers every error branch live against a running server and prints what the wire actually said ([`05`](#05)) — including the 400 bodies, whose `issues` array is what a future form UI will map onto fields.

The structural claims are mechanically counted rather than asserted: the route surface is **exactly the nine paths and nineteen verbs of plan §2.3** plus the pre-existing `/api/health`, with no route-segment config anywhere ([`06`](#06)); **no handler under `app/api/` imports a database** or constructs a `RuleViolation`/`NotFoundError` ([`07`](#07)); Phase 1's published **19-actions ↔ 19-schemas** parity count is unchanged, because chat-state was deliberately kept out of both barrels ([`06`](#06)); and there is **zero dependency change** — a 0-line diff across `package.json` and `pnpm-lock.yaml` for the whole phase, with no rejected library imported anywhere ([`08`](#08)).

Read [Method and caveats](#method-and-caveats) before treating any pass mark as unqualified.

---

## Results

| # | Source | Criterion (verbatim) | Result | Evidence |
|---|---|---|---|---|
| E1 | Phase exit | `pnpm test:api` green | **pass** — 77 tests, 77 pass, 0 fail, 0 skipped, 0 todo | [`01-test-api.txt`](./01-test-api.txt) |
| E2 | Phase exit | the capability set is exercisable end-to-end against a seeded DB | **pass** — all 19 §2.3 route+verb combinations have a covering suite driving them over real HTTP against a migrated Neon database | [`06`](./06-route-capability-map.txt), [`01`](./01-test-api.txt) |
| E3 | Evidence req. | full `pnpm test:api` run output, **including the tests that assert rule-violation error bodies and status codes** | **pass** — full transcript; all seven 409 assertions compare the whole message by equality, not by fragment | [`01`](./01-test-api.txt), [`05`](./05-rule-violation-bodies.txt) |
| S1 | Phase scope | Routes exactly per plan §2.3, including `/api/chat-state` (GET/PUT). `/api/health` already exists — do not duplicate it. | **pass** — 10 `route.ts` files: the 9 §2.3 paths plus health, untouched; 19 verbs exported against §2.3's 19 | [`06`](./06-route-capability-map.txt) |
| S2 | Phase scope | Each handler: parse → validate with the SHARED zod schema from `lib/schemas` → call the action → map result or RuleViolation to JSON with the right status code. **No business logic in routes.** | **pass, with one documented exception** — no input schema declared under `app/api/`; no DB import outside health; no error constructed in a handler. `GET /api/chat-state` takes no input at all and so parses nothing in the route; its action parses the schema instead | [`07`](./07-layer-boundaries.txt), [`06` §5](./06-route-capability-map.txt) |
| S3 | Phase scope | `PATCH /statuses/[id]` covers rename/reorder/toggle-completed; `PATCH /priorities/[id]` covers rename/reorder/set-default | **pass** — one consolidated handler each; all three modes have their own test per entity | [`06` §5–6](./06-route-capability-map.txt), [`01`](./01-test-api.txt) |
| S4 | Phase scope | `GET /api/tasks` supports `?project=&status=&priority=&q=&includeCompleted=` | **pass** — all five, combinable; `q` matches descriptions; `includeCompleted` string-coerced; garbage → 400; all-empty → unfiltered | [`01`](./01-test-api.txt), [`05` case 16](./05-rule-violation-bodies.txt) |
| S5 | Phase scope | `tests/api/` using `node:test` + the built-in `fetch` against a started server: transport mapping, status codes, blocked-delete error bodies. **No HTTP client library (§1.1).** | **pass** — only `node:*` built-ins, the global `fetch`, and drizzle-orm for teardown | [`08`](./08-dependency-policy.txt), [`01`](./01-test-api.txt) |
| G1 | Ground rules | Dependency policy §1.1 is binding — no new runtime or dev dependency | **pass** — 0-line diff in `package.json` + `pnpm-lock.yaml` over 11 commits; 16 rejected libraries checked by name, none imported | [`08`](./08-dependency-policy.txt) |
| G2 | Ground rules | Tests must never run against the dev database; the harness must refuse to start if they match | **pass** — proven by observation from both databases, plus the guard refusing when sabotaged | [`09`](./09-test-db-isolation.txt) |
| G3 | Ground rules | `pnpm typecheck` and `pnpm lint` clean | **pass** — typecheck exit 0; lint 0 errors, the same 2 pre-existing warnings | [`03`](./03-typecheck.txt), [`04`](./04-lint.txt) |
| G4 | Handoff claim | "`pnpm test:unit` is 130/130" — Phase 1's suite as a Phase 2 regression gate | **FAIL** — 128/130 on the first run of this session, 130/130 on the next five. Two Phase 1 tests assert a total order over a tied sort key | [`02`](./02-test-unit.txt), [`10`](./10-unit-suite-flake.txt), [`11`](./11-order-tiebreak-rootcause.txt) |
| R1 | product-spec §7 | rules are enforced in `lib/actions/` and **never re-checked** downstream | **pass** — the only error construction outside `lib/actions/` is `lib/api/scope.ts`'s address check, which resolves through existing read actions and touches no database | [`07` §2–3](./07-layer-boundaries.txt) |

**G4 is the only fail, and it is not a Phase 2 exit criterion.** Phase 2's exit criteria are E1 and E2, and both pass. G4 is included because the handoff asserted it, the packet checked it, and the assertion did not hold.

### Why there is no story table

The phase brief states it outright: *"User stories that must demonstrably pass: none directly — this phase is infrastructure; its exit criteria are the acceptance test."* Epics B–E describe UI behaviour, and after Phase 2 `app/page.tsx` is still the shadcn chat demo. What Phase 2 owes those epics is a *substrate* they can be built on, which is what E2 and S4 check: every filter US-B3 needs is combinable, every blocked-delete message US-C3/D2/E2 must show is reachable verbatim over HTTP.

---

## Evidence, criterion by criterion

<a id="01"></a>
### E1 / E3 — `pnpm test:api` · [`01-test-api.txt`](./01-test-api.txt)

One `next dev` server for the whole run; 19 suites, 77 tests.

```
ℹ tests 77
ℹ suites 19
ℹ pass 77
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 73715.048167
EXIT_CODE=0
```

The named evidence requirement is specifically *the tests that assert rule-violation error bodies and status codes*. Those are the following, lifted from the transcript with their ms timings stripped:

```
  ✔ answers 409 with the verbatim block message while a task remains
  ✔ answers 409 while a task still uses the status
  ✔ answers 409 for the last remaining status
  ✔ answers 409 while a task still uses the priority
  ✔ answers 409 for the last remaining priority
  ✔ answers 409 for a status belonging to another project
  ✔ answers 409 for a priority belonging to another project
  ✔ answers 404 with the action's own message for an unknown id
  ✔ answers 404 when the status belongs to a different project
  ✔ answers 404 when the priority belongs to a different project
  ✔ answers 400 for a malformed id segment, before any lookup
  ✔ answers 400 for a malformed status segment, before the scope check
  ✔ answers 400 for an uncoercible includeCompleted
  ✔ answers 400 for a projectId in the body — immutability
```

They compare the **whole message**, not a fragment — for example `tests/api/suites/projects.ts:196`:

```ts
      assert.equal(blocked.status, 409)
      assert.equal(
        blocked.body.error,
        `Project '${project.name}' still has 1 task. Delete or move those ` +
          `tasks first, then delete the project.`
      )
```

<a id="05"></a>
### E3 — what the wire actually says · [`05-rule-violation-bodies.txt`](./05-rule-violation-bodies.txt)

A live transcript, not a quotation: 16 branches triggered against a running server, each printed with its status code and raw body. Five 409s, three 404s, seven 400s, and the 200 proving an all-empty query string is a no-op.

```
[1] 409 RuleViolation — delete a project that still has tasks (§7.3)
    DELETE /api/projects/b8e1c78b-037d-4a8c-a129-e01bd4a4aa98
    -> 409
    {"error":"Project 'Design 1dad5158' still has 1 task. Delete or move those tasks first, then delete the project."}

[3] 409 RuleViolation — delete the last remaining status (§7.5)
    DELETE /api/projects/bc711446-98ce-4fa4-a4b8-a0e2342a32ca/statuses/363d59e7-3606-469a-b909-dfb5b8a54ed3
    -> 409
    {"error":"'To Do' is the only status in 'Solo 83019390'. Every project must keep at least one status, so it cannot be deleted. Create another status first."}

[8] 404 — a real status addressed under the wrong project (scope guard)
    PATCH /api/projects/1980f4c0-d3a9-4b19-8ae9-fa23ec40749e/statuses/3c73fe11-01d2-443d-b360-af8a1e9e6486
    body: {"name":"Hijacked"}
    -> 404
    {"error":"No status with id 3c73fe11-01d2-443d-b360-af8a1e9e6486 in project 1980f4c0-d3a9-4b19-8ae9-fa23ec40749e."}

[10] 400 ZodError — unknown key (strictObject)
    POST /api/projects
    body: {"name":"Website","colour":"blue"}
    -> 400
    {"error":"Invalid request.","issues":[{"code":"unrecognized_keys","keys":["colour"],"path":[],"message":"Unrecognized key: \"colour\""}]}
```

Harness: [`harness/rule-bodies.ts`](./harness/rule-bodies.ts).

<a id="06"></a>
### E2 / S1 / S3 — the surface is exactly §2.3 · [`06-route-capability-map.txt`](./06-route-capability-map.txt)

```
=== 2. Count check ===
route.ts files under app/api/:            10
  of which pre-existing (health):         1
  added by Phase 2:                       9
paths listed in implementation-plan §2.3: 9
verbs listed in implementation-plan §2.3: 19  (2+2+2+2+2+2+2+3+2)
verbs exported by the nine Phase 2 files: 19

=== 3. No route-segment config anywhere (dynamic by default in Next 16) ===
(no matches — as intended)
```

Section 5 is parsed out of the handler source by [`harness/route-map.mjs`](./harness/route-map.mjs) rather than typed by hand — for each exported verb, the action it calls, the schema it parses, the scope guard it applies, and any non-200 success status:

```
app/api/projects/[projectId]/statuses/[statusId]/route.ts
  PATCH  action=updateStatus  schema=updateStatusSchema  scope=requireStatusInProject
  DELETE action=deleteStatus  schema=deleteStatusSchema  scope=requireStatusInProject
app/api/tasks/[taskId]/route.ts
  GET    action=getTask  schema=getTaskSchema
  PATCH  action=updateTask  schema=updateTaskSchema
  DELETE action=deleteTask  schema=deleteTaskSchema
```

S3 in particular: one consolidated `PATCH` handler per entity, with a test per mode —
`renames a status` / `reorders a status to a new 0-based position` / `toggles the completed flag`, and
`renames a priority` / `reorders a priority to a new 0-based position` / `moves the default flag so exactly one remains`.

Section 7 re-runs Phase 1's parity count:

```
  capability action functions in lib/actions barrel: 19
  capability input schemas in lib/schemas barrel:    19
  names in 1:1 correspondence:                       19
  chat-state present in either barrel?               false
```

<a id="07"></a>
### S2 / R1 — routes decide nothing · [`07-layer-boundaries.txt`](./07-layer-boundaries.txt)

```
=== 1. Database imports under app/api/ (expected: health only) ===
app/api/health/route.ts:1:import { sql } from "drizzle-orm"
app/api/health/route.ts:3:import { db } from "@/lib/db"
app/api/health/route.ts:7:} from "@/lib/db/migration-status"

=== 2. RuleViolation / NotFoundError CONSTRUCTION under app/api/ ===
(no matches — routes never invent a rule failure)

=== 4. No input schema is declared under app/api/ ===
$ grep -rnE "z\.object|z\.strictObject" app/api/
(no matches — every input schema comes from lib/schemas)
```

Two things this packet declines to gloss over, both visible in the file itself:

- `app/api/tasks/route.ts:26` holds one real zod expression, `z.stringbool()`. It is a URL-string coercion for `includeCompleted`, not an input contract — a URL carries strings, an EVE tool emits a real boolean — and keeping it in the transport layer is what stops URL handling leaking into the model-facing parity contract.
- `GET /api/chat-state` parses nothing in the route, because it has no body, no query and no dynamic segment. `getChatStateSchema` is still enforced, one layer down, at `lib/actions/chat-state.ts:44`. "Every handler parses a shared schema" is not literally true of that one handler, so S2 is marked *pass with one documented exception* rather than a clean pass.

<a id="08"></a>
### S5 / G1 — zero dependency change · [`08-dependency-policy.txt`](./08-dependency-policy.txt)

```
$ git diff 174bc1e..HEAD -- package.json pnpm-lock.yaml | wc -l
0
(0 = not one line of either file changed)

$ git log --oneline 174bc1e..HEAD | wc -l    # commits in the phase
11
```

Everything `tests/api/` imports from outside the repo:

```
import { after, before, describe, it } from "node:test"
import { asc, eq, inArray } from "drizzle-orm"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import assert from "node:assert/strict"
```

HTTP is the global `fetch`. Sixteen rejected libraries (`vitest`, `jest`, `playwright`, `cypress`, `dotenv`, `uuid`, `nanoid`, `date-fns`, `dayjs`, `supertest`, `axios`, `chai`, `sinon`, `node-fetch`, `got`, `superagent`) are checked by name; none is imported anywhere.

<a id="09"></a>
### G2 — the tests never touched the dev database · [`09-test-db-isolation.txt`](./09-test-db-isolation.txt)

```
Databases in play (host/database only — never a credential):
  dev  DATABASE_URL      -> ep-DEV-ENDPOINT-REDACTED-pooler.c-11.us-east-1.aws.neon.tech/neondb
  test resolveTestDbUrl() -> ep-TEST-ENDPOINT-REDACTED-pooler.c-10.us-east-1.aws.neon.tech/neondb
  identical? false

[1] assertServerUsesTestDatabase() — the suite's own interlock
    passed: a project written through the API was readable
    back through the test-database handle.

[2] POST /api/projects -> 201
    wrote id d5a09aff-2204-48a2-8d3e-52be549e1171

[3] the same id, seen from two independent connections
    rows in TEST (…TEST-ENDPOINT-REDACTED…): 1
    rows in DEV  (…DEV-ENDPOINT-REDACTED…): 0

    verdict: PASS — the spawned server's DATABASE_URL override
    survived .env.local; the dev database was never touched.
```

And the guard, sabotaged on purpose:

```
$ DATABASE_URL_TEST=$DATABASE_URL node --env-file=.env.local -e 'await import("./tests/api/support/db.ts")'
Error: Refusing to run tests: the test database URL is identical to DATABASE_URL. The test database must be a separate Neon project.
```

Harness: [`harness/db-isolation.ts`](./harness/db-isolation.ts).

<a id="03"></a>
### G3 — typecheck and lint · [`03-typecheck.txt`](./03-typecheck.txt) · [`04-lint.txt`](./04-lint.txt)

```
$ pnpm typecheck
> tsc --noEmit
exit=0

$ pnpm lint
/…/.remember/tmp/last-ndc.ts
  1:1  warning  Expected an assignment or function call and instead saw an expression
/…/app/layout.tsx
  1:10  warning  'Geist' is defined but never used
✖ 2 problems (0 errors, 2 warnings)
exit=0
```

Both warnings predate Phase 2 and are in files this phase did not touch; both were already recorded in the Phase 0r and Phase 1 packets.

<a id="10"></a>
### G4 — **FAIL**: `pnpm test:unit` is not reliably green · [`02`](./02-test-unit.txt), [`10`](./10-unit-suite-flake.txt), [`11`](./11-order-tiebreak-rootcause.txt)

First run of this verification session:

```
ℹ tests 130
ℹ suites 33
ℹ pass 128
ℹ fail 2
ℹ duration_ms 52246.871875

✖ failing tests:

test at tests/unit/actions/tasks.test.ts:457:3
✖ filters by priority, combinable with the project filter (2726.469375ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
  +   'High newer',
      'High older',
  -   'High newer'
    ]
```

…and the second failure, in the same file, is the same two rows the same way round:

```
test at tests/unit/actions/tasks.test.ts:475:3
✖ searches title and description, case-insensitively (2929.917625ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    [
  +   'High newer',
      'High older',
  -   'High newer'
    ]
 ELIFECYCLE  Command failed with exit code 1.
```

Six consecutive full-suite runs, same commit, nothing changed between them:

```
  run 1  tests 130  pass 128  fail 2   <-- FAILED
  run 2  tests 130  pass 130  fail 0
  run 3  tests 130  pass 130  fail 0
  run 4  tests 130  pass 130  fail 0
  run 5  tests 130  pass 130  fail 0
  run 6  tests 130  pass 130  fail 0
```

<a id="11"></a>
**Root cause**, proved in [`11-order-tiebreak-rootcause.txt`](./11-order-tiebreak-rootcause.txt) via [`harness/order-tiebreak.ts`](./harness/order-tiebreak.ts). `tasks.created_at` is `DEFAULT now()`; Postgres `now()` is `transaction_timestamp()` and is constant for the whole transaction:

```
--- 2. now() vs clock_timestamp() inside ONE transaction ---

  now()             (1st call) : 2026-07-28 19:18:56.981859+00
  now()             (2nd call) : 2026-07-28 19:18:56.981859+00
  -> identical?               : true
  clock_timestamp() (1st call) : 2026-07-28 19:18:57.034725+00
  clock_timestamp() (2nd call) : 2026-07-28 19:18:57.084797+00
  -> identical?               : false

--- 3. The same two fixture rows the failing tests build ---

  "High older" created_at : 2026-07-28T19:18:56.981Z
  "High newer" created_at : 2026-07-28T19:18:56.981Z
  -> tie on the ORDER BY key? : true
     (100 ms of real wall-clock time separates the two inserts, yet the
      values the sort reads are byte-identical.)
```

Every fixture row built inside one `withRollback()` therefore shares an identical `created_at`, and `TASK_ORDER`'s last key — `asc(tasks.createdAt)` — has nothing to break the tie with. That the resulting order is the planner's choice rather than the query's is shown directly: same rows, same `ORDER BY`, one setting changed.

```
--- 4. The order is the planner's choice, not the query's ---

    Same two rows, same ORDER BY, only the planner knobs change. If the
    ORDER BY determined the answer, every line below would be identical.

  default settings               ["High older","High newer"]
  enable_hashjoin = off          ["High older","High newer"]
  + enable_mergejoin = off       ["High older","High newer"]
  nestloop off / hashjoin on     ["High newer","High older"]
  + enable_seqscan = off         ["High newer","High older"]
```

An earlier run of the same probe flipped only on the last line rather than the
last two; which line flips is itself planner state, which is the point.

**Blast radius.** `tests/api/` does *not* share the defect — every HTTP request is its own transaction, so `created_at` values are distinct and the sort is total. Verified, not assumed:

```
--- 5. Does tests/api/ share the defect? No — and here is why ---

  "High older" created_at : 2026-07-28T19:18:59.847Z
  "High newer" created_at : 2026-07-28T19:19:00.371Z
  -> tie on the ORDER BY key? : false
  listTasks order            : ["High older","High newer"]
```

Production is likewise unaffected in practice, since tasks are created one request at a time. What remains for a later phase to decide: `TASK_ORDER` has **no** final deterministic tie-break (e.g. `asc(tasks.id)`), so any two tasks that do share a `created_at` will sort arbitrarily in *both* interfaces — which is a parity risk under product-spec §5/§6, not merely a test-hygiene one. This packet reports it and deliberately does not fix it; a verification packet that edits the code it is verifying is not a verification packet.

---

## Method and caveats

**Read these before treating any pass mark as unqualified.**

1. **`next dev`, not a production build.** Route handlers carry no route-segment config and Next 16 makes them dynamic by default, so dev and production behaviour should be identical here — but "should be" is doing work in that sentence. Production-build fidelity is the E2E suite's job (plan §4.3) and is not evidenced in this packet.

2. **Isolation is by ownership, not rollback.** The API server is a separate process, so `tests/support/db.ts`'s rolled-back transactions cannot reach it. `tests/api/` fixtures are **really committed** and hard-deleted in teardown. A run killed with SIGINT mid-suite leaves uniquely-named fixture projects behind; `pnpm db:reset:test` clears them. This also means the filter tests scope themselves to their own project or search a run-unique token — an unscoped "the list contains exactly N" assertion would be a flake waiting to happen.

3. **Endpoint hostnames are redacted.** [`09`](./09-test-db-isolation.txt) prints `ep-DEV-ENDPOINT-REDACTED` and `ep-TEST-ENDPOINT-REDACTED` in place of the real Neon endpoint IDs, following the convention established in commit `174bc1e`; the substitution is applied to the harness output when the file is written. What the evidence depends on — that the two are demonstrably different, and that the guard fires when they are not — is preserved. No connection string is printed anywhere; every DB-identifying line goes through `describeDbUrl()`.

4. **The isolation check is a check, not a proof of the mechanism.** It observes that a row written through the API landed in the test database. It does not independently verify *why* `@next/env` leaves an inherited `DATABASE_URL` alone; that was read out of the installed compiled source and is recorded as an assumption in [`../../decisions/phase-2-decisions.md`](../../decisions/phase-2-decisions.md).

5. **[`05`](./05-rule-violation-bodies.txt)'s transcript is one run's ids.** The UUIDs and the random name suffixes differ per run; the message *text* is what the assertions in [`01`](./01-test-api.txt) pin, by full-string equality.

6. **G4's failure is a sample, not a rate.** One failure in six runs is what was observed on one machine against one Neon instance on one afternoon. It establishes that the suite *can* fail; it does not establish how often, and nothing here should be read as "1 in 6".

7. **Two lint warnings are pre-existing and out of scope.** `app/layout.tsx`'s unused `Geist` import and a stray `.remember/tmp/last-ndc.ts` scratch file. Both predate Phase 2 and were recorded in Phase 0r and Phase 1.

8. **`pnpm format` was deliberately not run repo-wide** by the implementing phase, because it rewrites a dozen pre-existing files Phase 2 did not touch. Only Phase 2's own files are Prettier-formatted.

9. **§7.6 (last write wins) is only partly exercised.** `PUT /api/chat-state` demonstrates it over a shared row, but the rule is really about the UI and the agent racing, and neither interface exists yet. Recorded, not claimed.

10. **No browser evidence, by design.** Phase 2 produces no user-visible surface; `app/page.tsx` is still the shadcn chat demo. The §3.1 agent-browser loop begins in Phase 3, where the "no UI claim without a browser check" rule takes effect.

---

## Reproducing

```
pnpm db:migrate --target=test    # or pnpm db:reset:test   (prerequisite, once)

pnpm test:api                    # 01  — boots its own next dev server
pnpm test:unit                   # 02  — run it several times; see 10
pnpm typecheck                   # 03
pnpm lint                        # 04

node --env-file=.env.local --env-file-if-exists=.env.test \
  docs/verification/phase-2/harness/rule-bodies.ts         # 05
node --env-file=.env.local --env-file-if-exists=.env.test \
  docs/verification/phase-2/harness/db-isolation.ts        # 09
node --env-file=.env.local --env-file-if-exists=.env.test \
  docs/verification/phase-2/harness/order-tiebreak.ts      # 11

node docs/verification/phase-2/harness/route-map.mjs       # 06 §5
```

`06`'s other sections, `07` and `08` are greps and counts; the commands are printed inline in each file.

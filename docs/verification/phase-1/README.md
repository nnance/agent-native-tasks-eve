# Phase 1 — Verification packet

**Phase under test:** Shared action layer (`lib/db`, `lib/schemas/`, `lib/actions/`)
**User stories under test:** none directly — Phase 1 is infrastructure, so its own **exit criteria and scope statements are the checklist** (see [Why there is no story table](#why-there-is-no-story-table))
**Verified:** 2026-07-28 · branch `phase-1-shared-action-layer` @ `330e709` · Node v24.10.0 · pnpm 10.18.3 · drizzle-orm 0.45.2 · zod 4.4.3 · two separate Neon Postgres 17.10 projects
**Overall verdict: PASS — 12 of 13 criteria pass, 1 is not applicable to this phase (product-spec §7.6, concurrent edits, is an Epic G concern with no second interface to race against yet).**

Phase 1's headline number is real: `pnpm test:unit` runs **105 tests, 105 pass, 0 fail, 0 skipped, 0 todo**
against a genuinely separate Neon project, and `pnpm typecheck` and `pnpm lint` are clean (0 errors; the
same 2 pre-existing warnings Phase 0r recorded, in `app/layout.tsx` and a stray `.remember/` scratch file).
Because "green tests" is exactly the kind of claim a packet exists to distrust, this run does not stop at
the transcript. It proves the suite talks to a **real Postgres and not a mock** by writing a sentinel
project through the test suite's own database handle and then observing that row from a *separate*
connection — and confirming the same row is absent from the dev database ([`06`](#06)). It proves the
never-run-against-dev guard is load-bearing by pointing `DATABASE_URL_TEST` at the dev database and
watching the harness refuse to import ([`05`](#05)). It proves the isolation strategy by showing a project
created inside `withRollback` is visible in-transaction and gone afterwards, and that a full 105-test run
leaves **both** databases byte-for-byte identical, down to project ids and `created_at` ([`14`](#14)).
And rather than quoting the source for the "human-readable RuleViolation" requirement, it triggers every
§7 rule live and prints what the system actually says ([`10`](#10)) — for example
*"Project 'Design' still has 1 task. Delete or move those tasks first, then delete the project."*

The structural claims hold too, mechanically counted rather than asserted: **19 action functions and 19
input schemas, names in 1:1 correspondence, all 19 `z.strictObject`** ([`07`](#07)); `lib/domain/defaults.ts`
imported by `createProject` and its values never restated ([`08`](#08)); no `confirm`/`approve` parameter
anywhere in the action layer ([`08`](#08)); and **zero dependency change** — not one line inside
`dependencies`/`devDependencies` moved and `pnpm-lock.yaml` has a 0-line diff ([`09`](#09)).

One correction worth recording, because it is the reason to trust the rest: the first run of the rule
harness reported three apparent failures. All three were **bugs in the harness, not the product** — it read
`task.projectId`/`task.statusId` where `TaskView` nests them as `task.project.id`/`task.status.id`. The
harness was fixed to read the nested view *and* to assert project immutability against the raw
`tasks.project_id` column rather than the action's own re-derived output. The corrected run is what is
published. Read [Method and caveats](#method-and-caveats) before treating any pass mark as unqualified.

---

## Results

| # | Source | Criterion (verbatim) | Result | Evidence |
|---|---|---|---|---|
| E1 | Phase exit | `pnpm test:unit` green. | **pass** — 105 tests, 105 pass, 0 fail, 0 skipped, 0 todo | [`01-test-unit.txt`](./01-test-unit.txt) |
| E2 | Phase exit | Rules live here and are never re-checked downstream. | **pass** — every `RuleViolation` throw site is in `lib/actions/`; nothing downstream imports or duplicates a rule | [`11-no-downstream-recheck.txt`](./11-no-downstream-recheck.txt) |
| E3 | Evidence req. | full `pnpm test:unit` output showing every rule test passing **against the real test DB** | **pass** — real Neon project, proven by an independent-connection roundtrip, not inferred | [`01`](./01-test-unit.txt), [`04`](./04-db-identity.txt), [`05`](./05-guard-refuses-dev-db.txt), [`06`](./06-real-db-roundtrip.txt), [`15`](./15-rule-to-test-map.txt) |
| E4 | Evidence req. | plus `pnpm typecheck` and `pnpm lint` | **pass** — typecheck clean; lint 0 errors, 2 pre-existing warnings | [`02-typecheck.txt`](./02-typecheck.txt), [`03-lint.txt`](./03-lint.txt) |
| S1 | Phase scope | `lib/db/schema.ts` … `lib/db/client.ts` — the single connection. Both partly exist from Phase 0; **reconcile rather than duplicate**. | **pass** — one `postgres()` call site, one exported `db`, each table declared once; the only Phase 1 change is the `Database` type widening | [`16-db-layer-reconciled.txt`](./16-db-layer-reconciled.txt) |
| S2 | Phase scope | One Zod input schema per capability in product-spec §5, in `lib/schemas/`. | **pass** — 19 schemas, all `strictObject`, 1:1 with the actions | [`07-capability-parity.txt`](./07-capability-parity.txt) |
| S3 | Phase scope | One action function per capability in `lib/actions/`, enforcing every product-spec §7 rule: project immutability, per-project scoping, block-delete-if-in-use, minimum-one status/priority, default-priority reassignment, exactly-one-default. | **pass** — 19 actions; all six named rules fire live | [`07`](./07-capability-parity.txt), [`10-rule-messages.txt`](./10-rule-messages.txt), [`15`](./15-rule-to-test-map.txt) |
| S4 | Phase scope | Typed RuleViolation errors carrying human-readable messages (e.g. "Project 'Design' still has 4 tasks"). | **pass** — that exact message shape, cause **and** remedy, produced live | [`10-rule-messages.txt`](./10-rule-messages.txt) |
| S5 | Phase scope | Confirmation/approval is deliberately NOT in this layer. | **pass** — no `confirm`/`approve`/`dryRun` parameter exists; the only textual matches are comments saying so | [`08-layer-boundaries.txt`](./08-layer-boundaries.txt) |
| S6 | Phase scope | `tests/unit/` using `node:test` + `node:assert/strict` — NOT vitest. Cover every rule, every creation default, and seed idempotency, **against the real test database**, not mocks. | **pass** — only `node:test` and `node:assert/strict` are imported; no rejected library present | [`09-dependency-policy.txt`](./09-dependency-policy.txt), [`15`](./15-rule-to-test-map.txt), [`06`](./06-real-db-roundtrip.txt) |
| S7 | Phase scope | `lib/domain/defaults.ts` must be imported by `createProject`. | **pass** — imported and consumed; values never restated; verified against the database, not an echo | [`08`](./08-layer-boundaries.txt), [`06`](./06-real-db-roundtrip.txt) |
| S8 | Phase scope | `ensureSeeded(database = db)` … using it against a transaction would close the one untested combination (boot hook against an empty database). | **pass** — `tests/unit/db/seed.test.ts` drives `ensureSeeded(tx)` inside `withEmptyDb` | [`08`](./08-layer-boundaries.txt), [`15`](./15-rule-to-test-map.txt) |
| G1 | Ground rules | Dependency policy §1.1 is binding — no new runtime or dev dependency; test layout §4.1 (tests not colocated). | **pass** — 0-line `pnpm-lock.yaml` diff; no dependency line changed; no `*.test.ts` under `lib/` | [`09-dependency-policy.txt`](./09-dependency-policy.txt) |
| R6 | product-spec §7.6 | **Concurrent edits.** … **last write wins**, with no locking. | **not applicable to Phase 1** — this rule is about the UI and the agent racing; neither interface exists yet. Recorded, not claimed. | [`10-rule-messages.txt`](./10-rule-messages.txt) |

---

## E1 / E3 — `pnpm test:unit` green, against the real test database

**The run.** 105 tests across 27 suites, in ~53 s — the wall-clock alone is a tell that these are real
network round-trips to Neon rather than in-memory fakes. Tail of [`01-test-unit.txt`](./01-test-unit.txt):

```
ℹ tests 105
ℹ suites 27
ℹ pass 105
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52673.50025
EXIT=0
```

A green suite that skipped its way to green would look identical at a glance, so the `skipped 0` /
`todo 0` lines are load-bearing and are quoted deliberately.

<a id="04"></a>**The two databases are genuinely separate Neon projects**, both migrated —
[`04-db-identity.txt`](./04-db-identity.txt):

```
resolved dev  (DATABASE_URL)      -> ep-DEV-ENDPOINT-REDACTED-pooler.c-11.us-east-1.aws.neon.tech/neondb
resolved test (DATABASE_URL_TEST) -> ep-TEST-ENDPOINT-REDACTED-pooler.c-10.us-east-1.aws.neon.tech/neondb
same connection string?           -> false
same host?                        -> false

dev: …c-11… -> current_database=neondb user=neondb_owner PostgreSQL 17.10 migrations_applied=1
test: …c-10… -> current_database=neondb user=neondb_owner PostgreSQL 17.10 migrations_applied=1
```

<a id="05"></a>**The never-run-against-dev guard is load-bearing, not decorative.**
`harness/guard-refuses-dev.ts` points `DATABASE_URL_TEST` at the dev database — the exact mistake the
guard exists to catch — and then imports the real `tests/support/db.ts`. The guard throws during module
initialisation, before any connection is opened — [`05-guard-refuses-dev-db.txt`](./05-guard-refuses-dev-db.txt):

```
sabotaged: DATABASE_URL_TEST now resolves to ep-DEV-ENDPOINT-REDACTED-pooler.c-11…/neondb
sabotaged: identical to DATABASE_URL -> true

RESULT: import threw, as required.
  error name    -> Error
  error message -> Refusing to run tests: the test database URL is identical to DATABASE_URL.
                   The test database must be a separate Neon project.
```

<a id="06"></a>**Real Postgres, not mocks — proven from the outside.**
`harness/real-db-roundtrip.ts` uses the *suite's own* `testDatabase` handle and the *real* action
functions, then verifies the effects from independent connections opened straight from the resolved
URLs. Abridged from [`06-real-db-roundtrip.txt`](./06-real-db-roundtrip.txt):

```
-- createProject() through tests/support/db.ts's testDatabase (committed) --
   returned project -> { id: '5077faef-…', name: 'phase-1-verification-02e77c54-…' }

-- observed from an INDEPENDENT connection to the TEST database --
   rows found -> 1
   seeded statuses   -> [ '0:To Do', '1:In Progress', '2:Done (completed)' ]
   seeded priorities -> [ '0:Low', '1:Medium (default)', '2:High' ]

-- observed from an INDEPENDENT connection to the DEV database --
   rows found -> 0 (must be 0)

-- a real §7.3 RuleViolation, raised by the real database's own data --
   created task -> { id: '0ddf98f7-…', title: 'blocks the project delete' }
   threw -> RuleViolation
   message -> Project 'phase-1-verification-…' still has 1 task. Delete or move those tasks
              first, then delete the project.
   is RuleViolation -> true
```

That is the whole argument in one transcript: a write made through the test handle **appears in the test
database**, **does not appear in the dev database**, and a rule fires off data Postgres is actually
storing. The sentinel project and its task are then deleted, and both databases return to their baseline
counts in the same run.

The second half of the same file demonstrates the isolation strategy every test relies on:

```
== PART 2: withRollback isolation, the strategy every test uses ==
   inside the transaction, rows visible -> 1
   inside the transaction, seeded statuses -> 3
   after withRollback returned, rows on test DB -> 0 (must be 0)
   counts on test -> { projects: '1', statuses: '3', priorities: '3', tasks: '0' }
```

<a id="14"></a>**A full 105-test run leaves both databases untouched.** The database was dumped
immediately before and immediately after the published test run and the two dumps diff to nothing —
identical project ids and `created_at` timestamps on both sides
([`12`](./12-db-state-before.txt), [`13`](./13-db-state-after.txt), [`14-db-state-diff.txt`](./14-db-state-diff.txt)):

```
$ diff <(normalised 12-db-state-before.txt) <(normalised 13-db-state-after.txt)
  (no output — the two dumps are identical)

RESULT: 105 tests ran against the real test database and left
        both databases byte-for-byte unchanged. Project ids and
        created_at timestamps are identical before and after.
```

**Every rule maps to named, passing tests.** [`15-rule-to-test-map.txt`](./15-rule-to-test-map.txt) is
generated by grepping the run transcript verbatim, so the mapping cannot drift from what actually ran.
Excerpt:

```
## §7.5 Minimum lists — the last status/priority cannot be deleted, even if unused
    ✔ blocks deletion of the last remaining status even when unused (1964.366084ms)
    ✔ blocks deletion of the last remaining priority even when unused (1966.533834ms)
    ✔ reports last-remaining, not in-use, when both block at once (2056.014709ms)
    ✔ reports last-remaining, not in-use, when both block at once (2095.446583ms)

## Seed idempotency against a genuinely empty database (US-A1.5 — the Phase 0 gap)
    ✔ seeds the starter project with the documented defaults, exactly once (2199.298416ms)
    ✔ is a no-op when any project already exists, whatever it is named (829.3015ms)
    ✔ is named Personal (0.043917ms)
```

---

## E4 — `pnpm typecheck` and `pnpm lint`

Both were re-run **after** the verification harnesses were added, because `tsconfig.json` includes
`**/*.ts` and therefore typechecks and lints the harness files in `docs/verification/phase-1/harness/`
too. [`02-typecheck.txt`](./02-typecheck.txt):

```
> tsc --noEmit
EXIT=0
```

[`03-lint.txt`](./03-lint.txt):

```
/…/.remember/tmp/last-ndc.ts
  1:1  warning  Expected an assignment or function call and instead saw an expression  @typescript-eslint/no-unused-expressions
/…/app/layout.tsx
  1:10  warning  'Geist' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
EXIT=0
```

Both warnings pre-date Phase 1 and were already recorded in the Phase 0r packet; neither is in
`lib/` or `tests/`. An intermediate version of the rule harness added a third warning (an unused import);
it was removed rather than published, so the committed tree matches the transcript above.

---

<a id="10"></a>## S3 / S4 — every §7 rule fires, with a human-readable message

`harness/rule-messages.ts` builds fixtures in the real test database (inside a rolled-back transaction),
triggers each rule, and prints the error type and the message verbatim. Full output in
[`10-rule-messages.txt`](./10-rule-messages.txt); the messages themselves:

**§7.1 Project immutability** — enforced *structurally*. `updateTaskSchema` has no `projectId` field and
is a `strictObject`, so the attempt is a loud `ZodError`, not a silent no-op. The stored column is checked
directly, not the action's own re-derived view:

```
updateTask({ taskId, projectId: <Website> }) — moving a task between projects
  ZodError: [{"code":"unrecognized_keys","path":[],"message":"Unrecognized key: \"projectId\""}]
  task's stored project_id after the rejected attempt -> unchanged (still 'Design')
```

**§7.2 Scoped references:**

```
createTask with a status belonging to another project
  RuleViolation: Status 'To Do' belongs to a different project. A task in 'Design' can only
                 use that project's own statuses.

updateTask with a priority belonging to another project
  RuleViolation: Priority 'Low' belongs to a different project. A task in 'Design' can only
                 use that project's own priorities.
```

**§7.3 Delete-if-unused** — each message names the blocker *and* the remedy, as §7.3 requires:

```
deleteProject on a project that still has tasks
  RuleViolation: Project 'Design' still has 1 task. Delete or move those tasks first,
                 then delete the project.

deleteStatus on 'To Do', a status a task is using
  RuleViolation: Status 'To Do' is used by 1 task. Move those tasks to another status
                 (or delete them) first, then delete the status.

deletePriority on 'Medium', a priority a task is using
  RuleViolation: Priority 'Medium' is used by 1 task. Move those tasks to another priority
                 (or delete them) first, then delete the priority.
```

**§7.5 Minimum lists** — note the ordering choice: last-remaining is reported *before* in-use, because
the in-use remedy ("move those tasks to another status") is a dead end when it is the only one left:

```
deleteStatus on the project's last remaining status (unused)
  RuleViolation: 'To Do' is the only status in 'Solo'. Every project must keep at least one
                 status, so it cannot be deleted. Create another status first.

deletePriority on the project's last remaining priority (unused)
  RuleViolation: 'Low' is the only priority in 'Solo'. Every project must keep at least one
                 priority, so it cannot be deleted. Create another priority first.
```

**Exactly-one-default** — made inexpressible before it is enforced, then held across a move:

```
createPriority({ isDefault: true }) — the field does not exist on the schema
  ZodError: [{"code":"unrecognized_keys","path":[],"message":"Unrecognized key: \"isDefault\""}]

updatePriority({ isDefault: false }) — a default can never be un-set alone
  ZodError: [{"code":"invalid_value","path":["isDefault"],"message":"Invalid input: expected true"}]

after moving the default to 'High': Low, Medium, High (default)
  priorities flagged default -> 1 (exactly one)
```

**Default-priority reassignment on delete (US-E2.4):**

```
deletePriority on the current default ('High') …
  surviving priorities -> 0:Low (default), 1:Medium
  default moved to the survivor at order 0 -> yes
```

**§7.4 New projects usable immediately** — and this is also the live proof of S7, the
`lib/domain/defaults.ts` linkage, observed as database rows rather than as an import statement:

```
  seeded statuses  -> 0:To Do, 1:In Progress, 2:Done (completed)
  seeded priorities-> 0:Low, 1:Medium (default), 2:High
  a task created with no status/priority took -> To Do (first by order) / Medium (the default)
```

---

<a id="07"></a>## S2 / S3 — 19 schemas, 19 actions, 1:1

Counted mechanically in [`07-capability-parity.txt`](./07-capability-parity.txt) — the two name lists
correspond exactly, and every schema is a `strictObject` so an unknown key is an error rather than a
silent strip:

```
action count   -> 19
schema count   -> 19
strictObject occurrences -> 19
```

The 19 cover every product-spec §5 capability (tasks: list/get/create/update/delete; projects:
list/create/rename/delete; statuses and priorities: list/create/update/delete each), plus
`bulkUpdateTasks` / `bulkDeleteTasks` from the implementation-plan §2.4 tool inventory, which US-F5 needs.
"Move a task's status" and "reorder"/"set default" are folded into the consolidated `update*` actions
rather than given separate entry points — the grain the plan fixes in §1.

The `projectId` audit of `lib/schemas/tasks.ts` shows only two occurrences, in the `listTasks` filter and
in `createTask` — never in `updateTaskSchema`.

---

<a id="08"></a>## S5 / S7 / S8 — layer boundaries

From [`08-layer-boundaries.txt`](./08-layer-boundaries.txt).

**S5, no confirmation in this layer.** The grep for `confirm|approv|areYouSure|prompt(` across
`lib/actions/`, `lib/schemas/` and `lib/domain/` returns four hits, and all four are comments explaining
the absence:

```
lib/actions/projects.ts:16: * - No `confirm`, `dryRun` or `approve` parameter exists here. Confirmation is
lib/actions/projects.ts:17: *   per-interface UX — a dialog in the UI, an EVE approval gate for the agent
lib/actions/tasks.ts:422: * Both bulk capabilities sit behind an EVE approval gate (plan §2.4) whose
lib/actions/tasks.ts:423: * prompt renders the exact input, and US-F5.3 promises that on approval all
```

**S7, the defaults linkage.** `createProject` imports the constants and maps over them; the literal
values appear only in `lib/domain/defaults.ts`, so the seeded project and later-created projects cannot
drift:

```
lib/actions/projects.ts:32:import { DEFAULT_PRIORITIES, DEFAULT_STATUSES } from "../domain/defaults.ts"
lib/actions/projects.ts:83:      DEFAULT_STATUSES.map((status, index) => ({
lib/actions/projects.ts:92:      DEFAULT_PRIORITIES.map((priority, index) => ({
lib/db/seed.ts:56:      DEFAULT_STATUSES.map((status, index) => ({
lib/db/seed.ts:65:      DEFAULT_PRIORITIES.map((priority, index) => ({
```

**S8, the `ensureSeeded(tx)` gap.** The injectable handle is now exercised against a genuinely empty
database — `withEmptyDb` wipes every table *inside* the uncommitted transaction, so the boot hook meets
the empty-database case for the first time:

```
tests/unit/db/seed.test.ts:8:import { withEmptyDb } from "../../support/db.ts"
tests/unit/db/seed.test.ts:21:    await withEmptyDb(async (tx) => {
tests/unit/db/seed.test.ts:23:      const first = await ensureSeeded(tx)
tests/unit/db/seed.test.ts:52:      const second = await ensureSeeded(tx)
```

Both its tests pass in the published run (see [`15`](./15-rule-to-test-map.txt)).

---

<a id="11"></a>## E2 — rules are never re-checked downstream

This criterion is only partly falsifiable today, and the packet says so rather than overclaiming.
From [`11-no-downstream-recheck.txt`](./11-no-downstream-recheck.txt):

- Every `throw new RuleViolation` site in the repo is inside `lib/actions/` — 9 of them, across
  `projects.ts` (1), `statuses.ts` (2), `priorities.ts` (2), `tasks.ts` (4). None anywhere else.
- Nothing downstream imports `lib/actions` yet: the only files under `app/` are `api/health/route.ts`,
  `layout.tsx` and `page.tsx`, and `agent/` has no tools. The Phase 2 routes and Phase 4 tools that will
  consume this layer do not exist.
- The only downstream mention of rule vocabulary is **prose in `agent/instructions.md`**, telling the
  model what the rules are so it can explain a block. It is not an enforcement path and cannot allow or
  deny anything:

```
agent/instructions.md:56:- A project's last remaining status or priority cannot be deleted.
agent/instructions.md:57:- A project that still has tasks cannot be deleted.
```

**Honest limitation:** "never re-checked downstream" is a property of Phases 2 and 4, which have not been
written. What Phase 1 can demonstrate — that the rules are centralised here, that no duplicate enforcement
exists today, and that the shared schemas make the constraints visible in the contract both front doors
will import — it does demonstrate. The criterion should be re-verified when the API routes and EVE tools
land.

---

<a id="09"></a>## G1 — dependency policy and test layout

From [`09-dependency-policy.txt`](./09-dependency-policy.txt). The only `package.json` change on the whole
branch is to three test scripts (adding the `--env-file=.env.local --env-file-if-exists=.env.test` stack
that `db:reset:test` already used). Filtering the diff to dependency lines returns nothing, and the
lockfile is the second witness:

```
$ git diff main -- package.json | grep -E "^[+-][[:space:]]+\"[a-z@]" | grep -v "test"
  (no matches — not one dependency line was added, removed or changed)

$ git diff main -- pnpm-lock.yaml | wc -l  ->  0
```

The test layer imports Node built-ins and nothing else, and none of the §1.1-rejected libraries appear
anywhere:

```
$ grep -rhoE "from \"node:[a-z/]+\"" tests/ | sort -u
from "node:assert/strict"
from "node:test"

$ grep -riE "vitest|jest|playwright|cypress|dotenv|nanoid|date-fns|dayjs|supertest" package.json tests/ lib/
  (no matches)
```

Test layout §4.1 holds: no `*.test.ts` under `lib/`, and all eight test files live under `tests/unit/`.

---

<a id="16"></a>## S1 — `lib/db` reconciled, not duplicated

From [`16-db-layer-reconciled.txt`](./16-db-layer-reconciled.txt): exactly one `postgres()` call site
(`lib/db/connect.ts:34`), exactly one exported singleton (`lib/db/client.ts:25`), and each table declared
once in `lib/db/schema.ts`. Phase 1's only change under `lib/db/` is 14 insertions in `connect.ts` — the
blocker fix that made the whole phase testable:

```ts
-export type Database = ReturnType<typeof drizzle<typeof schema>>
+export type Database = PostgresJsDatabase<typeof schema>
```

The old type resolved to `PostgresJsDatabase<typeof schema> & { $client: Sql }`. A `PgTransaction` carries
no `$client`, so before this change no action could be handed a transaction and every planned test would
have failed `pnpm typecheck`.

---

<a id="r6"></a>## R6 — product-spec §7.6, concurrent edits: **not applicable to this phase**

> **Concurrent edits.** The user and agent may act at the same time. The system resolves this simply:
> **last write wins**, with no locking. Both interfaces converge on the latest state via live sync (§8.3).

This is the one §7 rule with no Phase 1 verdict, and it is deliberately **not** marked pass. It is a
statement about two interfaces racing, and Phase 1 has one caller — itself. The phase brief's own list of
rules to enforce omits it, and the implementation plan assigns the scenario to Phase 6 / US-G3. What can be
said now is only the precondition, recorded verbatim in [`10-rule-messages.txt`](./10-rule-messages.txt):

```
===== §7.6 Concurrent edits (last write wins) ============
  NOT exercised in Phase 1. This rule is about two interfaces racing;
  there is only one interface (this layer) so far. The action layer takes
  no locks and holds no versions, which is the precondition, but the rule
  itself is an Epic G / US-G3 concern verified in Phase 6.
```

---

## Why there is no story table

Phase 1 ships no user-visible surface, so no acceptance criterion from `docs/user-stories.md` can be
exercised end to end here — every one of them is phrased from the user's seat ("I can create a task…",
"the block message states the reason…") and needs a UI or an agent to drive. The phase brief says as much:
*"User stories that must demonstrably pass: none directly — this phase is infrastructure; its exit criteria
are the acceptance test."* The table above therefore uses the exit criteria and scope statements verbatim.

For traceability, these story criteria are now **satisfied at the action layer** and should be
straightforward to confirm once an interface exists — but they are **not claimed as passing**, because the
interface half of each is untested:

| Story criterion | Action-layer coverage |
|---|---|
| US-A1.5 seeding happens exactly once | `ensureSeeded(tx)` against an empty DB, both tests green |
| US-B1.3 / B1.4 omitted status/priority take the project defaults | `createTask` defaults tests + [`10`](./10-rule-messages.txt) |
| US-B4.4 no way to move a task to another project | `updateTaskSchema` has no `projectId`; `ZodError` + unchanged column |
| US-C1.2 new projects seeded with the standard lists | `createProject` + [`06`](./06-real-db-roundtrip.txt) |
| US-C3.2 / C3.3 delete blocked with a reason | `deleteProject` RuleViolation naming count and remedy |
| US-D2.1–D2.3, US-E2.1–E2.3 delete blocked in-use / last-remaining | `deleteStatus` / `deletePriority` |
| US-E1.3 exactly one default at all times | schema-level impossibility + single-statement flip |
| US-E2.4 default reassigns on delete | `deletePriority` moves it to order 0 |

---

## Method and caveats

**Read these before treating the pass marks as unqualified.**

1. **The harnesses are part of the evidence, not a summary of it.** All five live in
   [`harness/`](./harness) and are committed, so every transcript here can be regenerated:
   `db-identity.ts`, `guard-refuses-dev.ts`, `real-db-roundtrip.ts`, `rule-messages.ts`, `db-state.ts`.
   Each is run with `node --env-file=.env.local --env-file-if-exists=.env.test <path>` from the repo root.
2. **The harness bug that was fixed, disclosed.** The first `rule-messages.ts` run reported three
   failures — a "CHANGED — FAIL" on project immutability and two `ZodError: expected string, received
   undefined` where RuleViolations were expected. All three came from the harness reading
   `task.projectId` / `task.statusId` when `TaskView` nests them (`task.project.id`, `task.status.id`).
   The product was never at fault. The fix also *strengthened* the immutability check, which now reads the
   raw `tasks.project_id` column instead of the action's own output.
3. **`real-db-roundtrip.ts` commits.** Part 1 deliberately writes a committed sentinel project — that is
   the only way to observe it from a second connection and prove the database is real. It deletes
   everything it created, and the before/after counts in the same transcript show the test database
   returned to `{ projects: 1, statuses: 3, priorities: 3, tasks: 0 }`. The independent post-run dump
   ([`13`](./13-db-state-after.txt)) confirms it.
4. **Nothing here touched the dev database.** Every harness and the test suite resolve the test URL;
   the dev database was only ever *read* (row counts, migration ledger), and its dump is identical before
   and after ([`14`](./14-db-state-diff.txt)).
5. **No secrets appear in any transcript.** Every connection string is rendered through the repo's own
   `describeDbUrl()`, which emits `host/database` and nothing else. `.env.local` and `.env.test` remain
   gitignored and were never printed.
6. **`node --test` output is the spec reporter**, run through `pnpm`, so timings are included per test.
   The `EXIT=` line appended to each transcript is the real exit status of the command above it.
7. **`pnpm test:unit` was run twice.** The published transcript is the second run, executed against the
   final committed tree after the harnesses were added, so the transcript and the repository agree. The
   first run produced the same result (105/105, 58.2 s vs 52.7 s).
8. **What this packet does not establish.** That the rules stay un-duplicated in Phase 2/4 (E2's forward
   half); that §7.6 holds under real concurrency (R6); and anything at all about UI or agent behaviour —
   there is no UI in this phase, which is why the packet is transcripts rather than screenshots.

---

## Evidence index

| File | What it shows |
|---|---|
| [`01-test-unit.txt`](./01-test-unit.txt) | Full `pnpm test:unit` run — 105/105, every test named |
| [`02-typecheck.txt`](./02-typecheck.txt) | `pnpm typecheck` clean, harnesses included |
| [`03-lint.txt`](./03-lint.txt) | `pnpm lint` — 0 errors, 2 pre-existing warnings |
| [`04-db-identity.txt`](./04-db-identity.txt) | Dev and test are separate, migrated Neon projects |
| [`05-guard-refuses-dev-db.txt`](./05-guard-refuses-dev-db.txt) | The never-run-against-dev guard actually fires |
| [`06-real-db-roundtrip.txt`](./06-real-db-roundtrip.txt) | Real Postgres proven from independent connections; rollback isolation |
| [`07-capability-parity.txt`](./07-capability-parity.txt) | 19 actions ↔ 19 strict schemas; no `projectId` on update |
| [`08-layer-boundaries.txt`](./08-layer-boundaries.txt) | No confirmation here; defaults linkage; `ensureSeeded(tx)` |
| [`09-dependency-policy.txt`](./09-dependency-policy.txt) | Zero dependency change; built-ins only; test layout |
| [`10-rule-messages.txt`](./10-rule-messages.txt) | Every §7 rule triggered live, with its actual message |
| [`11-no-downstream-recheck.txt`](./11-no-downstream-recheck.txt) | All rule throw sites in `lib/actions/`; nothing downstream |
| [`12-db-state-before.txt`](./12-db-state-before.txt) | Both databases dumped before the published run |
| [`13-db-state-after.txt`](./13-db-state-after.txt) | Both databases dumped after it |
| [`14-db-state-diff.txt`](./14-db-state-diff.txt) | The two dumps are identical |
| [`15-rule-to-test-map.txt`](./15-rule-to-test-map.txt) | Each rule → its passing tests, grepped from the transcript |
| [`16-db-layer-reconciled.txt`](./16-db-layer-reconciled.txt) | One connection, one schema, and the `Database` widening |
| [`harness/`](./harness) | The five committed scripts that produced 04, 05, 06, 10, 12 and 13 |

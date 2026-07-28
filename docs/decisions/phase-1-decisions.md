# Phase 1 — Shared action layer: decisions and assumptions

**Phase:** 1 — Shared action layer
**Date:** 2026-07-28
**Branch:** `phase-1-shared-action-layer`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 1 builds the thing the whole architecture rests on: `lib/schemas/` (one
Zod object per capability — the parity contract) and `lib/actions/` (one
function per capability — the single home of every product-spec §7 rule),
with `node:test` coverage against the **real** test database. Phases 2 and 4
are then two front doors that adapt transport and add no logic of their own.

Same two conventions as the Phase 0 and 0r records: a decision taken **at
design time** was settled before code was written; a decision taken **at build
time** was forced by something only discoverable once the code ran.

---

## Decisions

### Widening `Database` so a transaction is an injectable handle — build time

**`lib/db/connect.ts` typed the injectable handle as
`ReturnType<typeof drizzle<typeof schema>>`. Does that need to change?** Yes,
and it blocked everything else. That type resolves to
`PostgresJsDatabase<typeof schema> & { $client: Sql<{}> }`, and a
`PgTransaction` has no `$client`, so `action(tx)` fails typecheck with TS2345.
Every DB-backed test in this phase passes a rolled-back transaction as the
`database` argument, and `pnpm typecheck` is an explicit exit criterion, so the
suite could not have compiled. `lib/db/connect.ts` now exports
`type Database = PostgresJsDatabase<typeof schema>`, which accepts the concrete
handle, a transaction and a nested transaction alike, and keeps the `.query.*`
relational API. `createDatabase`'s return value and `lib/db/client.ts`'s
re-export needed no edit.

*Not chosen: a separate `TransactionalDatabase` type* — two names for the same
capability, and every action signature would have had to pick one.

### Actions validate their own input

**Do actions call `schema.parse(input)` themselves, or trust the transport
layer to have already validated?** Every action's first statement is
`const parsed = verbSchema.parse(input)`.

Plan §2.1 describes this layer as zod-validated *and* as the only place
business rules live. If validation only happened at the edge, the shape rules
this layer owns — title non-empty, name non-empty, the absence of `projectId`
on update — would be untestable at the layer that owns them, and any future
third caller would bypass them silently. Re-parsing an already-parsed object is
free at this scale and always succeeds, because schema output satisfies schema
input (which is also why no schema uses `.default()` — see below).

### `z.strictObject` everywhere

**Reject unknown keys, or silently strip them as `z.object` does?** Strict,
uniformly, for every schema in `lib/schemas/`.

This is what turns `updateTaskSchema`'s *missing* `projectId` field into an
actual rejection rather than a silent strip. A caller — or a model in Phase 4 —
that tries to move a task between projects gets a loud, correctable `ZodError`
instead of a change that appears to succeed and does nothing. One consistent
rule is also easier to reason about than a per-schema judgement call. Verified
that `.strictObject().refine()` is still a `ZodObject` with `.shape`, still
rejects unknown keys, and converts via `z.toJSONSchema` to
`additionalProperties: false`, so Phase 4's `inputSchema` usage is unaffected.

### Project immutability is structural, not a runtime check

**How is product-spec §7 rule 1 (a task's project is fixed at creation)
enforced?** By omission: `updateTaskSchema` has no `projectId` field at all,
and `updateTask` builds its SQL patch from an explicit whitelist of parsed
fields. There is no "reject a project change" branch anywhere.

An illegal state that cannot be expressed is stronger than a check a future
edit could forget. Because the schema is the object both Phase 2 and Phase 4
import, the constraint is visible in the shared contract rather than buried in
action logic. The test asserts both halves of the guarantee: the call throws a
`ZodError`, *and* the stored `project_id` is unchanged afterwards.

### `NotFoundError` alongside `RuleViolation`

**What error types does this layer throw beyond the plan-mandated
`RuleViolation`?** Exactly one sibling: `NotFoundError`, in
`lib/domain/errors.ts`. `RuleViolation` is reserved strictly for §7 rule
breaches; `NotFoundError` covers "no entity with this id". Both extend `Error`,
set `name`, and carry a message only — no codes, no structured payload.

The plan names only `RuleViolation`, but Phase 2 must answer 404 for a missing
entity and 409 for a blocked rule, and Phase 4's tools phrase the two
differently to the model. Folding both into one class would force downstream
layers to string-match message text to tell them apart — precisely the
downstream logic this architecture exists to prevent. One extra one-line class
is the smallest possible addition.

### One file per entity, not one per capability

**Is `lib/schemas/` / `lib/actions/` organised per capability or per domain
entity?** Per entity — `projects.ts`, `statuses.ts`, `priorities.ts`,
`tasks.ts` in each directory, plus `lib/schemas/common.ts` for shared field
schemas and an `index.ts` barrel in both.

This mirrors `lib/db/schema.ts`'s own per-table grouping and keeps the phase to
13 library files instead of ~36. It still satisfies "one Zod schema + one
action function per capability" literally: each capability has its own named
schema object and its own named function, so Phase 4's one-file-per-tool layer
just imports specific named exports. The barrels match the `lib/db/index.ts`
precedent.

### Last-remaining beats in-use when both block a delete

**When a status or priority is simultaneously the project's last remaining one
*and* used by tasks, which message wins?** Last-remaining is checked first and
takes precedence.

The in-use message tells the user to reassign the blocking tasks — but if this
is the project's only status there is nowhere to reassign them to, and even an
empty entity still could not be deleted. Leading with in-use would hand the
user a dead-end remedy. §7.5 also frames the minimum-lists rule as
unconditional ("the last one cannot be deleted, even if unused"), which reads
as the stronger constraint. The last-remaining message is never wrong; the
in-use message sometimes is. There is a test for exactly this collision.

### Bulk actions are all-or-nothing

**Do `bulkUpdateTasks` / `bulkDeleteTasks` apply best-effort or
all-or-nothing?** All-or-nothing inside one transaction. Any missing task id or
any scoping violation aborts the entire batch with nothing written, raising
`NotFoundError` naming the missing ids.

Both bulk tools sit behind an EVE approval gate (plan §2.4) whose prompt
renders the exact input, and US-F5.3 promises that on approval all stated
changes are applied and on decline nothing changes. A partially applied batch
would leave the system in a state the agent never described to the user. The
pre-flight existence check before any write also makes the failure clean rather
than a half-written transaction being rolled back.

*Not chosen: a tolerant bulk delete that skips already-missing ids and reports
a count.* That is appealing given the plan's note that deletes are naturally
idempotent under EVE's step-replay model, but it would hide a genuine mistake —
an agent passing wrong ids would see a quiet "deleted 0" — and it creates an
asymmetry with the strict single-item `deleteTask`. EVE records completed steps
rather than blindly re-executing them, so the replay argument is weaker than it
first appears; if a replay does hit an already-deleted row, a `NotFoundError`
the model can read and re-verify is the honest outcome.

**A batch may span several projects — build time.** The scope guard therefore
loops over every *distinct* `projectId` in the resolved task set and runs once
per project, before any write. Checking only the first task's project would let
one status id be applied across two projects whenever the first task happened
to own it — a §7 rule 2 breach that the all-or-nothing contract would then
faithfully commit. Per-distinct-project is the smallest check that is actually
sound, and a test asserts that both tasks are left untouched when it fires.

### `listTasks` owns the ordering and the completed-hiding default

**Does the action apply the spec's ordering, or leave it to each interface?**
The action always applies `statuses.isCompleted ASC, priorities.order DESC,
tasks.createdAt ASC`, and hides completed tasks unless `includeCompleted` is
true or an explicit `statusId` filter is supplied.

Product spec §8.1 frames this as UI experience, but parity (§5, §6) requires
the agent's `list_tasks` and the UI's task list to agree. Centralising it in
the one shared layer is the whole architecture's premise; the alternative is
the same sort implemented twice and guaranteed to drift. Making an explicit
`statusId` filter override `includeCompleted` is the obvious intent: someone
filtering to "Done" wants to see Done tasks.

### Ascending `order` is ascending urgency

**Which direction does `order` run for priorities?** Ascending order is
ascending urgency (Low=0 < Medium=1 < High=2, matching the seed), so "highest
priority first" sorts by `priorities.order DESC`.

Product spec §4.3 gives its own example as "order relative to the project's
other priorities (e.g., Low → High)" — ascending order literally *is* the
Low-to-High sequence — and `lib/domain/defaults.ts` already encodes
`DEFAULT_PRIORITIES` in that array order. No document offers another reading.

### Reordering is "move to position N", in a pure module

**How is reorder modelled, given the plan's tool inventory lists only a
consolidated `update_status` / `update_priority`?** `updateStatusSchema` and
`updatePrioritySchema` accept an `order` field meaning "move this item to
0-based position N". `lib/domain/reorder.ts` computes the renumbered sibling
list purely, and the action writes back only the rows whose order actually
changed, inside one transaction. Out-of-range targets are clamped.

Plan §1 fixes the tool grain at "consolidated `update_*` per entity", so
inventing a separate reorder capability would break the agreed §2.4 inventory.
Move-to-position is also the simplest shape for a model to emit ("move Done to
the front") compared with submitting an entire reordered array. Keeping the
index arithmetic in a pure, DB-free module makes it unit-testable in isolation
— the same spirit as `lib/domain/defaults.ts`, which is why it lives beside it
rather than in a new `lib/actions/internal/` convention invented for one
consumer. (The cross-project scoping guards stay module-private inside
`lib/actions/tasks.ts` for the mirror-image reason: three callers, all in that
file.)

### Exactly-one-default is made inexpressible, then atomic

**How is "set a priority as default" represented so §4.3 can never be
violated?** Three ways at once: `createPrioritySchema` has no `isDefault` field
(so exactly one code path in the system writes the flag); `updatePrioritySchema`
types it as `z.literal(true).optional()` (so "un-set the default without naming
a replacement" — the only route to zero defaults — cannot be expressed); and
the flip is a single `UPDATE ... SET is_default = (id = $target)` across the
whole project (so no reader ever observes zero or two defaults, and there is no
read-then-write race window). The blueprint allowed a two-statement fallback if
Drizzle's `.set()` typing fought the `sql` expression; it did not, so the
one-statement form shipped as
``.set({ isDefault: sql`${priorities.id} = ${priority.id}::uuid` })``. The
explicit `::uuid` cast was added at build time so Postgres compares a uuid to a
uuid rather than to an untyped text parameter. The two-`UPDATE` fallback would
have been only *equally* atomic to an outside reader, never strictly better, so
nothing was lost by not needing it.

### The delete guards count within the project, not just by id — build time

**`deleteStatus`'s in-use count could be scoped to the status id alone. Should
it also filter on the project id?** Both:
`and(eq(tasks.statusId, status.id), eq(tasks.projectId, status.projectId))`,
and the same in `deletePriority`.

Product spec §7.3 words the rule as "no task *in its project* currently uses
it". The two predicates are equivalent today, because §7 rule 2 already forbids
a cross-project reference from existing at all — but writing the guard the way
the spec states it means it stays *correct* rather than *accidentally correct*
if that invariant is ever weakened.

### No migration, no new index

**Does this phase add a partial unique index for one-default-per-project, or
composite FKs for cross-project scoping?** No schema or migration changes at
all. `lib/db/schema.ts` is reused exactly as Phase 0 built it.

Plan §2.2 explicitly calls the comparable hardening — composite
`(status_id, project_id)` FKs — "the optional hardening", not a v1 requirement,
and states that action-layer enforcement is the source of truth. The same
reasoning extends to a default-uniqueness index. The existing `ON DELETE
RESTRICT` FKs on `tasks.status_id` / `tasks.priority_id` remain as pure defence
in depth behind the action layer's own count-then-block checks, which always
run first.

### What the create actions return

**Does `createProject` return the project plus its freshly seeded lists?** Just
the `Project` row. Callers fetch the lists via `listStatuses` / `listPriorities`.

This keeps every create action's contract uniform (one entity row) and makes
the test stronger: the `lib/domain/defaults.ts` linkage is proven by
round-tripping through the database, not by trusting an inline echo of values
the same function just wrote. The agent rarely needs the ids immediately,
because `createTask` defaults both status and priority.

*Not chosen: returning `{ project, statuses, priorities }`.* It saves the agent
a round trip and reads nicely, but it breaks return-shape symmetry with every
other create and weakens exactly the linkage test above.

**A note on how that test got there — build time.** The plan was to prove the
linkage through `listStatuses` / `listPriorities`, but those actions did not
exist until build step 7, and every commit had to leave the tree green. Step 6
therefore read the seeded rows back with direct Drizzle selects, and step 9
swapped both assertions onto the real list actions and added the US-C1.3
create-project-then-create-task test in the same edit. Both forms satisfy the
actual requirement — prove the linkage against the database rather than against
an echo of what `createProject` just wrote — so the intermediate state was
never weaker in kind, only in the seam it exercised.

Task reads and writes return a **`TaskView`** instead — the task's own fields
plus nested `project`, `status` and `priority` objects. Both interfaces need
the related names on every render: the UI shows them as chips (§8.1), and the
agent must be able to say "Created task 'Fix header' in Website" (US-F6.2)
without a follow-up lookup. Nested objects rather than flattened
`statusName`/`priorityName` keys, because that shape maps directly onto both
the chip components and the Phase 2 JSON response.

### Absent vs. null in an update

**How is "leave this field alone" distinguished from "clear this field"?**
`description: z.string().nullable().optional()` — an absent key means
untouched, an explicit `null` means clear, a string sets it. The action checks
`parsed.description !== undefined` before adding it to the SQL patch. Empty and
whitespace-only strings normalise to `null`.

Description is the only nullable user-editable field. If it were merely
optional, "omitted" and "set to empty" would be indistinguishable and a
description could never be cleared once written. Every other update field is
non-nullable, so absent-means-untouched suffices for them.

**`normalizeDescription` tests a trimmed copy but stores the original —
build time.** It decides null-vs-store with `value.trim() === ""`, then writes
the untrimmed string. `descriptionSchema` deliberately omits `.trim()`, because
leading indentation and trailing blank lines in free text are the author's
formatting rather than noise; trimming on the way to storage would silently
contradict that. Testing on a trimmed copy only changes the whitespace-only
case, where there is nothing to preserve.

### No `.default()`, no `.max()`

**Do schemas carry default values and length caps?** Neither. Optional fields
stay optional and the action applies the default (`isCompleted ?? false`,
`includeCompleted !== true`); no maximum lengths are declared.

Avoiding `.default()` keeps `z.input` and `z.output` identical, so `z.infer` is
unambiguous and an object parsed at the transport edge is trivially
re-parseable by the action. Avoiding `.max()` means no invented constraint can
reject input the spec allows; the underlying Postgres columns are unbounded
`text`.

### Update schemas require at least one field

**Should an empty patch be accepted?** No — `updateStatus`, `updatePriority`,
`updateTask` and `bulkUpdateTasks` each carry a `.refine()` requiring at least
one mutable field. A no-op update is almost always a mistake in a tool call,
and the refinement message tells the model exactly which fields it could have
supplied. The refinement does not appear in the generated JSON Schema, but EVE
parses with the zod schema itself, so it holds at call time.

### `search`, not `q`

**Plan §2.3 sketches the query parameter as `?q=`. What is the schema field
called?** `search`. Phase 2's route handler maps `?q=` onto it.

The schema doubles as the EVE tool `inputSchema` a model reads directly;
`search` is self-describing where `q` is a URL-shortening convention.
Translating a query-string name into a field name is exactly the transport
adaptation the interface layer exists to do — the plan says the interfaces
"only adapt transport".

### The delete guards are duplicated on purpose

**Is the delete-guard logic factored into one generic helper shared by statuses
and priorities?** No — `deleteStatus` and `deletePriority` each implement their
own guard sequence, deliberately duplicating the structure. They diverge
semantically (only the priority path reassigns a default) and their user-facing
messages differ in wording and noun. A shared generic would need a growing set
of hooks and flags to stay correct across two ~25-line functions, producing a
leakier abstraction than the duplication it removes.

### No confirmation affordance in this layer

**Is any `confirm`, `dryRun` or `approve` parameter added, even unused?** None,
anywhere in `lib/actions/`. Plan §2.1 states that confirmation is per-interface
UX — dialogs in the UI, EVE approval gates for the agent — and the phase brief
repeats it as a hard non-goal. A hook "for later" would create a second place
the confirmation question is answered, which is exactly what the shared-action
architecture exists to prevent.

### The test harness: rolled-back transactions against the real test DB

**Where does the harness live, and how do tests stay isolated against a real,
shared Neon database?** `tests/support/db.ts` — outside the `tests/unit/` glob
so it is never executed as a test, and reusable by Phase 2's `tests/api/`. It
exports a guarded pool, `withRollback` (runs the body in a transaction
terminated by a sentinel throw) and `withEmptyDb` (the same, plus a
transaction-local wipe of all four tables).

This satisfies "against the real test database, not mocks" literally — real
constraints, real transactions, real rules — while giving perfect isolation
with no cleanup SQL and no `db:reset` between tests. Actions that open their
own `database.transaction()` become savepoints when handed the outer `tx`, so
no production code has a test-only branch. A sentinel throw is used rather than
`tx.rollback()` because it is dialect-independent. Confirmed in the build: a
`RuleViolation` thrown inside an action's own transaction rolls back only that
savepoint, and the surrounding test transaction carries on — which is what lets
a single test assert both the throw and the unchanged rows afterwards.

`withEmptyDb` is used by `tests/unit/db/seed.test.ts` **only**, and that is a
binding convention. `node --test` runs files in parallel processes; every other
file builds its own fixtures via `createProject` and never reads, updates or
deletes pre-existing committed rows, so no two open transactions can contend
for the same row lock. `set local lock_timeout = '5s'` turns any future
violation of that rule into a fast, legible failure instead of a hang.

---

## Assumptions

**Nested `database.transaction()` composes as a Postgres savepoint when the
outer handle is already a test transaction, and a failed inner savepoint rolls
back only itself.** *Confirmed in the build*, not merely assumed: every
DB-backed test in this phase passes a `tx` into actions that open their own
transaction, and the delete-blocked tests assert that the rows survive the
inner rollback. Statically corroborated at
`node_modules/drizzle-orm/postgres-js/session.js:131`, where
`PostgresJsTransaction.transaction` delegates to `this.session.client.savepoint`.
*If it had been wrong:* hand actions the pooled handle and clean up with an
explicit cascading `DELETE` of fixture rows in an `after` hook, at the cost of
cross-file isolation and speed.

**Neon's pooled endpoint (PgBouncer transaction mode, with `prepare: false`
already set in `createDatabase`) supports `SAVEPOINT`.** *Confirmed:* the whole
105-test suite runs over the pooled test URL. *If it had been wrong:* point
`tests/support/db.ts` at `DATABASE_URL_TEST_UNPOOLED`, which `lib/db/urls.ts`
already resolves — a one-line change.

**Test files running in parallel processes never contend on the same rows.**
Rests on READ COMMITTED semantics (uncommitted rows are invisible to other
transactions, MVCC reads never block) plus the fixture discipline above: only
`seed.test.ts` touches pre-existing committed rows. The full suite ran green
repeatedly with the default concurrency. *If it proves flaky:* the
`lock_timeout` makes it a fast failure, and the escape hatch is
`--test-concurrency=1` on `test:unit`, the pattern `test:e2e` already uses.

**Drizzle accepts a `sql` expression as the value in `.set()` for a boolean
column.** *Confirmed:* `set is_default = (id = $target::uuid)` compiles, runs,
and the exactly-one-default assertions pass. The blueprint's sanctioned
fallback — two `UPDATE`s in the same transaction — was not needed.

**A module-scope `after()` in `tests/support/db.ts` closes the pool for every
importing test file and the process exits cleanly.** *Confirmed:* the suite
exits without hanging in every run.

**Importing `lib/db/client.ts` (which every action does, for the `db` default
parameter) never opens a connection to the dev database during a test run.**
postgres.js connects lazily and every DB-backed test passes an explicit
transaction, so the singleton is constructed but never used. Two further
mitigations are already in place: the harness refuses to run at all if the test
URL equals `DATABASE_URL`, and no test ever calls an action without a handle.
*If it were ever wrong:* import `db` lazily inside each action rather than at
module scope.

**The project always has at least one status and one priority when
`createTask` runs.** Guaranteed by §7.5, enforced by `deleteStatus` /
`deletePriority` in this same layer, and by `createProject` seeding three of
each. `createTask` handles the impossible case defensively anyway: a
`RuleViolation` naming the project rather than a crash, and priority resolution
falls back to first-by-order if no row carries `isDefault`.

**The canonical ordering applies uniformly to completed and open tasks** — one
`ORDER BY`, rather than sorting completed tasks by some other key such as
`updatedAt DESC`. Product spec §8.1 specifies the sort only for open tasks and
says completed tasks "sink to the bottom" without naming their internal order.
*If users find it unhelpful:* it is a single `ORDER BY` clause in one action,
and no story asserts a specific completed-task order, so it would surface as
Phase 3 UI feedback rather than a failing test.

**Node's `--env-file` stacking loads `.env.local` then `.env.test` without
either shadowing the other's database URLs.** *Confirmed:* the harness resolves
`DATABASE_URL_TEST` and compares it against a present, different
`DATABASE_URL`. `.env.test` contains no `DATABASE_URL` key to shadow with. *If
someone later adds one:* the guard would see test === dev and refuse to run,
which is the safe failure direction, and the error message names the cause.

---

## Deviations from the implementation plan

| Deviation | Why |
| --- | --- |
| `test`, `test:unit` and `test:api` gained `--env-file=.env.local --env-file-if-exists=.env.test`, which §4.7's script strings do not have | `node --test` spawns each file with only the env the invoking command supplies. Without both files, `DATABASE_URL_TEST` is absent (nothing to connect to) and `DATABASE_URL` is absent (nothing for the never-run-against-dev guard to compare against), so this phase's own exit criterion is unreachable. Mirrors the stack `db:reset:test` already uses; `test:e2e` is untouched. |
| `lib/db/connect.ts`'s `Database` type was widened to `PostgresJsDatabase<typeof schema>` | The previous type carried `$client`, which `PgTransaction` lacks, so no action typed against it could be handed a transaction. Blocking for both the test strategy and `pnpm typecheck`. See the first decision above. |
| `NotFoundError` exists alongside the plan-mandated `RuleViolation` | Phase 2 needs 404 and 409 to be distinguishable by `instanceof` rather than by message text. See the decision above. |

No deviation from §1.1: **no dependency was added or removed** in this phase.
The whole layer is built from `zod`, `drizzle-orm` and `postgres`, all already
in the allowed table, and the tests use `node:test` + `node:assert/strict`, as
§1.1 requires in place of `vitest`.

---

## Known gaps

**Deliberately out of scope for this phase:**

- No API route or EVE tool imports any of this yet. `lib/schemas/` and
  `lib/actions/` are, by design, infrastructure with no caller until Phase 2 and
  Phase 4. `app/page.tsx` is still Phase 0's scripted chat demo.
- No confirmation, dry-run or approval affordance exists anywhere in
  `lib/actions/` — see the decision above; this is a non-goal, not an omission.
- No migration was generated and `lib/db/schema.ts` is unchanged. The optional
  hardening plan §2.2 describes (composite `(status_id, project_id)` FKs, a
  partial unique index for one-default-per-project) remains available to a later
  phase if the action-layer enforcement ever proves insufficient.

**Carried forward:**

- **US-A1.4 is now partially unblocked.** Phase 0r recorded it as blocked
  because no task-creation surface existed. `createTask` now exists and
  `tests/unit/actions/projects.test.ts` proves a task can be created in a
  brand-new project with no additional setup — but the story's criterion says
  "through either the UI or the agent", and neither front door exists yet.
  Phase 2 and Phase 4 owe the re-verification.
- `tests/api/` still does not exist; `pnpm test:api` passes with zero tests.
  Phase 2 creates it alongside the first route.
- `pnpm lint` still reports the same 2 pre-existing warnings recorded in the
  Phase 0r notes (an unused `Geist` import in `app/layout.tsx`, and one in
  `.remember/tmp/`, a local tool artefact). Zero errors, and neither is this
  phase's to fix.

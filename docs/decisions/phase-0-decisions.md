# Phase 0 — Foundations: decisions and assumptions

**Phase:** 0 — Foundations
**Date:** 2026-07-28
**Branch:** `phase-0-foundations`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

Phase 0 turned an empty Next.js 16.2.6 demo repo into a working foundation: the
project dependencies (Drizzle ORM, postgres.js, drizzle-kit, TanStack Query,
Vitest, tsx) are installed; a five-table Drizzle schema — `projects`, `statuses`,
`priorities`, `tasks`, `chat_state` — is defined, generated into migration
`0000_spotty_ender_wiggin`, and applied to the provisioned Neon Postgres; an
idempotent seed creates the "Personal" project with its default statuses and
priorities exactly once, reachable both from `pnpm db:seed` and from a
server-boot `instrumentation.ts` hook; and the EVE agent framework (v0.27.8) is
mounted through `withEve()` in `next.config.ts`, serving `/eve/v1/*` from the
same `pnpm dev` process and round-tripping real model turns through the Vercel AI
Gateway. This document records every choice the governing documents left open,
every place where reality contradicted a planning assumption, and what the next
phase inherits. It is written to be read on its own, without the conversation
that produced it.

Two conventions used below: a decision taken **at design time** was settled
before code was written; a decision taken **at build time** was forced by
something only discoverable once the code ran. Both are recorded the same way,
but build-time decisions are labelled, because they are the ones most likely to
contradict the plan.

---

## Decisions

### Scope and process

**Should Phase 0 open with a housekeeping commit for the Neon agent skills,
`skills-lock.json`, and the `.vercel` gitignore entry, as the phase scope
requested?** No — the work was verified as already done and the commit was
skipped. Commit `0ce2de1` on this branch already tracks
`.agents/skills/neon/SKILL.md`, `.agents/skills/neon-postgres/SKILL.md`, and
`skills-lock.json`, and `.gitignore` already contained both `.vercel` and the
blanket `.env*` rule. Making the commit anyway would have produced an empty
commit, or — worse — a commit with the wrong contents, because the only pending
diff in the working tree was `.claude/workflows/phase-build.mjs`, the
orchestration harness itself, which is out of phase scope and must not be swept
into a phase commit. The alternative of running `git add -A` to "catch
everything" was rejected for exactly that reason. One correction to the phase
text worth recording: the skills live at `.agents/skills/`, not
`.claude/skills/`; `.claude/skills/` contains only symlinks to them.

### Domain defaults

**Where do the default status and priority lists live, so that the seed script
and Phase 1's `createProject` action cannot drift apart?** In a new
dependency-free module, `lib/domain/defaults.ts`, exporting `DEFAULT_STATUSES`,
`DEFAULT_PRIORITIES`, and `SEED_PROJECT_NAME`. It is imported by `lib/db/seed.ts`
today and is intended to be imported by `lib/actions/createProject` in Phase 1.
Product spec §4.1/§4.3 requires the seeded Personal project (US-A1) and every
project created later (US-C1.2) to receive byte-identical defaults. Had the seed
script owned a private literal list, Phase 1 would have been forced either to
duplicate it or to import domain knowledge out of DB-layer code — and duplicated
constants are precisely the drift that this application's shared-action
architecture exists to prevent. The module is pure and unit-testable with no
database. Rejected: inlining the arrays in `lib/db/seed.ts` (creates the
duplication); a flat `lib/defaults.ts` matching the existing flat `lib/ai.ts`
convention (rejected because `lib/domain/` gives Phase 1 an obvious home for
`RuleViolation` and the other domain types that will sit beside it).

### Schema

**What primary key strategy should the five tables use?** A `uuid` column with a
database-side default — `uuid("id").primaryKey().defaultRandom()`, which emits
`gen_random_uuid()`. This gives native uuid storage (16 bytes, a real type, and
correct comparison semantics) rather than an opaque string, and the DB-side
default means raw SQL inserts during verification or debugging work without
supplying an id. The application can still pass its own `crypto.randomUUID()`
value per insert when it wants to know the id ahead of time, so the testability
argument for application-generated ids costs nothing to preserve. Rejected: a
`text` primary key with `$defaultFn(() => crypto.randomUUID())` (loses the native
type and breaks raw inserts); serial integers (friendlier for an agent to quote
in natural language, but they enable enumeration and diverge from Drizzle and
Postgres idiom — and the plan's tools resolve tasks by search and title rather
than by spoken ID, so uuid opacity is not a real product cost).

**`order` is a reserved SQL keyword — how should the per-project ordering column
be named?** The TypeScript field keeps the plan's application-facing name and the
physical column is renamed: `order: integer("sort_order").notNull()`. Drizzle
would quote `"order"` correctly in its generated SQL, but then every hand-written
verification query in psql would need quoting too, and an unquoted
`select name, order from statuses` fails with a confusing parse error. The
physical rename is invisible to all callers and removes the whole class of
problem. Rejected: keeping the literal column name `order` (plan-literal but
quoting-fragile); naming it `position` (rejected because `position` is itself a
built-in Postgres function name, trading one ambiguity for another).

**Is the ordering value 0-based or 1-based?** 0-based — `order` equals the array
index in `DEFAULT_STATUSES` / `DEFAULT_PRIORITIES`. This makes the seed a direct
`map((item, index) => ({ ...item, order: index }))` with no off-by-one, and
Phase 1's append semantics (`max(order) + 1`) are identical under either
convention. Rejected: 1-based, which would be marginally friendlier if the value
were ever displayed raw — but ordering values are never surfaced to the user,
only used for sorting.

**What `ON DELETE` behaviour should the foreign keys have?**
`statuses.project_id`, `priorities.project_id`, and `tasks.project_id` all
CASCADE from `projects`; `tasks.status_id` and `tasks.priority_id` RESTRICT.
RESTRICT on status and priority is free defence-in-depth against the real risk —
deleting a list entry that tasks still reference, which product spec §7 rule 3
forbids — while CASCADE from `projects` keeps the schema self-consistent when a
legitimately empty project is removed. Rejected: RESTRICT everywhere, including
`tasks.project_id` (redundant, since the action layer already blocks deleting a
non-empty project). One interaction is worth knowing about: raw-SQL deletion of a
project that still has tasks will surface as an FK violation on
`tasks.status_id` rather than as a clean cascade. That is harmless in practice
because the action layer blocks the case entirely, but it will look surprising in
a psql session.

**Should composite `(status_id, project_id)` scoping foreign keys be added now?**
No — deliberately deferred. Plan §2.2 explicitly marks them as optional hardening
and names the action layer as the source of truth for cross-project scoping.
Adding them in Phase 0 would contradict that stated posture and would likely need
rework once the action layer's real semantics exist.

**How is the `chat_state` singleton row enforced?** By the database:
`id text primary key default 'singleton'` plus a `CHECK (id = 'singleton')`
constraint, with the literal exported as `CHAT_STATE_ID` from `lib/db/schema.ts`.
The CHECK makes the singleton an actual database guarantee rather than a
convention that every writer has to remember, and it costs one line; the exported
constant means the Phase 5 `/api/chat-state` route has exactly one thing to
import. Rejected: a fixed id with no CHECK, in either integer or text form —
both rely on discipline alone. A fallback was pre-authorised in case the installed
drizzle-kit could not express `check()`; it was not needed (see Assumptions).

**Should Drizzle relations be declared in Phase 0?** Yes. They are cheap to write
now and mean Phase 1 gets
`db.query.tasks.findMany({ with: { status: true, priority: true, project: true } })`
without further schema work.

**Should `lib/db/` expose a barrel file?** Yes — `lib/db/index.ts` re-exports
`db`, `closeDb`, the `Database` type, and the schema (both namespaced as `schema`
and flat), so consumers write `import { db, tasks } from "@/lib/db"`. This
mirrors the repo's existing thin-bridge convention (`lib/ai.ts`) and gives Phase
1's action layer one stable import path regardless of how `lib/db/` is
reorganised internally later. Rejected: direct imports from `lib/db/schema` and
`lib/db/client` everywhere — more explicit, but it multiplies import churn if the
internals move.

### Seeding

**What is the idempotency predicate?** Emptiness of the `projects` table —
`SELECT id FROM projects LIMIT 1`. Never a name match, and never an upsert on
"Personal". This is mandated by plan §2.2 and US-A1.5, and it is also the
semantically correct rule: once the user has any project at all, the workspace is
initialised, and the starter data must not reappear even if the Personal project
was renamed or deleted. Rejected: upsert by name (would resurrect the starter
project after a deliberate delete); a dedicated `seeded` flag row (extra state for
no benefit).

**Should seeding run only from `pnpm db:seed`, or also at application boot?**
Both, through a single exported `ensureSeeded(database: Database = db)` in
`lib/db/seed.ts`, called by a direct-invocation guard at the bottom of that same
file and by a root `instrumentation.ts` `register()` hook. Plan §2.2 names both
mechanisms. A CLI-only seed would silently fail US-A1 for anyone who runs
`pnpm dev` against a fresh database without first running `pnpm db:seed` — which
is exactly the "fresh install, open the app" scenario US-A1.1 describes. The hook
is node-runtime-guarded, env-guarded, and try/catch-wrapped, so it can never
block boot. Rejected: CLI only (simpler, but contradicts the plan and the user
story's framing); boot only (loses the reproducible CLI evidence the phase exit
criteria require).

**How is the seed made safe against two callers racing — the CLI and app boot at
the same moment?** `ensureSeeded` opens a transaction and takes
`pg_advisory_xact_lock(4924210)` before the emptiness check; the lock releases
automatically with the transaction. Check-then-insert is not safe under READ
COMMITTED on its own, and this phase deliberately creates two concurrent call
sites. One line of SQL removes the entire race. Rejected: accepting the race —
this is a single-user application so a collision is unlikely, but the failure
mode is duplicate starter projects, which is precisely what US-A1.5 forbids; and
a unique constraint on `projects.name`, which encodes the wrong rule (the rule is
"the projects table is empty", not "no project is named Personal", and a user may
legitimately create a second project called Personal later).

**Should `ensureSeeded` accept an injectable database handle?** Yes —
`ensureSeeded(database: Database = db)`, with `Database` exported from
`lib/db/client.ts`. Phase 1's plan calls for Vitest coverage of seed idempotency
alongside the rule tests, and a default-parameter injection point costs nothing
now while letting those tests run against a transaction or a throwaway database
without a refactor. This decision paid off within the phase itself: the
verification harness at
`docs/verification/phase-0/harness/seed-idempotency.ts` uses it to exercise the
real code path inside a rolled-back transaction. Rejected: hard-coding the
module-level `db` handle, which would have forced a Phase 1 refactor.

**How should the phase produce its data-verification evidence — a separate psql
query, or something built in?** Built in: `describeSeedState()` in
`lib/db/seed.ts` re-queries and prints the project with its ordered statuses and
priorities on every CLI run, whether it seeded or skipped. A single
`pnpm db:seed` therefore produces both required evidence artifacts — the
seeded/skipped line and the state dump — with no second tool, no separate
connection, and no risk of a connection string being pasted into an evidence
bundle. Rejected: a separate psql session or a `drizzle-kit studio` screenshot
(more moving parts, and psql invocations risk exposing credentials in captured
output).

### Database connections and environment

**How do standalone processes — drizzle-kit and the seed script — obtain
`DATABASE_URL`, given that Next auto-loads `.env.local` but bare Node processes
do not?** Through `lib/env.ts`, which calls Node 24's built-in
`process.loadEnvFile('.env.local')`, guarded by both `!process.env.DATABASE_URL`
and an `existsSync` check, and is imported as the first statement of
`drizzle.config.ts` and `lib/db/client.ts`. This adds zero dependencies — the
plan's dependency list contains no dotenv — and the double guard makes it a
strict no-op under `next dev` / `next build` and in any deployed environment
where the file is absent, so importing it from `client.ts` is safe rather than
ordering-dependent. Rejected: `dotenv` or `dotenv-cli` (a dependency the plan does
not list); `node --env-file` / `tsx --env-file` flags (works for the seed script
but not for `drizzle.config.ts`, which drizzle-kit loads itself, so it would have
meant two mechanisms instead of one).

**Which connection string does each consumer use, given that Neon provides both a
pooled and a direct endpoint?** The application runtime (`lib/db/client.ts`) uses
`DATABASE_URL` — the pooled `-pooler` endpoint — with postgres.js configured
`{ prepare: false, max: 5 }`. `drizzle.config.ts` prefers
`DATABASE_URL_UNPOOLED ?? DATABASE_URL` for migrations. Neon's pooled endpoint
runs PgBouncer in transaction mode, which does not support the session-level
prepared statements that postgres.js uses by default, so `prepare: false` is
mandatory there; DDL, meanwhile, is happiest over a direct session, and
`.env.local` already provides the unpooled URL. Rejected: pooled for everything
(risks DDL oddities and needs `prepare: false` regardless); unpooled for
everything (defeats the point of pooling for a serverless app and burns direct
connections).

**How should the postgres.js client behave under Next's dev hot-reload?** It is
cached on `globalThis` outside production, so recompiles do not leak Neon
connections.

**How is the seed script executed, given that Node cannot resolve the `@/*`
tsconfig path alias?** By adding `tsx` as a devDependency —
`"db:seed": "tsx lib/db/seed.ts"`. This is one devDependency beyond the plan's
explicit list, justified because there is no zero-config alternative: Node 24's
native type stripping does not resolve `@/*` aliases and requires explicit `.ts`
extensions on relative imports, which would force `allowImportingTsExtensions`
and leave these files stylistically inconsistent with the rest of the repo. `tsx`
is the minimal, conventional answer and is dev-only. Rejected:
`node --experimental-strip-types` with rewritten imports (works, but pollutes
source style); a bundler step for one script (disproportionate); relative-only
imports inside `lib/db/` (would still break on the `@/lib/domain/defaults` import
that the shared-defaults decision requires).

### EVE

**Install via the scaffolder, or by hand?** The scaffolder, and it worked.
`pnpm dlx eve@latest init .` ran cleanly under pnpm — no lockfile fighting, no
clobbered files, and no stray npm invocation inside a pnpm repo. Plan §4 names
the scaffolder as the preferred path and §6 risk 3 pre-authorised a manual
fallback (`pnpm add eve@latest` plus hand-written `agent/` files); the fallback
was not needed. The scaffolder added `eve@^0.27.8` and `@vercel/connect@0.4.2`,
an `engines.node: 24.x` floor, a `minimumReleaseAgeExclude` list for EVE's
fast-moving prerelease dependencies, and `agent/{agent.ts,instructions.md,
channels/eve.ts}`. It did **not** touch `next.config.ts`, which was wrapped with
`withEve()` by hand. Its dependency entries were re-sorted alphabetically to
match the existing convention. Rejected: going manual unconditionally
(deterministic, but silently discards the plan's stated preference and any
beneficial scaffolder output).

**Which import specifiers does EVE actually use?** Verified against
`node_modules/eve/docs/` rather than recalled, because
`docs/eve-framework-notes.md` turned out to be partly wrong:

| Symbol | Actual specifier |
|---|---|
| `defineAgent` | `eve` |
| `withEve` | `eve/next` |
| `eveChannel` | `eve/channels/eve` |
| `localDev`, `vercelOidc`, `placeholderAuth`, `none` | `eve/channels/auth` |

The notes assumed a single `eve/channels` entry point. In reality **channel
construction and auth helpers come from two different subpaths.**
`agent/instructions.md` auto-discovery as the system prompt is confirmed
(`node_modules/eve/docs/reference/project-layout.md`).

**How should an `ai` / `zod` peer-version conflict with `eve` be resolved, if one
appears?** The policy decided in advance was to bump this repo's `ai` and `zod`
to whatever `eve@latest` requires, rather than pinning `eve` to an older release
— because Phase 5 rewires the chat UI from `@ai-sdk/react`'s `useChat` to
`eve/react`'s `useEveAgent` anyway, so aligning on EVE's expected versions now
avoids a second migration later. **In the event, no bump was needed.**
`eve@0.27.8` declares `ai: ^7.0.34` and the repo already had `ai@^7.0.37`; `zod`
is not an EVE peer at all. Nothing was changed and `app/page.tsx` still builds.
Rejected (had the conflict materialised): pinning eve backwards (locks the
project to a stale version of a fast-moving young framework); pnpm `overrides` to
force resolution (hides a real incompatibility rather than resolving it).

**What auth posture should the EVE HTTP channel have in v1?** An explicit
`agent/channels/eve.ts` with `eveChannel({ auth: [localDev()] })`. The scaffold
generates `[vercelOidc(), localDev(), placeholderAuth()]`;
`docs/eve-framework-notes.md` §10.2 flagged the posture as an open decision
deferred to implementation time. v1 is single-user and local-only with no
deployment until Phase 7, so `localDev()` alone is the simplest correct posture —
and writing it as an explicit line of code rather than inheriting an implicit
default gives Phase 7's deploy-auth decision exactly one obvious file to revisit.
The file carries a `PHASE 7` comment naming what to restore. Verified working:
the eve dev server, `/eve/v1/info`, `/eve/v1/health`, and a full session
round-trip all succeed under this policy. Rejected: relying on EVE's implicit
default (works, but leaves the security posture invisible in version control);
`none()` (wrong to enshrine before a deploy decision exists).

**How is the agent's model identifier sourced?** As
`process.env.EVE_MODEL ?? "anthropic/claude-sonnet-5"` in `agent/agent.ts`, with
`EVE_MODEL` documented as optional in `.env.example`. The env var preserves the
design goal of a per-environment model swap without a code change. The default
literal is a **build-time** correction: the design blueprint specified
`anthropic/claude-opus-4.8`, chosen before eve was installed and never verified
to exist on the gateway, whereas the scaffolder's `anthropic/claude-sonnet-5` is
version-matched to the installed eve and was proven working by a live turn.
Rejected: a bare hard-coded literal with no env override (would require a code
edit and commit to try a different model during Phase 4 tuning).

**Should `agent/tools/` and `agent/lib/` be reserved with `.gitkeep`
placeholders?** No — and this is a **build-time reversal of the design decision,
forced by a hard failure, not a style preference.** The design had called for
`.gitkeep` placeholders matching the repo's existing empty-directory convention.
EVE's module discovery rejects unsupported files inside authored slots, and the
dev server exits with code 1 and
`Expected ".../agent/lib/.gitkeep" to be a supported authored module within
"lib/"`. Both directories were removed entirely; git does not track empty
directories anyway, so the placeholders bought nothing even before they broke the
boot. Phase 4 will create these directories with real `.ts` modules. The
underlying decision that no stub tool files should exist in Phase 0 still stands:
every tool in plan §2.4 wraps a `lib/actions/*` function that does not exist
until Phase 1, so stubs would be throwaway code with nothing real to call, and a
half-registered tool would muddy the hello-world smoke test.

**Should `.eve/` be committed?** No — it is gitignored. The dev server writes
runtime snapshots there, including a full copy of the source tree and
`node_modules`.

### Tooling, tests, and repo hygiene

**Should Phase 0 write any Vitest tests at all, given there is nearly nothing to
test yet?** Yes — exactly one file, `lib/domain/defaults.test.ts`, asserting the
product spec §4.1/§4.3 invariants: status order, Done flagged as completed,
priority order, and exactly one default priority. It establishes the colocated
test convention, proves `pnpm test` works before Phase 1 depends on it, and
guards the one piece of domain knowledge Phase 0 actually creates. Installing a
test runner with zero tests leaves the harness unproven. Rejected: no tests until
Phase 1; DB-integration tests for the seed (out of scope — the two-run CLI
evidence plus the rolled-back harness cover idempotency for this phase).

**What test file layout?** Colocated `*.test.ts` next to source, with
`vitest.config.ts` at the repo root mirroring the `@/*` alias from tsconfig. This
keeps tests adjacent to what they test as Phase 1 adds a much larger action-test
suite, and avoids introducing another top-level directory in a repo whose
conventions clearly resist ad hoc top-level directories. Rejected: a parallel
`tests/` tree — conventional elsewhere, but it adds distance between rule and
test, and Phase 1's rule tests benefit most from proximity.

**How should Vitest, ESLint, and Prettier be scoped?** With exclude globs that
match at any depth — `**/node_modules/**`, `**/.next/**`, `**/.eve/**`,
`**/drizzle/**` — not the top-level-only `node_modules/**` the blueprint
specified. This is a **build-time** correction: the top-level globs let roughly
1,800 third-party tests into the Vitest run, from nested `node_modules` and from
EVE's `.eve/dev-runtime` snapshots. The same problem affected ESLint and
Prettier, because `.eve/` holds a full source-tree snapshot per dev boot, so lint
warnings grew from 2 to 8 across three boots and would have kept climbing. The
same ignores were therefore added to `eslint.config.mjs` and `.prettierignore`.

**pnpm's native-build gate was silently inert — keep the existing convention or
fix it?** Fix it. `pnpm-workspace.yaml` used an `allowBuilds:` map
(`sharp: true`, `unrs-resolver: true`, `msw: false`), but pnpm 10.18.3 does not
recognise that key; it honours `onlyBuiltDependencies` and
`ignoredBuiltDependencies`. This was verified empirically rather than assumed: a
clean `rm -rf node_modules && pnpm install` warns about ignored build scripts
under `allowBuilds` and is silent under `onlyBuiltDependencies`. The file was
rewritten with the honoured keys, preserving the original allow/deny intent and
adding `esbuild` (pulled in by Vitest and tsx). Keeping a non-functional gate
would have left the repo's stated build policy unenforced. `eve init` later
appended its own `allowBuilds: sharp: false`, which was dropped for the same
reason and because it contradicts this repo's intent to build sharp.

**`.env.example` is caught by the blanket `.env*` gitignore rule — force-add it,
or change the ignore?** Change the ignore, with an explicit `!.env.example`
negation. The blueprint suggested `git add -f`, but that only works for whoever
remembers it; every future contributor regenerating the template would hit the
same wall. The negation makes the intent declarative. Verified in both
directions: `.env.example` is addable, and `.env.local` is still ignored and
remains untracked.

**Should `@types/node` be left at its current `^20`?** No — bumped to `^24`. The
runtime is Node v24.10.0 and `lib/env.ts` calls `process.loadEnvFile`, which is
not typed in `@types/node@20`; without the bump `pnpm typecheck` fails on new
code. Rejected: casting around the missing type with `(process as any)` — that
hides a genuine version mismatch and would trip ESLint's TypeScript rules.

**Should Phase 0 wire a TanStack Query provider into `app/layout.tsx`?** No —
install the dependency per plan §4 and defer all provider wiring to Phase 3. Plan
§4 lists only the dependency addition for Phase 0; the query layer is a Phase 3
concern (§2.6). Touching `app/layout.tsx` now would mean editing a file with
pre-existing formatting debt for no Phase 0 exit criterion, and the provider would
need revisiting in Phase 3 anyway for the default query options that live-sync
depends on.

---

## Assumptions

**The provisioned Neon instance runs Postgres 13 or newer, so `gen_random_uuid()`
is available in core without the pgcrypto extension.** Basis: Neon provisions
Postgres 16/17 for new projects, and `NEON_PROJECT_ID` in `.env.local` indicates
a recently provisioned instance. This was subsequently confirmed — the migration
applied cleanly with the `DEFAULT gen_random_uuid()` clause. If it had been
wrong, `pnpm db:migrate` would have failed immediately, and the fix would have
been either prepending `CREATE EXTENSION IF NOT EXISTS pgcrypto;` to the
generated migration or switching to `$defaultFn(() => crypto.randomUUID())`.

**`DATABASE_URL` is Neon's pooled (PgBouncer) endpoint and
`DATABASE_URL_UNPOOLED` is the direct endpoint.** Basis: verified without
printing any values — `grep -c -- "-pooler" .env.local` returns 6, and both
`DATABASE_URL_UNPOOLED` and `POSTGRES_URL_NON_POOLING` are present in the key
list. If `DATABASE_URL_UNPOOLED` were absent or invalid, `drizzle.config.ts`
already falls back to `DATABASE_URL`, and DDL over PgBouncer transaction mode
generally works, so migrations would still apply. If `DATABASE_URL` turned out to
be direct rather than pooled, `prepare: false` would cost a little throughput and
nothing else.

**postgres.js requires `prepare: false` against Neon's pooled endpoint.** Basis:
PgBouncer in transaction pooling mode does not support the session-level prepared
statements postgres.js uses by default; this is a well-documented
incompatibility. If it is wrong, the cost is purely performance — disabling
prepared statements never breaks correctness — and it would be worth revisiting
only at a scale this application will not reach.

**Node v24.10.0 and pnpm 10.18.3 are adequate, despite the implementation plan
claiming Node 26 and pnpm 11.** Basis: verified directly with `node -v` and
`pnpm -v`. Node 24 clears EVE's declared floor (`engines.node: >=24`) and
provides `process.loadEnvFile`, which landed in Node 20.12/21.7 and is stable in
24. Nothing was blocked. If a later phase's tooling declares a higher floor, the
remedy is a local Node upgrade; if `process.loadEnvFile` ever misbehaves, the
fallback is `dotenv` as a devDependency, recorded as an added dependency.

**`pnpm dev` — that is, `next dev` under `withEve(nextConfig)` — boots the EVE
runtime in the same process, with no separate `eve dev` command or
concurrently-style script.** Basis: `docs/eve-framework-notes.md` §3, and now
directly confirmed: the dev-server transcript shows
`[eve:dev] server listening at ...` inside the single `next dev` process, and
`/eve/v1/health` and `/eve/v1/info` respond same-origin on port 3000. Nothing
downstream depends on the dev-script shape, so a future change here is contained.

**The installed drizzle-kit ships a working `migrate` command driven by
`drizzle.config.ts`, and the installed drizzle-orm exports `check()` and uses the
array-returning third argument to `pgTable`.** Basis: that is the current
documented workflow and the current (v0.36+) API. Both were confirmed against the
installed drizzle-orm v0.45.2 and drizzle-kit v0.31.10; the `chat_state` CHECK
constraint and the migration pipeline both work as designed. Had the API been the
legacy object-returning form, the change would have been mechanical and caught by
`pnpm typecheck` before any migration was generated.

**Next.js 16.2.6 supports a root-level `instrumentation.ts` exporting an async
`register()`, invoked once per server boot on the Node runtime.** Basis:
instrumentation was stabilised in Next 15, and there is no `src/` directory here,
so the root location applies. Confirmed by a temporary probe log during
verification. If a future Next upgrade removes or renames it, US-A1 still passes
via `pnpm db:seed` and the app-boot half can move to Phase 3's page-load path;
the `!process.env.DATABASE_URL` guard and the try/catch already prevent it from
breaking a build.

**The `pnpm db:seed` CLI run against an empty database, plus a probe-verified
`register()` invocation, together prove the app-boot seeding path — without
executing the specific combination "boot hook against an empty database".**
Basis: staging that exact test required truncating the seeded tables, which the
environment's destructive-operation guard blocked, and that guard was not worked
around. The two halves were covered separately instead: the first CLI run
executed `ensureSeeded()` against a genuinely empty database and seeded it
correctly, and a temporary probe log confirmed that `register()` fires on
`next dev` boot and calls the same `ensureSeeded()`, returning
`{ seeded: false, projectId }`. The probe was removed afterwards and its absence
verified. If this assumption is wrong, the untested combination could misbehave —
but US-A1 would still hold via `pnpm db:seed`, and the failure is contained by
the try/catch that prevents it from blocking boot. A Phase 1 integration test
using the injectable `ensureSeeded(database)` parameter against a throwaway
database or transaction would close the gap cheaply.

**Neither the migration nor the seed evidence output contains credential
material.** Basis: `drizzle-kit migrate` reports applied files and statements, and
`describeSeedState()` prints only row data. The mitigation is procedural and was
followed: every captured output was visually scanned before inclusion, and
`.env.local` was never `cat`-ed or echoed. If a credential fragment ever does
reach an evidence file, it must be redacted and the credential rotated.

**The pre-existing Prettier formatting debt in `app/`, `components/`,
`lib/ai.ts`, and `lib/message-animations.ts` should be left alone.** Basis:
`prettier --check` flags 7 files, none of which this phase created or touched.
Reformatting them would produce a large diff unrelated to Phase 0 and would
obscure the phase's actual changes in review. Every file authored in this phase
passes `--check`. If the project wants a uniformly formatted tree, `pnpm format`
fixes all 7 in one commit — worth doing before Phase 5 rewrites `app/page.tsx`,
so the reformat does not collide with that work.

**The demo `app/page.tsx` does not need to keep working unchanged through
Phase 0.** Basis: it is a fully scripted conversation with a fake transport and
no backend calls, and plan §2.5 schedules its replacement in Phase 5. In the
event nothing broke it, since no `ai`/`zod` bump was required.

**Committing the `pnpm-lock.yaml` changes from `eve init` is correct despite
unmet transitive peer warnings for `@emnapi/core` and `@emnapi/runtime` under
`@rolldown/binding-wasm32-wasi`.** Basis: the warnings are three levels deep
under eve → nitro → rolldown, they affect only the wasm32-wasi binding rather
than the native darwin-arm64 one actually in use, and nothing in the toolchain
failed — install, dev boot, build, migrate, seed, and a live agent turn all
succeeded. If a later phase hits a rolldown or wasm resolution failure, the fix is
a `pnpm.overrides` entry pinning `@emnapi/core` and `@emnapi/runtime` to
`^2.0.0-alpha.3`, or waiting for eve to update its nitro pin.

---

## Deviations from the implementation plan

1. **`agent/tools/.gitkeep` and `agent/lib/.gitkeep` were not created, and both
   directories do not exist.** They break EVE's module discovery and fail the dev
   server with exit code 1. Phase 4 creates these directories with real modules.
   *This is the most important deviation for downstream phases.*

2. **The assumed EVE import specifiers in `docs/eve-framework-notes.md` were
   partly wrong and were corrected against `node_modules/eve/docs/`.**
   `eveChannel` comes from `eve/channels/eve` and the auth helpers from
   `eve/channels/auth` — not from a single `eve/channels` entry point.
   `defineAgent` from `eve` and `withEve` from `eve/next` were correct.
   `docs/eve-framework-notes.md` should be corrected before Phase 4/5.

3. **The agent model default is `anthropic/claude-sonnet-5`**, the scaffolder's
   version-matched choice proven by a live turn, rather than the plan's
   unverified `anthropic/claude-opus-4.8`. Still overridable via `EVE_MODEL`.

4. **`pnpm-workspace.yaml`'s `allowBuilds:` key was replaced** with
   `onlyBuiltDependencies` / `ignoredBuiltDependencies`. The instruction was to
   add entries "following the existing pattern", but that key is inert under pnpm
   10.18.3, so following the existing pattern would have left the build gate
   unenforced.

5. **Vitest, ESLint, and Prettier exclude globs match at any depth**
   (`**/node_modules/**`, `**/.eve/**`, `**/drizzle/**`) rather than the planned
   top-level-only form. The ESLint and Prettier ignores were not anticipated by
   the plan because `.eve/` did not exist when it was written.

6. **`.gitignore` gained `!.env.example`** rather than relying on
   `git add -f .env.example`, so the template stays trackable for future
   contributors. `.gitignore` also gained `.eve` for EVE's dev-runtime snapshots.

7. **`tsx` was added as a devDependency** beyond the plan's explicit dependency
   list, to run the seed script under the `@/*` path alias. `@types/node` was
   bumped from `^20` to `^24` for the same class of reason.

8. **The `eve init` scaffolder also added `engines.node: 24.x` to `package.json`
   and a `minimumReleaseAgeExclude` list to `pnpm-workspace.yaml`**; both were
   kept as generated.

9. **No housekeeping commit was made** for the Neon skills, `skills-lock.json`,
   and the `.vercel` gitignore entry, because commit `0ce2de1` already contains
   all of it. See the first decision above.

10. **`pnpm db:migrate` re-runs emit harmless Postgres NOTICEs** (`schema
    "drizzle" already exists, skipping`, `relation "__drizzle_migrations" already
    exists, skipping`) alongside the success line. Migration is genuinely
    idempotent — verified across three runs.

---

## Known gaps and what the next phase inherits

**US-A1.4 is blocked, not passed.** The verification packet
(`docs/verification/phase-0/README.md`) records an overall verdict of **partial**:
four of five US-A1 acceptance criteria pass, and A1.4 — "a task can be created in
the seeded project immediately, through either the UI or the agent, with no
additional setup" — cannot be exercised because neither interface exists in
Phase 0. There is no `app/api/`, no `agent/tools/`, and no task component. The
live agent says so itself when asked to create a task. What *is* verified is the
data-layer precondition: a task can be inserted into the seeded project using
nothing but the seeded defaults (first status by order, default priority) with no
extra setup. **A1.4 must be re-verified once the Phase 2 UI/API and the Phase 4
agent tools land.** This is an expected consequence of phase sequencing, not a
defect in Phase 0's work.

**Two verification steps were observed non-destructively rather than from a
literal clean slate.** The environment blocks destructive SQL, so the database
could neither be wiped nor branched. The empty→seeded transition was therefore
observed inside a rolled-back transaction against the real Neon database using
the real `ensureSeeded()`, and `pnpm db:migrate` was observed as an
already-applied no-op rather than as a first-time apply. Both caveats are stated
plainly in the verification packet. A future phase with a disposable Neon branch
could close both cheaply.

**`docs/eve-framework-notes.md` is stale and should be corrected before Phase 4
or 5** — specifically the `eve/channels` entry-point claim (deviation 2 above).

**Pre-existing Prettier debt in 7 files** (`app/`, `components/`, `lib/ai.ts`,
`lib/message-animations.ts`) was deliberately not touched. Running `pnpm format`
before Phase 5 rewrites `app/page.tsx` would avoid a collision.

**Deferred by design, for later phases to pick up:**

- Composite `(status_id, project_id)` scoping foreign keys remain unimplemented;
  the action layer is the source of truth for cross-project scoping (Phase 1).
- No TanStack Query provider is wired into `app/layout.tsx` — the dependency is
  installed but unused (Phase 3).
- `agent/tools/` and `agent/lib/` do not exist and must be created with real
  `.ts` modules, never `.gitkeep` (Phase 4).
- `CHAT_STATE_ID` is exported from `lib/db/schema.ts` for the
  `/api/chat-state` route to upsert against (Phase 5).
- EVE channel auth is `[localDev()]` only, with a `PHASE 7` comment in
  `agent/channels/eve.ts` naming exactly what to restore before deploying.
- `ensureSeeded(database)`'s injectable handle is unused by any Vitest test so
  far; Phase 1's suite is expected to use it.

**Code review outcome:** one finding was raised, at neither critical nor high
severity. Nothing required fixing before merge.

**Not carried forward:** every item in Phase 0's scope was completed. Nothing in
scope was left unfinished.

---

## Addendum — Phase 0r remediation

**Added 2026-07-28, on branch `phase-0r-remediation`. Nothing above this line
has been altered; the history is the point.**

PR #1 landed a substantially rewritten `docs/implementation-plan.md` — dependency
policy §1.1, testability affordances §2.7, agent-browser UI validation §3, the
E2E suite §4, renumbered phases §6 — *while* Phase 0 was executing. Phase 0 was
therefore built, correctly, against a spec that no longer exists. Several
decisions recorded above are now superseded by the revised plan rather than by
any fault in the reasoning that produced them.

What Phase 0r changed:

- **`vitest` and `tsx` removed.** §1.1 rejects vitest in favour of `node --test`
  with `node:test` + `node:assert/strict`, and permits no dependency outside its
  allowed table — `tsx` is not in it. Node runs the TypeScript directly.
- **The one test moved and rewritten.** `lib/domain/defaults.test.ts` became
  `tests/unit/domain/defaults.test.ts` using `node:test`. §4.1's layout is
  `tests/unit/`, `tests/api/`, `tests/e2e/`; tests are no longer colocated with
  source.
- **`agent-browser` pinned** as a devDependency (0.33.1, exact) and verified
  end to end against the running app for the first time.
- **`scripts/migrate.ts`, `scripts/seed.ts`, `scripts/reset.ts` added**, and the
  package.json scripts set per §4.7. `db:migrate` is no longer `drizzle-kit
  migrate`. `lib/db/seed.ts` kept its logic and lost only its CLI block, so
  `instrumentation.ts` is unchanged.
- **`GET /api/health` added** (§2.7) returning `{ok, db, migrations}` — the route
  every later phase's harness polls, which did not exist.
- **`.env.example` gained `DATABASE_URL_TEST`** and its separate-project warning.
- **`docs/eve-framework-notes.md` §3 corrected.** The stale single-entry-point
  claim this document flagged during Phase 0 — but did not fix — is now fixed:
  `eveChannel`/`defaultEveAuth` come from `eve/channels/eve` and
  `localDev`/`vercelOidc` from `eve/channels/auth`.

One item recorded above is now stale rather than superseded:
`docs/verification/phase-0/harness/seed-idempotency.ts` invokes `pnpm exec tsx`
and uses `@/` imports, so it will not run now that `tsx` is gone. It is left
untouched on purpose — it is the record of what was actually executed during
Phase 0, and editing it would misrepresent that.

Full reasoning, including several places where the revised plan's own stated
environment facts turned out to be false on this machine, is in
`docs/decisions/phase-0r-decisions.md`.

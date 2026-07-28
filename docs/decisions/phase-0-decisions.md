# Phase 0 — Foundations: decisions and assumptions

Recorded during implementation on 2026-07-28. Every entry below was a choice
the governing documents left open, or a place where reality contradicted a
planning assumption. Later phases should treat this as the record of what was
actually built, and `docs/eve-framework-notes.md` should be corrected against
the EVE section.

---

## 1. What the plan got wrong about the environment

**Node and pnpm versions.** The plan claims Node 26 / pnpm 11. The machine runs
**Node v24.10.0 and pnpm 10.18.3**. Node 24 clears EVE's declared floor
(`engines.node: >=24`) and provides `process.loadEnvFile`, so nothing was
blocked — but `@types/node` had to be bumped from `^20` to `^24`, because
`process.loadEnvFile` is not typed in the v20 definitions and `pnpm typecheck`
fails on `lib/env.ts` without it.

**The housekeeping commit was already done.** Phase scope asked for a commit
adding the Neon agent skills, `skills-lock.json`, and a `.vercel` gitignore
entry. Commit `0ce2de1` already tracks all of it; `git ls-files .agents
skills-lock.json` confirms. No commit was made. Note also that the skills live
at `.agents/skills/`, **not** `.claude/skills/` — the phase text's path does not
match disk, and no `.claude/skills` directory exists.

**pnpm's native-build gate was silently inert.** `pnpm-workspace.yaml` used an
`allowBuilds:` map (`sharp: true`, `unrs-resolver: true`, `msw: false`). pnpm
10.18.3 does not recognize that key — it honors **`onlyBuiltDependencies`** and
**`ignoredBuiltDependencies`**. Verified empirically: a clean `rm -rf
node_modules && pnpm install` warns about ignored build scripts under
`allowBuilds` and is silent under `onlyBuiltDependencies`. Rewrote the file with
the honored keys, preserving the original allow/deny intent and adding `esbuild`
(pulled in by vitest and tsx). `eve init` later appended its own
`allowBuilds: sharp: false`, which was dropped for the same reason and because
it contradicts this repo's stated intent to build sharp.

---

## 2. EVE

**Install path: the scaffolder, not the manual fallback.** `pnpm dlx eve@latest
init .` ran cleanly under pnpm — no lockfile fighting, no clobbered files, no
npm invocation. Plan §6 risk 3's manual fallback was not needed. The scaffolder
added `eve@^0.27.8` and `@vercel/connect@0.4.2`, an `engines.node: 24.x` floor,
a `minimumReleaseAgeExclude` list for EVE's fast-moving prerelease
dependencies, and `agent/{agent.ts,instructions.md,channels/eve.ts}`. It did
**not** touch `next.config.ts`. Dependency entries were re-sorted
alphabetically to match the existing convention.

**No `ai`/`zod` bump was needed.** Plan §6 risk 4 flagged possible peer
coupling. `eve@0.27.8` declares `ai: ^7.0.34`; this repo already has
`ai@^7.0.37`. `zod` is not an EVE peer at all. Nothing was changed, and
`app/page.tsx` still builds.

**Import specifiers — `docs/eve-framework-notes.md` is partly wrong.** Verified
against `node_modules/eve/docs/`:

| Symbol | Actual specifier |
|---|---|
| `defineAgent` | `eve` |
| `withEve` | `eve/next` |
| `eveChannel` | `eve/channels/eve` |
| `localDev`, `vercelOidc`, `placeholderAuth`, `none` | `eve/channels/auth` |

The notes' assumption of a single `eve/channels` entry point is wrong —
**channel construction and auth helpers come from two different subpaths.**
`agent/instructions.md` auto-discovery is confirmed
(`node_modules/eve/docs/reference/project-layout.md`).

**Channel auth: `[localDev()]` only.** The scaffold generates
`[vercelOidc(), localDev(), placeholderAuth()]`. v1 is single-user and
local-only with no deployment until Phase 7, so `localDev()` alone is the
simplest correct posture. `agent/channels/eve.ts` carries an explicit `PHASE 7`
comment naming what to restore before deploying. Confirmed working: the eve dev
server, `/eve/v1/info`, and a full session round-trip all succeed with this
policy.

**Agent model.** `process.env.EVE_MODEL ?? "anthropic/claude-sonnet-5"`. The
default is the scaffolder's choice, kept rather than overridden; the env var
allows a per-environment swap without a code change and is listed as optional
in `.env.example`.

**`agent/tools/` and `agent/lib/` are NOT reserved with `.gitkeep`.** The
blueprint called for `.gitkeep` placeholders. **This breaks EVE**: module
discovery rejects unsupported files inside authored slots and the dev server
exits 1 with `Expected ".../agent/lib/.gitkeep" to be a supported authored
module within "lib/"`. The directories were removed; git does not track empty
directories anyway. Phase 4 creates them with real `.ts` modules.

**`.eve/` is gitignored.** The dev server writes runtime snapshots there,
including a full copy of the source tree and `node_modules`.

---

## 3. Schema

**uuid primary keys with a DB-side default** — `uuid("id").primaryKey()
.defaultRandom()`, emitting `gen_random_uuid()` (Postgres core since 13, no
pgcrypto needed; confirmed working against the provisioned Neon instance).
Native uuid storage, and raw SQL inserts during debugging work without
supplying an id. The application may still pass its own `crypto.randomUUID()`
when it wants a known id ahead of time.

**Physical column `sort_order`, TS field `order`.** `order` is a reserved SQL
word. Drizzle would quote it correctly, but every hand-written psql
verification query would then need quoting too, and an unquoted `select name,
order from statuses` fails confusingly. The rename is invisible to all callers.

**Ordering is 0-based** — `order` equals the array index in `DEFAULT_STATUSES` /
`DEFAULT_PRIORITIES`. Makes the seed a direct `map((item, index) => ...)`.
Phase 1's append semantics (`max(order) + 1`) are unaffected.

**Foreign keys.** `statuses.project_id`, `priorities.project_id`, and
`tasks.project_id` CASCADE from `projects`. `tasks.status_id` and
`tasks.priority_id` **RESTRICT** — deleting a list entry that tasks still
reference is a blocked operation in the product rules (spec §7), so the
database refuses it as defense in depth behind the action layer.

**No composite `(status_id, project_id)` scoping FKs.** Plan §2.2 marks them as
optional hardening and names the action layer as the source of truth for
cross-project scoping. Deliberately deferred.

**`chat_state` singleton is enforced by the database** — `id text primary key
default 'singleton'` plus `CHECK (id = 'singleton')`, with the value exported as
`CHAT_STATE_ID` so the Phase 5 route has exactly one literal to import. Verified
that the installed drizzle-orm (v0.45.2) exports `check()` and uses the
array-returning third argument to `pgTable`, so the blueprint's API assumption
held.

**Relations are declared** so Phase 1 gets `db.query.tasks.findMany({ with: {
status: true, priority: true, project: true } })` without further work.

---

## 4. Database connections

**Two endpoints, two consumers.** The app runtime (`lib/db/client.ts`) uses
`DATABASE_URL` — Neon's pooled `-pooler` endpoint — configured `{ prepare:
false, max: 5 }`, because PgBouncer in transaction mode does not support the
session-level prepared statements postgres.js uses by default. `drizzle.config
.ts` prefers `DATABASE_URL_UNPOOLED ?? DATABASE_URL`, so DDL runs over a direct
session.

**The client is cached on `globalThis`** outside production, so Next's dev
hot-reload does not leak Neon connections on every recompile.

**Env loading for standalone processes.** `lib/env.ts` calls Node 24's built-in
`process.loadEnvFile('.env.local')`, guarded by both `!process.env.DATABASE_URL`
and an `existsSync` check. No `dotenv` dependency. The double guard makes it a
strict no-op under `next dev`/`next build` and in any deployed environment where
the file is absent, so importing it from `client.ts` is safe rather than
ordering-dependent.

---

## 5. Seeding

**Idempotency predicate: the `projects` table is empty.** Never a name match,
never an upsert on "Personal" (plan §2.2, US-A1.5). Once the user has any
project the workspace is initialized, so the starter data must not reappear even
if they renamed or deleted the Personal project.

**Race safety.** `ensureSeeded` opens a transaction and takes
`pg_advisory_xact_lock(4924210)` before the emptiness check. Check-then-insert
is not safe under READ COMMITTED on its own, and this phase deliberately creates
two concurrent call sites. The lock releases with the transaction.

**Two entry points, one function.** Plan §2.2 names both. `pnpm db:seed` runs a
direct-invocation guard at the bottom of `lib/db/seed.ts`; a root
`instrumentation.ts` `register()` hook calls the same `ensureSeeded()`. A
CLI-only seed would silently fail US-A1.1 for anyone who runs `pnpm dev` on a
fresh database — which is exactly the "fresh install, open the app" scenario the
story describes. The hook is node-runtime-guarded, env-guarded, and
try/catch-wrapped so it can never block boot.

**Defaults live in `lib/domain/defaults.ts`, not in the seed script.** Product
spec §4.1/§4.3 requires the seeded Personal project (US-A1) and every project
created later (US-C1.2, Phase 1) to get byte-identical defaults. A private
literal list inside the seed script would force Phase 1 to duplicate it, and
duplicated constants are exactly the drift this app's shared-action
architecture exists to prevent. The module is dependency-free and unit-tested.

**`ensureSeeded(database: Database = db)` takes an injectable handle**, with
`Database` exported from `lib/db/client.ts`, so Phase 1's Vitest suite can run
seed-idempotency tests against a transaction or a test database without a
refactor.

**Evidence is built in.** `describeSeedState()` re-reads and prints the project
with its ordered lists on every CLI run, so `pnpm db:seed` alone produces both
required artifacts — the seeded/skipped line and the state dump — with no second
tool and no risk of a connection string reaching the evidence bundle.

---

## 6. Tooling

**`tsx` runs the seed script** (`"db:seed": "tsx lib/db/seed.ts"`). One
devDependency beyond the plan's list, justified because there is no zero-config
alternative: Node 24's native type stripping does not resolve the `@/*` tsconfig
alias and requires explicit `.ts` extensions on relative imports, which would
force `allowImportingTsExtensions` and make these files stylistically
inconsistent with the rest of the repo.

**Tests are colocated** (`lib/domain/defaults.test.ts`) with `vitest.config.ts`
at the root mirroring the `@/*` alias. Phase 0 ships exactly one test file —
asserting the spec §4.1/§4.3 invariants — so `pnpm test` is proven before
Phase 1 depends on it.

**Vitest exclude globs must match at any depth.** `node_modules/**` only matches
the top level; the initial run picked up ~1800 third-party tests from nested
`node_modules` and from EVE's `.eve/dev-runtime` snapshots. Corrected to
`**/node_modules/**`, `**/.next/**`, `**/.eve/**`, `**/drizzle/**`.

**`.gitignore` gained `!.env.example`.** The blanket `.env*` rule also caught
the template. An explicit negation keeps `.env.local` ignored while letting the
key-names-only template be tracked normally, rather than relying on every
future contributor remembering `git add -f`.

**No TanStack Query provider was wired into `app/layout.tsx`.** Plan §4 lists
only the dependency for Phase 0; the query layer is a Phase 3 concern (§2.6).

---

## 7. Verification note

The blueprint asked for proof that the app-boot hook seeds a *fresh* database.
Truncating the seeded tables to stage that test was blocked by the environment's
destructive-operation guard, and was not worked around. The equivalent evidence
was obtained non-destructively:

- `ensureSeeded()` was proven to seed an empty database by CLI run 1, which ran
  against exactly that state.
- `register()` was proven to fire on `next dev` boot and to call `ensureSeeded()`
  via a temporary probe log, which returned `{ seeded: false, projectId: ... }`
  against the seeded database and was then removed.

Both halves of the path are therefore covered by the same function; only the
specific combination "boot hook against an empty database" was not executed
directly.

# Phase 0r — Foundations remediation: decisions and assumptions

**Phase:** 0r — Foundations remediation
**Date:** 2026-07-28
**Branch:** `phase-0r-remediation`
**Governing documents:** `docs/product-spec.md`, `docs/user-stories.md`, `docs/implementation-plan.md`

PR #1 landed a substantially rewritten implementation plan — dependency policy
§1.1, testability affordances §2.7, agent-browser UI validation §3, the E2E
suite §4, renumbered phases §6 — *while* Phase 0 was executing, so Phase 0 was
built against a spec that no longer exists. Phase 0r closes that gap and adds no
product features. It removes `vitest` and `tsx`, moves the one existing test to
`tests/unit/` and rewrites it for `node:test`, pins `agent-browser`, replaces
`drizzle-kit migrate` and `tsx lib/db/seed.ts` with `scripts/{migrate,seed,reset}.ts`,
adds `GET /api/health`, verifies the browser toolchain end to end for the first
time, and corrects a stale claim in `docs/eve-framework-notes.md`.

Same two conventions as the Phase 0 record: a decision taken **at design time**
was settled before code was written; a decision taken **at build time** was
forced by something only discoverable once the code ran.

---

## Decisions

### The import seam that replaces `tsx`

**How do `scripts/**/*.ts` and `tests/**/*.ts`, run by bare `node` with no
bundler, resolve the `@/*` tsconfig path alias — given that no Node version
implements tsconfig `paths` and `tsx` is being removed?** By adding
`allowImportingTsExtensions: true` to `tsconfig.json` and adopting a rule:
**`@/*` is reserved for framework-mediated files** (`app/**`, `agent/**`,
`components/**`, `hooks/**`, `instrumentation.ts`, `next.config.ts`), while
**everything that must also run under bare node — all of `lib/**`, `scripts/**`,
`tests/**` — uses relative imports with explicit `.ts` extensions.**

This stays entirely inside the §1.1 allowed table: no loader, no bundler plugin,
no package. `tsx` was only ever needed for the alias, not for TypeScript syntax —
Phase 0's own decisions doc says so, and this phase re-confirmed it by running
`node --env-file=.env.local foo.ts` on a file importing `drizzle-orm` and
`postgres` with top-level `await`. The flag is legal because `noEmit: true` is
already set, so TypeScript never has to rewrite a specifier; `tsc --noEmit`
exits 0 with it on.

*Rejected: converting the whole repo to relative imports* — a large diff for no
benefit in files the bundler already resolves. *Rejected: a package.json
`imports` map (`"#lib/*"`)* — also dependency-free and Node-native, but it
introduces a second aliasing scheme alongside `@/*`, and explicit extensions
needed no new concept at all. It remains the fallback if Turbopack ever stops
accepting `.ts` specifiers.

### Where the seed logic lives

**`lib/db/seed.ts`'s logic must end up runnable as `scripts/seed.ts`. Does the
logic *move* there, with `instrumentation.ts` re-pointed at `@/scripts/seed`, or
does it *stay* in `lib/db/seed.ts` with `scripts/seed.ts` as a thin wrapper?**
It stays. `lib/db/seed.ts` remains a pure, DI-testable library; `scripts/seed.ts`
is argv, logging and an exit code with no logic of its own; `instrumentation.ts`
is not modified at all.

Moving the logic would make `instrumentation.ts` — and later `tests/unit`,
`tests/api`, and the §4.4 E2E harness's `db.reset()` — import application logic
from a folder of CLI entry points, a backwards `lib/ → scripts/` dependency
direction. Plan §2.2 explicitly wants *both* a `pnpm db:seed` entry point and an
app-boot check, which is precisely the shape of one shared library with two
callers. The phase's actual requirements (idempotency preserved,
`lib/domain/defaults.ts` still the source of defaults, a working
`scripts/seed.ts`) are satisfied either way.

What did change in `lib/db/seed.ts`: the trailing direct-invocation CLI block,
the `pathToFileURL` import and the now-unused `closeDb` import are gone, and the
four import specifiers became relative + `.ts`. `ensureSeeded`,
`describeSeedState`, `SEED_LOCK_KEY` and the empty-`projects` idempotency
predicate are otherwise untouched.

### The §4.7 script strings

**§4.7 mandates `"test:unit": "node --test tests/unit/"`. Should the scripts be
written exactly as specified?** No — **quoted globs**:
`node --test "tests/unit/**/*.test.ts"`. Every other token of every §4.7 string
is preserved verbatim. *(Build-time decision, though the probe was run at design
time.)*

Measured on this machine: `node --test tests/unit/` and `node --test tests/unit`
both fail with `MODULE_NOT_FOUND` — Node 24.10 tries to load the directory as a
module rather than recursing into it. This reproduces with a plain `.js` test
file, so it is not a TypeScript-discovery problem. The quoted-glob form exits 0,
and the quoting matters: Node's own glob engine must see `**`, not the shell's.
§4.7 was written against the plan's assumed Node 26.4; copying its literal
strings would have shipped a test suite that cannot run, which is the exact
opposite of this phase's exit criterion.

**Should `engines.node` stay at `"24.x"` while the plan asserts Node 26?** No —
`">=24.10.0"`. The plan's §1 "Environment prerequisites (verified): Node 26.4" is
false here; `node --version` is v24.10.0 and Homebrew carries only node@23 and
node@24. Everything in this phase was verified on 24.10.0. A floor of
`>=24.10.0` is honest about what is actually tested, still admits Node 26, and
sits above the version where native type stripping is on by default.

### `GET /api/health`

**How should the `migrations` field be computed, given no such helper existed
anywhere in the stack?** By comparing the hash of the newest migration file —
read with `readMigrationFiles()` from `drizzle-orm/migrator` — against the `hash`
of the newest row in `drizzle.__drizzle_migrations`. `"current"` on match (or
when there are zero migration files), `"pending"` on mismatch, no row, or a
missing `drizzle` schema, and `"unknown"` only when the database is unreachable.

Verified live against the dev database: the journal has one entry, and its hash
is identical to the newest recorded row's, which confirms two things that were
otherwise assumptions — that drizzle-kit's CLI-applied rows are hash-compatible
with `drizzle-orm`'s own file reader, and therefore that the exit criterion
`migrations:"current"` is reachable at all. The table and schema names were read
out of `node_modules/drizzle-orm/pg-core/dialect.js`, not recalled.

*Rejected: a row-count proxy* (`entries.length` vs `count(*)`) — coarser, and it
silently passes when a migration file has been edited in place. Zero new schema
and zero new dependencies either way.

**Should the route set `export const dynamic = "force-dynamic"`?** No — no
route-segment config at all.
`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
states plainly that "Route Handlers are not cached by default," and `route.md`'s
version history records that static-by-default for GET was removed in
v15.0.0-RC. Adding it would be inherited-from-training-data noise contradicting
the installed documentation — exactly what AGENTS.md's "this is NOT the Next.js
you know" mandate exists to prevent.

**Why 503 rather than always 200?** So a polling harness can fail fast on the
status line alone. The body still carries the full `{ok, db, migrations}` shape,
so a human or a test can tell "database unreachable" from "database up but
behind" without parsing a log.

### Choosing and guarding the reset target

**How does `scripts/reset.ts` choose its database, and where does the "refuse if
the test DB equals the dev DB" guard live?** An explicit `--target=dev|test`
flag, defaulting to `dev`. The `test` target resolves
`DATABASE_URL_TEST ?? TEST_DATABASE_URL` and refuses — non-destructively, exit 1,
before any connection is opened — when that is unset or `=== DATABASE_URL`.

The obvious alternative, "refuse whenever `DATABASE_URL_TEST` is unset," would
have bricked the plan's own mandated `pnpm db:reset`: `.env.local` does not
define `DATABASE_URL_TEST` at all — it spells the same URL `TEST_DATABASE_URL`.
Hence the alias tolerance, which makes both env-file spellings work. An explicit
target flag also removes all ambiguity about which database is about to be
dropped, which matters more than brevity for the only destructive script in the
repo. Plan §8 risk 11 requires the check to exist before the first reset script
ever runs; this is that script.

**Where does the guard get two URLs to compare, when neither env file contains
both?** From `db:reset:test`, which stacks
`--env-file=.env.local --env-file-if-exists=.env.test` (later file wins,
verified). That puts dev `DATABASE_URL` and `DATABASE_URL_TEST` in one process,
which is what makes the equality check load-bearing today rather than
aspirational.

**Enumerated table list or schema-level drop?**
`drop schema public cascade; create schema public; drop schema if exists drizzle
cascade;`. A hand-maintained table list silently misses tables that Phase 1+ adds;
a schema drop cannot go stale. Verified safe here:
`drizzle/0000_spotty_ender_wiggin.sql` contains no `CREATE EXTENSION`, and the
only function it relies on, `gen_random_uuid()`, is built into `pg_catalog` from
PostgreSQL 13 onward.

**Should `scripts/reset.ts` actually be executed during this phase, and against
which database?** Yes — for real, against the **test** database only
(`pnpm db:reset:test`), never the dev database. The test Neon project is
disposable and being reset is literally its purpose, so this is a free, genuine
exercise of the destructive drop → migrate → seed path. It proves the
composition works now and pre-validates the exact path Phase 3's harness will
call, instead of shipping an entirely unexecuted destructive script. Resetting
the dev database would buy nothing the test run does not already prove and would
destroy the seeded state the `/api/health` and `db:seed` evidence depends on.

### A side-effect-free connection factory

**Where does an injectable connection factory live, given `lib/db/client.ts`
throws at import time when `DATABASE_URL` is unset?** In a new
`lib/db/connect.ts` exporting `createDatabase(connectionString, {max})` and
`type Database`, with no module-level singleton, no env reads and no throw.
`lib/db/client.ts` keeps its singleton, its hot-reload cache and its exported
surface (`db`, `closeDb`, `Database`) but builds the handle via `createDatabase`,
so no existing caller moves.

Scripts targeting the test database must be able to construct a connection
without tripping `client.ts`'s eager check. Splitting the pure factory out
removes that hazard structurally, rather than relying on the caller having always
stacked the right env files.

### Replacing `drizzle-kit migrate`

**What runs migrations now that §4.7 mandates `node ... scripts/migrate.ts`?**
`migrate()` from `drizzle-orm/postgres-js/migrator`, called programmatically over
a dedicated `max: 1` connection on the direct/unpooled URL. Not a new
dependency — a different entry point into `drizzle-orm`, already in the §1.1
table. Using the unpooled endpoint preserves the decision already encoded in
`drizzle.config.ts` that DDL runs over a plain session rather than PgBouncer. The
hash-compatibility probe confirmed it treats Phase 0's drizzle-kit-applied
migration as already applied, so `pnpm db:migrate` is a safe no-op on the current
dev database — as the evidence transcript shows.

### `agent-browser`

**What version gets pinned, and how is it invoked?** `agent-browser@0.33.1`,
installed exact (`pnpm add -D -E`) and always invoked as
`pnpm exec agent-browser`. The PATH binary on this machine is 0.32.3 while the
registry latest is 0.33.1, so `pnpm exec` is what guarantees the *pinned* copy
runs rather than whatever happens to be on PATH — which is the entire point of
pinning for reproducible local and CI runs (§1.1, §4.1). 0.33.1 was verified
directly rather than assumed: `doctor` reports 8 pass / 0 fail including a real
headless Chrome launch, and `open`, `snapshot -i` and `screenshot` all worked
against the running app, so the 0.32.3 fallback was never needed.

### `eve dev` was writing dependencies into `package.json` — build-time decision

**Booting `pnpm dev` during this phase caused eve's default sandbox backend to
auto-install `microsandbox` as a devDependency, mutating `package.json` and
`pnpm-lock.yaml` unbidden. How is that remediated?** By adding `agent/sandbox.ts`
that pins the same `defaultBackend()` selection chain with `autoInstall`
disabled for both `microsandbox` and `just-bash`, and removing the package.

This is not a discretionary tidy-up: this phase's exit criterion is "package.json
contains NO dependency outside the §1.1 allowed table," and without the fix the
violation reappears on every single `pnpm dev`. The agent never runs sandboxed
code — it edits tasks through server actions — so nothing is lost; if a sandbox
is ever genuinely needed, eve now fails with an actionable install error and the
dependency gets added deliberately.

Worth recording for later phases: the eve docs describe this option as
`setup: { autoInstall: false }` on `defineSandbox`, but in the installed 0.27.8
typings it is an option on the `microsandbox()` / `justbash()` **backend
factories**, reached through `defaultBackend()`'s keyed bag. The docs are ahead
of, or behind, the shipped types — another instance of the "EVE is young; read
`node_modules/eve/docs/` and the typings, not your memory" rule.

*Rejected: pinning `justbash()` or `docker()` directly* — `justbash()`
auto-installs `just-bash` for the same reason, and `docker()` would make a
Docker daemon a hard requirement for a project that never sandboxes anything.

### Test directory placeholders

**Should `tests/api/` and `tests/e2e/` be created now so the mandated scripts
don't fail?** Only `tests/e2e/README.md`. Measured:
`node --test "tests/api/**/*.test.ts"` against a missing directory exits 0 with
"tests 0", so the ENOENT concern that would justify placeholders does not exist
with the glob form. `tests/e2e/README.md` is created for a different and real
reason: §4.6 requires the user-story → test coverage table to live at exactly
that path, and §6 Phase 7 references it again for declared gaps.

The unit test's path mirrors its source path — `tests/unit/domain/defaults.test.ts`
for `lib/domain/defaults.ts` — so Phase 1's much larger `lib/actions/*` suite has
a convention that scales.

### Where this record lives

**An addendum to `phase-0-decisions.md`, or its own file?** Both. A full
`docs/decisions/phase-0r-decisions.md` (this file), plus a short
`## Addendum — Phase 0r remediation` appended to `phase-0-decisions.md`
explaining the mid-phase plan change and pointing here. The phase brief asks for
the addendum; the operating instructions say choices must land in
`phase-0r-decisions.md`. Both are satisfied without duplicating content, the
Phase 0 narrative stays intact because the history matters, and every other phase
can look for its own decisions file by name.

---

## Assumptions

**Next.js/Turbopack resolves relative imports carrying explicit `.ts`
extensions.** *Confirmed during the build*, not merely assumed: `pnpm dev` boots,
`/eve/v1/health` and `/api/health` both return 200, and `instrumentation.ts`'s
`@/lib/db/seed` import — which transitively reaches `./client.ts`, `./connect.ts`
and `./schema.ts` — runs at boot with no resolution error. *If it had been
wrong:* the package.json `imports`-map fallback described above.

**`readMigrationFiles()` works from inside a bundled Next route handler** — its
`node:fs`/`node:path`/`node:crypto` usage bundles cleanly and `process.cwd()` is
the project root. *Confirmed:* `/api/health` returns `migrations:"current"` under
`next dev`. Not yet exercised under `next start` from a `next build` output; if
`process.cwd()` ever differs there, the fallback is to read
`drizzle/meta/_journal.json` directly or to precompute the expected hash at build
time.

**The Neon role owns the `public` schema and may drop and recreate it.**
*Confirmed* by running `pnpm db:reset:test` successfully against the test
project. Never exercised against dev, deliberately.

**`.env.test`'s `DATABASE_URL_TEST` points at a genuinely separate, disposable
Neon project.** Confirmed by host: the reset ran against
`ep-odd-dust-…/neondb` while the dev database is `ep-morning-fog-…/neondb`, and
`pnpm db:seed` against dev still reported *Skipped* afterwards — the reset could
not have touched it. *If this were ever wrong:* the refuse-if-equal guard and the
redacted `Resetting <host>/<db>` line printed before any destructive statement.

**Removing `vitest` breaks nothing beyond `lib/domain/defaults.test.ts` and
`vitest.config.ts`.** That test was the only file in the repo importing from
`"vitest"`, and the only test that existed. Sequencing mitigated the risk
anyway: the test was migrated *before* the dependency was removed, so the tree
was green at every commit boundary.

**`pnpm db:seed --target=test` would still require `DATABASE_URL` to be set**,
because `lib/db/seed.ts`'s DI default parameter (`database: Database = db`) pulls
in `lib/db/client.ts`, which throws at import when `DATABASE_URL` is absent. This
never bites in practice — `db:reset:test` stacks both env files — and keeping the
default parameter preserves the repo's established injectable-handle convention
that `instrumentation.ts` relies on. If Phase 3 ever needs a seed run with only
`.env.test` loaded, make `ensureSeeded`'s parameter required at that call site
rather than removing the default.

---

## Deviations from the implementation plan

| Deviation | Why |
| --- | --- |
| `test`/`test:unit`/`test:api`/`test:e2e` use quoted globs, not the bare directory paths in §4.7 | `node --test <dir>` fails with `MODULE_NOT_FOUND` on the installed Node 24.10, for `.js` as well as `.ts`. The literal strings would not run. |
| `engines.node` is `">=24.10.0"`, not the Node 26 §1 claims as verified | The installed runtime is v24.10.0; the plan's "verified" prerequisite is false on this machine. |
| One script beyond §4.7: `db:reset:test` | Stacking `.env.local` and `.env.test` in one process is the only way the refuse-if-equal guard can compare two real URLs. Also the exact entry point Phase 3's harness needs. |
| `agent/sandbox.ts` added, `microsandbox` removed | Not in the phase scope, but `eve dev` added a dependency outside the §1.1 table on its own, which directly breaks this phase's exit criterion and would recur on every dev boot. |
| `agent/skills/` committed | Materialised by the eve dev runtime from the already-committed `skills-lock.json`. Committing keeps the tree clean for later phases and makes the agent's skills reproducible without a GitHub fetch at build time. |

No deviation from §1.1 itself: nothing was added to `package.json` outside its
allowed table, so its "record any deviation here with justification" table needs
no new row.

---

## Known gaps

**Not in this phase's scope, and deliberately untouched:**

- `app/page.tsx` is still Phase 0's scripted, fake-transport chat demo. The
  agent-browser screenshot in `docs/verification/phase-0r/` is a screenshot of
  *that*, which is correct at this phase; Phase 5 replaces it.
- `docs/verification/phase-0/harness/seed-idempotency.ts` still references
  `pnpm exec tsx` and `@/` imports, and will no longer run now that `tsx` is
  removed. It is frozen historical evidence of what was actually executed during
  Phase 0; editing it would misrepresent that. Do not resurrect it — write a new
  harness under `tests/` if the check is wanted again.
- The pre-existing Prettier debt in 7 files (`app/`, `components/`, `lib/ai.ts`,
  `lib/message-animations.ts`) is untouched. Only new and modified files were
  formatted, to avoid burying this phase's diff under an unrelated reformat.
- `pnpm lint` reports 2 pre-existing warnings (an unused `Geist` import in
  `app/layout.tsx`, and one in `.remember/tmp/`, a local tool artifact). Zero
  errors. Neither is Phase 0r's to fix.

**Deferred by design, for later phases to pick up:**

- `tests/api/` does not exist yet; the script that would run it already passes.
  Phase 1 or 2 creates it alongside the first API route worth testing.
- `tests/e2e/README.md`'s coverage table is an empty placeholder. Phases 3–7
  populate it, and Phase 7 records any declared gaps there (§4.6).
- `/api/health`'s `migrations` field has no unit or API test yet; the first
  `tests/api/` test should cover the `"pending"` and `"unknown"` branches, which
  this phase only verified by reasoning and by the `"current"` path.

**Not carried forward:** every item in Phase 0r's scope was completed.

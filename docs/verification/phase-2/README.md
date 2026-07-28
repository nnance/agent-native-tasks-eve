# Phase 2 — Verification packet

**Phase under test:** API routes (`app/api/**`, `lib/api/`, `tests/api/`)
**User stories under test:** none directly — Phase 2 is infrastructure, so its **exit criteria and scope statements are the checklist** (see [Why there is no story table](#why-there-is-no-story-table))
**Verified:** 2026-07-28 · branch `phase-2-api-routes` @ `fd46657` · Node v24.10.0 · pnpm 10.18.3 · Next 16.2.6 · zod 4.4.3 · drizzle-orm 0.45.2 · two separate Neon Postgres projects
**Overall verdict: PASS — all 10 criteria pass.**

`pnpm test:api` runs **77 tests, 77 pass, 0 fail, 0 skipped, 0 todo** against a real `next dev`
server talking to a genuinely separate Neon project; `pnpm test:unit` is still **130/130** (up
from Phase 1's 105 — the new transport helpers and chat-state action are unit-tested too), and
`pnpm typecheck` and `pnpm lint` are clean (0 errors; the same 2 pre-existing warnings Phase 0r
and Phase 1 recorded, in `app/layout.tsx` and a stray `.remember/` scratch file).

Because "green tests" is exactly the kind of claim a packet exists to distrust, this run does not
stop at the transcript.

It proves the tests never touched the dev database by **observing** it rather than trusting
configuration: a project written through the spawned server's own API is read back from two
independent connections and is present in the test database and absent from the dev one
([`09`](#09)). The same file shows the guard refusing outright when the two URLs are made
identical. This matters because a mistake here writes to the user's working database, and the
mechanism it rests on — `@next/env` declining to overwrite a variable already in `process.env` —
is a library internal, so it is backed by a runtime sentinel that runs in the root `before` hook
**before a single fixture row is written**.

Rather than quoting source for the "human-readable, verbatim error" requirement (product-spec §9,
US-F3.4), it triggers every error branch live against a running server and prints what the wire
actually said ([`05`](#05)) — for example
*"'To Do' is the only status in 'Solo 62ca8688'. Every project must keep at least one status, so
it cannot be deleted. Create another status first."* — including the 400 bodies, whose `issues`
array is what a future form UI will map onto fields.

The structural claims are mechanically counted rather than asserted: the route surface is
**exactly the nine paths of plan §2.3** plus the pre-existing `/api/health`, with matching verb
sets and no route-segment config anywhere ([`06`](#06)); **no handler under `app/api/` imports a
database** or constructs a `RuleViolation`/`NotFoundError` ([`07`](#07)); Phase 1's published
**19-actions ↔ 19-schemas** parity count is unchanged, because chat-state was deliberately kept
out of both barrels ([`06`](#06)); and there is **zero dependency change** — a 0-line diff across
`package.json` and `pnpm-lock.yaml` for the whole phase, with no rejected library imported
anywhere ([`08`](#08)).

Read [Method and caveats](#method-and-caveats) before treating any pass mark as unqualified.

---

## Results

| # | Source | Criterion (verbatim) | Result | Evidence |
|---|---|---|---|---|
| E1 | Phase exit | `pnpm test:api` green | **pass** — 77 tests, 77 pass, 0 fail, 0 skipped, 0 todo | [`01-test-api.txt`](./01-test-api.txt) |
| E2 | Phase exit | the capability set is exercisable end-to-end against a seeded DB | **pass** — every §2.3 route+verb has at least one test driving it over real HTTP against a migrated Neon database | [`06-route-capability-map.txt`](./06-route-capability-map.txt), [`01`](./01-test-api.txt) |
| E3 | Evidence req. | full `pnpm test:api` run output, **including the tests that assert rule-violation error bodies and status codes** | **pass** — full transcript; five distinct `RuleViolation` messages asserted by full-string equality, not fragment | [`01`](./01-test-api.txt), [`05-rule-violation-bodies.txt`](./05-rule-violation-bodies.txt) |
| S1 | Phase scope | Routes exactly per plan §2.3, including `/api/chat-state` (GET/PUT). `/api/health` already exists — do not duplicate it. | **pass** — 10 `route.ts` files: the 9 §2.3 paths plus health, untouched; verb sets match path for path | [`06`](./06-route-capability-map.txt) |
| S2 | Phase scope | Each handler: parse → validate with the SHARED zod schema from `lib/schemas` → call the action → map result or RuleViolation to JSON with the right status code. **No business logic in routes.** | **pass** — no schema declared under `app/api/`; no DB import outside health; no error constructed in a handler | [`07-layer-boundaries.txt`](./07-layer-boundaries.txt), [`05`](./05-rule-violation-bodies.txt) |
| S3 | Phase scope | `PATCH /statuses/[id]` covers rename/reorder/toggle-completed; `PATCH /priorities/[id]` covers rename/reorder/set-default | **pass** — one consolidated handler each; all three modes tested per entity | [`06`](./06-route-capability-map.txt), [`01`](./01-test-api.txt) |
| S4 | Phase scope | `GET /api/tasks` supports `?project=&status=&priority=&q=&includeCompleted=` | **pass** — all five, combinable; `q` matches descriptions; `includeCompleted` coerced from `true`/`1`/`false`; garbage → 400; all-empty → unfiltered | [`01`](./01-test-api.txt), [`05`](./05-rule-violation-bodies.txt) |
| S5 | Phase scope | `tests/api/` using `node:test` + the built-in `fetch` against a started server: transport mapping, status codes, blocked-delete error bodies. **No HTTP client library (§1.1).** | **pass** — only `node:*` built-ins, global `fetch`, and drizzle-orm for teardown | [`08-dependency-policy.txt`](./08-dependency-policy.txt), [`01`](./01-test-api.txt) |
| G1 | Ground rules | Dependency policy §1.1 is binding — no new runtime or dev dependency | **pass** — 0-line diff in `package.json` + `pnpm-lock.yaml`; no rejected library imported anywhere | [`08`](./08-dependency-policy.txt) |
| G2 | Ground rules | Tests must never run against the dev database; the harness must refuse to start if they match | **pass** — proven by observation from both databases, plus the guard refusing when sabotaged | [`09-test-db-isolation.txt`](./09-test-db-isolation.txt) |
| G3 | Ground rules | `pnpm typecheck` and `pnpm lint` clean | **pass** — typecheck exit 0; lint 0 errors, 2 pre-existing warnings | [`03-typecheck.txt`](./03-typecheck.txt), [`04-lint.txt`](./04-lint.txt) |
| R? | product-spec §7 | rules are enforced in `lib/actions/` and **never re-checked** downstream | **pass** — the only error construction outside `lib/actions/` is `lib/api/scope.ts`'s address check, which resolves through existing read actions and touches no database | [`07`](./07-layer-boundaries.txt) |

### Why there is no story table

The phase brief states it outright: *"User stories that must demonstrably pass: none directly —
this phase is infrastructure; its exit criteria are the acceptance test."* Epics B–E describe UI
behaviour, and after Phase 2 `app/page.tsx` is still the shadcn chat demo. What Phase 2 owes those
epics is a *substrate* they can be built on, which is what E2 and S4 check: every filter US-B3
needs is combinable, every blocked-delete message US-C3/D2/E2 must show is reachable verbatim
over HTTP.

---

## Evidence index

<a id="01"></a>
### `01-test-api.txt` — the phase's named evidence requirement
Full `pnpm test:api` output. One `next dev` server for the run; 19 suites, 77 tests. Includes
every rule-violation assertion: the project blocked-delete, both status delete blocks, both
priority delete blocks, and both cross-project scoping violations — each compared as a **full
string**, never a fragment, because these messages are a product deliverable under §9.

<a id="02"></a>
### `02-test-unit.txt` — Phase 1's suite still green
130 tests (Phase 1 published 105; Phase 2 adds 15 for `lib/api/` and 10 for the chat-state
action). Proves the `lib/db/urls.ts` guard refactor and the new action broke nothing.

<a id="03"></a>
### `03-typecheck.txt` · <a id="04"></a>`04-lint.txt`
`tsc --noEmit` exit 0. ESLint 0 errors and the same 2 warnings recorded since Phase 0r, both in
files this phase did not touch.

<a id="05"></a>
### `05-rule-violation-bodies.txt` — what the system actually says
A live transcript, not a quotation. Boots a server and prints the status code and raw body for
16 cases: five 409s (§7.3 project, §7.3 status-in-use, §7.5 last status, §7.5 last priority, §7
rule 2 cross-project), three 404s (unknown project, unknown task, and a *real* status addressed
under the wrong project — the scope guard), seven 400s (missing field, unknown key, `projectId`
on a task update, malformed URL id, uncoercible `includeCompleted`, malformed JSON, array body),
and the 200 proving an all-empty query string is a no-op.

Harness: [`harness/rule-bodies.ts`](./harness/rule-bodies.ts).

<a id="06"></a>
### `06-route-capability-map.txt` — the surface is exactly §2.3
Every `route.ts` with its exported verbs, a count check against §2.3's nine paths, proof that no
route-segment config or bulk route exists, a full route → handler → action → schema → test table,
and a re-run of Phase 1's capability parity count showing **19 ↔ 19 unchanged** with chat-state
absent from both barrels.

<a id="07"></a>
### `07-layer-boundaries.txt` — routes decide nothing
Greps showing: the only database import under `app/api/` is `health/route.ts` (pre-existing,
whose whole job is `select 1`); no `new RuleViolation` / `new NotFoundError` anywhere under
`app/api/`; no schema declared under `app/api/`; and the complete list of `lib/api/` importers.

<a id="08"></a>
### `08-dependency-policy.txt` — zero dependency change
0-line diff in `package.json` and `pnpm-lock.yaml` across the whole phase. Sixteen rejected
libraries checked by name, none imported. The complete import list of `tests/api/`: `node:test`,
`node:assert/strict`, `node:child_process`, `node:net`, `node:url`, and drizzle-orm. HTTP is the
global `fetch`.

<a id="09"></a>
### `09-test-db-isolation.txt` — the tests never touched the dev database
Three layers, printed. The sentinel interlock passing; then the same claim made visible from both
sides — a row written through the API is found once in the test database and zero times in the
dev database, from independent connections; then the guard refusing when `DATABASE_URL_TEST` is
pointed at `DATABASE_URL`.

Harness: [`harness/db-isolation.ts`](./harness/db-isolation.ts).

---

## Method and caveats

**Read these before treating any pass mark as unqualified.**

1. **`next dev`, not a production build.** Route handlers carry no route-segment config and Next 16
   makes them dynamic by default, so dev and production behaviour should be identical here — but
   "should be" is doing work in that sentence. Production-build fidelity is the E2E suite's job
   (plan §4.3) and is not evidenced in this packet.

2. **Isolation is by ownership, not rollback.** The server is a separate process, so
   `tests/support/db.ts`'s rolled-back transactions cannot reach it. Fixtures are **really
   committed** and hard-deleted in teardown. A run killed with SIGINT mid-suite leaves
   uniquely-named fixture projects behind; `pnpm db:reset:test` clears them. This also means the
   filter tests scope themselves to their own project or search a run-unique token — an unscoped
   "the list contains exactly N" assertion would be a flake waiting to happen.

3. **Endpoint hostnames are redacted.** `09` prints `ep-DEV-ENDPOINT-REDACTED` and
   `ep-TEST-ENDPOINT-REDACTED` in place of the real Neon endpoint IDs, following the convention
   established in commit `174bc1e`. What the evidence depends on — that the two are demonstrably
   different, and that the guard fires when they are not — is preserved. No connection string is
   printed anywhere; every DB-identifying line goes through `describeDbUrl()`.

4. **The sentinel is a check, not a proof of the mechanism.** It observes that a row written
   through the API landed in the test database. It does not independently verify *why*
   `@next/env` leaves an inherited `DATABASE_URL` alone; that was read out of the installed
   compiled source and is recorded as an assumption in
   [`../../decisions/phase-2-decisions.md`](../../decisions/phase-2-decisions.md).

5. **`05`'s transcript is one run's ids.** The UUIDs and the random name suffixes differ per run;
   the message *text* is what the assertions in `01` pin, by full-string equality.

6. **Two lint warnings are pre-existing and out of scope.** `app/layout.tsx`'s unused `Geist`
   import and a stray `.remember/tmp/last-ndc.ts` scratch file. Both predate Phase 2 and were
   recorded in Phase 0r and Phase 1.

7. **`pnpm format` was deliberately not run repo-wide.** It rewrites a dozen pre-existing files
   this phase did not touch, including published Phase 1 evidence harnesses. Only Phase 2's own
   files are Prettier-formatted; `prettier --check` on them is clean.

8. **§7.6 (last write wins) is only partly exercised.** `PUT /api/chat-state` demonstrates it
   over a shared row, but the rule is really about the UI and the agent racing, and neither
   interface exists yet. Recorded, not claimed.

---

## Reproducing

```
pnpm db:migrate --target=test    # or pnpm db:reset:test
pnpm test:api                    # 01
pnpm test:unit                   # 02
pnpm typecheck                   # 03
pnpm lint                        # 04

node --env-file=.env.local --env-file-if-exists=.env.test \
  docs/verification/phase-2/harness/rule-bodies.ts        # 05
node --env-file=.env.local --env-file-if-exists=.env.test \
  docs/verification/phase-2/harness/db-isolation.ts       # 09
```

`06`, `07` and `08` are greps and counts; the commands are printed inline in each file.

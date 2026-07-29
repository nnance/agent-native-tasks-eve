# Resume here

**State as of 2026-07-29.** Phases 0–6 of [implementation-plan.md](./implementation-plan.md) §6 are built and merged to `main`. Phases 7 and 8 remain.

The app works end to end: task UI, list management, the EVE agent with framework-enforced approval gates, the chat pane, and live sync. What is *not* yet done is proving it exhaustively — that is Phase 7's job.

---

## 1. How to resume

The build is driven by a committed workflow, `.claude/workflows/phase-build.mjs`, which still has phases `7` and `8` fully defined in its phase table. Nothing needs reconstructing.

```bash
git checkout main && git pull
git checkout -b phase-7-complete-e2e-suite-the-completion-gate
```

Then, from Claude Code:

```
Workflow({ scriptPath: ".claude/workflows/phase-build.mjs", args: { phase: "7" } })
```

**The branch name must match exactly.** The workflow derives it from the phase title and the ship stage looks for it by name; a mismatch cost a stumble in Phase 0r. The remaining two are:

| Phase | Branch name |
|---|---|
| 7 | `phase-7-complete-e2e-suite-the-completion-gate` |
| 8 | `phase-8-hardening-handoff` |

Each phase runs seven stages — explore, design, implement, review, fix, verify, ship — and ends by opening a PR and squash-merging it. Historical duration: 67–310 minutes per phase.

### Prerequisites

- **Node** ≥ 24.10.0, **pnpm**. `pnpm install` first.
- **`gh pr merge` permission.** The auto-merge step needs `Bash(gh pr merge:*)` allowed in `.claude/settings.json`, or the ship stage stops with the PR open. (`.claude/settings.json` is currently **untracked** — decide whether to commit it.)
- **Credentials** — see below. Seamless on the original machine, needs re-provisioning elsewhere.

### Credentials

`.env.local` and `.env.test` are gitignored and live only on the machine that ran the build. `.env.example` names the keys.

| Variable | Where it lives | What it is |
|---|---|---|
| `DATABASE_URL` | `.env.local` | Neon Postgres, dev — `agent-native-tasks-db` |
| `AI_GATEWAY_API_KEY` | `.env.local`, `.env.test` | Vercel AI Gateway, **$25/month budget cap** |
| `DATABASE_URL_TEST` | `.env.test` | Neon Postgres, test — `agent-native-tasks-testdb`, a **separate project** |

To re-provision on a new machine:

```bash
vercel link
vercel integration add neon --plan free_v3 -m region=iad1 -m auth=false -n agent-native-tasks-db --no-claim
vercel integration add neon --plan free_v3 -m region=iad1 -m auth=false -n agent-native-tasks-testdb --prefix TEST_ --no-claim
vercel ai-gateway api-keys create --name agent-native-tasks-dev --budget 25 --refresh-period monthly
```

Then write `.env.test` with `DATABASE_URL_TEST` = the pulled `TEST_DATABASE_URL`, plus `AI_GATEWAY_API_KEY`.

The test database **must not** be the dev database — the harness refuses to run if they match, and the E2E suite drops and reseeds on every test.

---

## 2. What is proven, and what is not

| Phase | PR | Verdict | Notes |
|---|---|---|---|
| 0 — Foundations | [#2](https://github.com/nnance/agent-native-tasks-eve/pull/2) | partial | US-A1.4 blocked — no task surface existed yet |
| 0r — Remediation | [#3](https://github.com/nnance/agent-native-tasks-eve/pull/3) | partial | Same blocked criterion |
| 1 — Action layer | [#4](https://github.com/nnance/agent-native-tasks-eve/pull/4) | **pass** | 12/13; §7.6 concurrency n/a with one interface |
| 2 — API routes | [#5](https://github.com/nnance/agent-native-tasks-eve/pull/5) | partial | Flagged a unit-suite flake, since root-caused and fixed by #6 |
| 3 — Task UI | [#7](https://github.com/nnance/agent-native-tasks-eve/pull/7) | **pass** | All Epic B–E criteria, 51 screenshots |
| 4 — EVE agent | [#9](https://github.com/nnance/agent-native-tasks-eve/pull/9) | **pass** | Approval gates proven against real model calls |
| 5 — Chat UI | [#11](https://github.com/nnance/agent-native-tasks-eve/pull/11) | **pass** | 26/26 Epic F criteria |
| 6 — Live sync | [#12](https://github.com/nnance/agent-native-tasks-eve/pull/12) | **pass** | Epic G; US-G4 deferred to Phase 7 |

Four out-of-band fixes also landed: [#6](https://github.com/nnance/agent-native-tasks-eve/pull/6) ordering determinism, [#8](https://github.com/nnance/agent-native-tasks-eve/pull/8) duplicate-create, [#10](https://github.com/nnance/agent-native-tasks-eve/pull/10) agent-reply assertions and `load_skill`, plus the cold-start fix described below.

Every phase's reasoning is in `docs/decisions/phase-N-decisions.md`; every phase's evidence is in `docs/verification/phase-N/`. Each decisions doc ends with a "known gaps / what the next phase inherits" section — those are authoritative, this file summarises.

**Current test state:** `pnpm test` (unit + API) **368/368**. E2E is 7 files, 62 tests. Evals 4/4.

---

## 3. Do this first, before anything else

### 3.1 Verify the Neon cold-start fix holds

Phase 6 could not land a clean 62/62 `pnpm test:e2e` — best was 60/62, with runs wrecked by 35–40 `connect ETIMEDOUT` each. Phase 6 recorded this as a *suspected* database problem and correctly declined to claim it as proven.

**It has since been reproduced and fixed.** A direct probe of the test database:

```
cold+warm connect latencies (ms): ERR:ETIMEDOUT, 2630, 780, 1345, 839, 979
15 concurrent queries across 3 pools: 1196 ms
```

The cause is **Neon free-tier scale-to-zero**: after a few minutes idle the compute suspends, and the first connection attempt fails with `ETIMEDOUT` instead of waiting for the resume. Concurrency is fine, so it was never pool exhaustion. This explains the exact reported signature — intermittent, a different test each run, always passing in isolation, because by then something else had woken the database.

The fix adds an explicit `connect_timeout` and a `waitForDatabase()` helper in `lib/db/connect.ts`, called once from `migrateTestDatabase()` and from `runMigrations()`. **It retries establishing a connection, before any test logic runs, and only for connection-level error codes** — it is not a retry around assertions, which plan §4.5 forbids.

Re-run `pnpm test:e2e` from a genuinely idle database and confirm 62/62 before trusting anything else.

### 3.2 The other flake may be the same bug

`06-agent-chat` was independently flaky in Phase 5 — 8/8, 7/8, 5/8, 6/8, 7/8 across five runs, always the 120s first-token budget expiring on a different test. Phase 6 hypothesised the mechanism: an agent tool call stalls *inside* the Postgres driver's connect timeout rather than erroring, so the turn never settles and nothing surfaces in the browser.

That mechanism is consistent with the cold start now fixed. **Re-measure before treating it as a separate problem.** If it persists, the honest fixes are suite-level retry or a faster model on the E2E path — not a looser assertion, and not a fourth raise of `TURN_MS` (three raises in one phase is where synchronisation stops being synchronisation).

This matters because **Phase 7's exit gate is `pnpm test:all` green three consecutive times.** At ~7/8 per run that gate is unreachable.

---

## 4. Open items

### Defects
1. **Silent unresumable conversation.** If the app process dies *while a turn is in flight*, the transcript restores but the next message is accepted and never answered, the composer stays disabled, and no error is shown. Clean restarts between turns are fine. Phase 5 packet, Defect 1.
2. **`agent/lib/bulk-edit-gate.ts` state is process-scoped and in-memory.** Two documented fail-open limits: parallel tool calls are judged one at a time, so the first write lands before the prompt; and the counter does not survive a restart. Phase 6's `settledAction()` is the first test helper that had to work around it. Deserves an eval.

### Decisions someone should actually make
3. **Filter/search/show-completed state resets on tab switch.** A preference, not a defect — deliberately left out of a bug fix rather than bundled in.
4. **No Stop button in the chat pane.** Needs `session.cancel({ turnId })`; the pane already owns its `ClientSession`.
5. **Chat persistence is whole-snapshot last-write-wins.** Fine at single-user scale; revisit if the event log grows.
6. **Neon endpoint IDs remain in git history.** Redacted from the working tree, but present in `d5033d1` and earlier. Not credentials — Neon still requires user and password — so history was left intact. Rotating the endpoints is the cheap fix if you want them gone.

### Verification debt
7. **US-G4 is untouched** — the parity capstone, `08-parity.test.ts`, is the one remaining Epic G gap in `tests/e2e/README.md`'s coverage table. It is Phase 7's headline deliverable.
8. **US-F6.2 was verified by inspection only.**
9. **`readMigrationFiles()` in `/api/health`** is verified under `next dev` but never under `next start` from a `next build`, where `process.cwd()` could differ.

---

## 5. Harness gotchas that will waste your time

- **`pnpm test:e2e` builds once per invocation** (`eve build` + `next build`, then the suite). Reverting a source file and re-running `node --test` directly tests the **stale bundle** and proves nothing. This produced a false "the bug isn't real" result during the Phase 3 follow-up; only a real rebuild showed the failure.
- **The agent suite binds a fixed port 4274.** A running `pnpm dev` will break it. Check `lsof -nP -iTCP -sTCP:LISTEN | grep 4274` first.
- **`resetTestDatabase` uses `DELETE`, not `TRUNCATE`** — the eve server's second connection pool makes an `AccessExclusiveLock` deadlock reachable. Do not "optimise" it back.
- **The agent server is opt-in per suite** via `setupSuite(name, { eve: true })`.
- **`node --test` needs quoted globs** (`"tests/unit/**/*.test.ts"`), not §4.7's literal bare directory paths, which fail with `MODULE_NOT_FOUND` on Node 24.10. Do not "correct" them toward the plan text.
- **Import rule:** `@/*` aliases only in framework-mediated files (`app/**`, `agent/**`, `components/**`, `hooks/**`, `instrumentation.ts`, `next.config.ts`). Anything bare-node-reachable — `lib/**`, `scripts/**`, `tests/**` — uses relative imports with explicit `.ts` extensions.
- **`agent/tools/` and `agent/lib/` must never contain a `.gitkeep`.** EVE's module discovery rejects unsupported files in authored slots and exits the dev server with code 1.
- **`pnpm format` targets only `**/*.{ts,tsx}`** and will try to rewrite ~12 unrelated files including published verification evidence. Revert the out-of-scope ones.

---

## 6. One thing to know about the plan

`docs/implementation-plan.md` is no longer purely a human-authored document. Phase 4's reviewer found that §2.4's tabled `never()` approval for `update_task` left a bypass — a multi-task edit could be driven as a loop of single-task calls, never hitting a gate. It shipped an input-dependent policy instead (`agent/lib/bulk-edit-gate.ts`) and **edited §2.4 to match**.

The change tightens safety and the verification run proves it works, so it stands. But if you are reading the plan as your specification, that one cell is now a policy rather than a helper, and it was not your edit.

Separately, PR [#1](https://github.com/nnance/agent-native-tasks-eve/pull/1) landed a substantial plan rewrite *while Phase 0 was executing* — which is why Phase `0r` exists. If more plan edits are coming, landing them between phases rather than during one saves a remediation cycle each time.

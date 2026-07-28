# Phase 4 verification packet — EVE agent (Epic F backend half)

**Scope:** the plan §2.4 tool inventory, its approval policies, `toModelOutput`
trimming, and `agent/instructions.md`. User stories in scope: **US-F2, US-F3,
US-F4, US-F5**.

**Verdict: PASS.** All 19 tools are discovered, all six unconditionally gated
tools pause for approval, `update_task` pauses on the second task it edits in a
turn, and every scenario in this packet was driven against a **real** EVE
agent (`anthropic/claude-sonnet-5` through the AI Gateway) talking to a **real**
Postgres. No model call is mocked, no tool is stubbed, and every post-condition
below is an independent HTTP read of committed state rather than a restatement
of what the agent claimed. The whole packet was produced twice, back to back,
with identical results (`09-verify-agent-second-run.txt`).

---

## How this was produced

`pnpm verify:agent` runs `scripts/verify-agent-tools.ts`, which:

1. spawns one `next dev` on a free loopback port with `DATABASE_URL` overridden
   in the child environment to the **test** database — never on the command
   line, so no credential can reach a process listing or one of these files;
2. waits for `/api/health` and then `/eve/v1/health`, so both the app and the
   EVE runtime mounted by `withEve` are up;
3. drives the agent with `eve/client`'s `Client` / `ClientSession`, one session
   per scenario, iterating the NDJSON event stream rather than aggregating it —
   because the approval scenarios must observe `input.requested` and read the
   database **while the run is still parked**;
4. builds fixtures and checks post-conditions over the HTTP API;
5. writes one transcript per scenario, containing every stream event verbatim.

It is a `scripts/` file, not a test: each run makes real, paid,
non-deterministic model calls, and a flaky third-party model inside `pnpm test`
would poison the regression signal the unit suite exists to give.

**Run it with no other `pnpm dev` or `eve dev` process active** — they share
the `.eve/` runtime state and the `.next/` build directory.

---

## Artifacts

| File | What it shows |
| --- | --- |
| `00-eve-info.txt` | `eve info`: compile ready, **0 diagnostics**, **19 authored tools**, and the 9 disabled framework tools. Also records that the inherited `neon` / `neon-postgres` skills are still discovered, which is why `load_skill` remains advertised. |
| `01-grounded-read.json` | **US-F2.1/2.2/2.4.** A `list_*` call precedes the answer; the reply's count and titles match a direct `GET /api/tasks`; a question about a project that does not exist is answered honestly, and no write tool runs in either turn. |
| `02-project-move-refused.json` | **US-F3.4.** "Move this task into that project" is refused with the immutability rule explained and a concrete alternative offered. No `update_task` call carries a `projectId` — the schema makes it inexpressible — and the task is still in its original project afterwards. |
| `03-blocked-status-delete.json` | **US-F4.3 + US-F3.4, end to end through the `blocked` envelope.** The gate fires, the approval is *granted*, the action then throws `RuleViolation`, and the agent relays the blocking reason and offers a way forward. The status still exists afterwards. |
| `04-delete-approval-denied.json` | **US-F3.3.** `delete_task` pauses at `input.requested`; the prompt carries the exact task id; the row is read back **while parked** and still exists; the denial leaves it in place and the agent says nothing changed. This is what proves the pause is framework-enforced rather than prompt compliance. |
| `05-bulk-approval-approved.json` | **US-F5.1/5.2/5.3/5.4.** A three-task move produces exactly one `bulk_update_tasks` call and zero `update_task` calls; the message states the count and titles first; the approval prompt carries all three ids; approving it moves every row (verified by API read). |
| `06-looped-edit-gated.json` | **US-F5.1/5.2/5.3 — the structural half of the same rule.** A two-task *rename* is a §6 bulk change that `bulk_update_tasks` cannot express (it has no title field), so the model must loop `update_task` — and it does, twice. The second call pauses at `input.requested` carrying that task's id, an API read taken **while parked** shows exactly one rename committed, and denying it leaves the second task untouched. This is the case where preferring the bulk tool is not an option, so the gate is the only thing holding §6. |
| `07-typecheck.txt` | `pnpm typecheck` clean. |
| `08-lint.txt` | `pnpm lint` clean (one pre-existing warning in `.remember/`, outside this phase's tree). |
| `09-test-unit.txt` | `pnpm test:unit`: **230 tests, 0 failures**, including the 99 in `tests/unit/agent/`. |
| `10-verify-agent-second-run.txt` | The whole packet re-run back to back, all assertions passing again. |

## Reading a transcript

Each scenario file carries `scenario`, `model`, the fixtures it created, an
`assertions` array, and a `turns` array. Every turn holds:

- `events` — every stream event verbatim, so the file stays valid evidence even
  if the derived summaries below ever need re-deriving;
- `toolCalls` — `{ name, input }` for each tool call, derived from
  `actions.requested`;
- `approvalRequests` — the `input.requested` payloads, each carrying
  `action.toolName` and `action.input` (this is what a channel renders as the
  approval card, and what Phase 5 will style);
- `finalMessage` — the last completed assistant message of the turn.

No transcript contains any environment variable.

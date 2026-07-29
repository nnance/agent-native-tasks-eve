# Phase 5 verification packet — Chat UI rewire (Epic F frontend half)

**Scope:** Epic F's front half — US-F1 … US-F6.
**Verdict: PASS.**

Every acceptance criterion in scope was exercised against a running instance of
the app — a real browser, a real database, a real EVE agent, a real model — and
every one passes. Nothing was mocked and nothing is claimed on the strength of
reading source code. The three claims that matter most for this phase are each
backed by two independent kinds of evidence: a screenshot of the state *after*
the action, and either a direct Postgres read or a DOM read taken at the same
moment.

Three defects were found by driving the browser rather than by reasoning about
the code, and all three are fixed in this branch:

1. `/` was being **statically prerendered** once the page started reading the
   conversation snapshot, which would have frozen one build-time transcript
   into the HTML under `next start` while working perfectly under `next dev`.
2. Model markdown reached the transcript with its **asterisks intact**.
3. A restored conversation **opened on an old question**, with autoscroll
   disengaged for everything streaming in afterwards.

Three more were found by measuring the running app rather than looking at it:
a live approval card rendered **entirely below the fold** behind a
scroll-to-bottom button; a reload replayed **already-answered** requests as
live Approve buttons, because the event that resolved them is reducer-facing
and deliberately absent from the persisted stream; and the harness's
`TRUNCATE`-based per-test reset **deadlocked** (`40P01`) against the eve agent
server's connection pool, which no earlier suite could have hit because no
earlier suite ran a second process against the test database.

---

## How this was verified

Two environments, deliberately:

**The §3.1 inner loop**, against `pnpm dev` on port 3000 and the Neon **dev**
database, driven with `agent-browser` (isolated session, pointed only at
`localhost`). This is where the design was iterated and where the approval-card
screenshots come from.

**The production topology**, `pnpm exec eve build && next build`, then
`next start` on a free port plus `eve start --port 4274`, against the separate
Neon **test** database. This is what `tests/e2e/06-agent-chat.test.ts` runs
against, and it is the only environment in which the phase's exit criteria are
claimed.

Everything the agent wrote into the chat pane was treated as untrusted data
(§3.4): it was read to make assertions and never acted on. No credential
appeared on any command line.

---

## Evidence

| File | What it shows |
| --- | --- |
| [`03-approval-card-delete.png`](./03-approval-card-delete.png) | The single-task delete approval card, close up. `delete_task`, severity `destructive`, the task **named** — "Delete “Draft the launch plan”" — the real tool name on the machine-record line, the consequence sentence, and a confirm button that says the verb rather than "Approve". This is the plan §8 risk 6 evidence. |
| [`04-approval-card-bulk.png`](./04-approval-card-bulk.png) | The bulk card: "Update 3 tasks", all three tasks enumerated by name under `TASKS`, `CHANGE / Status → Done` with the status resolved to its name, `data-count="3"`. Severity `write`, so it is accented in the primary colour rather than in a delete's red. Captured **after a page reload**, which is also the proof that a turn parked at an approval survives persistence. |
| [`05-approved-and-landed.png`](./05-approved-and-landed.png) | The same conversation after Approve: a settled `action-entry` reading "✓ Updated 3 tasks / Status → Done", and the left pane already updated — the three tasks are completed and therefore hidden. |
| [`06-agent-chat-run.txt`](./06-agent-chat-run.txt) | The seven `06-agent-chat` tests, extracted from the final full run: 7/7 against the production topology, 10–24s per agent turn. |
| [`07-ask-question-card.png`](./07-ask-question-card.png) | `ask_question` through the same component: the model's real prompt rendered verbatim, neutral severity, and its own three options as buttons (`approval-option-<id>`). |
| [`08-a11y-chat-with-approval.json`](./08-a11y-chat-with-approval.json) | `agent-browser a11y --tags wcag2a,wcag2aa` with a live conversation and an approval card on screen — zero violations. |
| [`09-question-then-bulk-delete.png`](./09-question-then-bulk-delete.png) | The answered question as a structured entry (`Question → Which task should I delete?`), on the way to the `bulk_delete_tasks` card it produced. |
| [`10-typecheck.txt`](./10-typecheck.txt) | `pnpm typecheck` — clean. |
| [`11-lint.txt`](./11-lint.txt) | `pnpm lint` — 0 errors. (The one warning is in `.remember/tmp/`, a tool scratch file outside the project's source.) |
| [`12-test.txt`](./12-test.txt) | `pnpm test` — 349/349 unit + API tests, including the new `tests/unit/chat/describe-tool-call.test.ts`. |
| [`13-test-e2e-run-1.txt`](./13-test-e2e-run-1.txt), [`14`](./14-test-e2e-run-2.txt), [`15`](./15-test-e2e-run-3.txt) | Three consecutive full `pnpm test:e2e` runs on the final code, each from a clean `pnpm db:reset:test` — **55/55 every time**. |

---

## Acceptance criteria

### US-F1 — Converse with the agent

| # | Criterion | How it was verified |
| --- | --- | --- |
| 1.1 | Split screen, both halves always visible | `06 › "US-F1.1/1.2 + US-F2"` asserts `chat-conversation` and `chat-composer` are visible alongside the task pane; every screenshot in this packet shows both. `01-foundation` covers the narrow-viewport stacking. |
| 1.2 | A real EVE agent, not mocks or canned replies | Nothing is mocked anywhere in the suite. The turn reaches a real model through the eve server the harness starts; the `action-entry` rows carry the real tool names it called. |
| 1.3 | One conversation, surviving reload | `06 › "US-F1.3/1.4 + US-F6.3"` reloads the page and asserts the `create_task` action entry re-renders from the persisted snapshot and `chat-empty` is gone. Independently, `04-approval-card-bulk.png` is a card re-rendered after a reload. |
| 1.4 | Prior context carries across sessions | The same test then sends the literal **"move that one to Done"** *after* the reload and asserts the row's `statusId` in Postgres became Done. This is the criterion verbatim, and it is what the owned-`ClientSession` decision exists to guarantee. |

### US-F2 — Ask questions about my data

| # | Criterion | How it was verified |
| --- | --- | --- |
| 2.1 | Answered from current data | `06 › "US-F1.1/1.2 + US-F2"` seeds two tasks, asks what is in the project, and after the turn settles asserts (a) a settled read action entry rendered — the agent looked — and (b) both fixture titles are on the page. |
| 2.2 | No stale reads | The fixtures are written moments before the turn, in the same test. |
| 2.3 | Finds tasks by text rather than by guessing | The `list_tasks` action entry renders the search it actually ran — `Search → "Pin down the schedule"` in `tests/e2e/artifacts/06-agent-chat/final.png`, `Search → "launch"` in `07-ask-question-card.png`. |
| 2.4 | Says so when something does not exist | Covered by the Phase 4 story harness. Not re-asserted here: "says it does not exist" is prose, and plan §4.5 forbids asserting the assistant's wording. |

### US-F3 — Manage tasks via the agent

| # | Criterion | How it was verified |
| --- | --- | --- |
| 3.1 | Create with UI defaults | `06 › "US-F1.3/1.4 + US-F6.3"` asks for a task by title only and finds the row in Postgres. |
| 3.2 | Edit and move status | `06 › "US-F3.2/3.5 + US-F6.1"` asserts the row's `statusId` moved to Done. |
| 3.3 | Delete requires confirmation; declining changes nothing | `06 › "US-F3.3 + US-F5.1/5.2"` walks the full cycle: card up **and** row still in Postgres → Deny → still there → re-request → Approve → gone from the database and from the left pane. |
| 3.4 | Cross-project move refused, with an alternative | `06 › "US-F3.4"` asserts the row's `projectId` is unchanged and that nothing was recreated in the target project. The explanation itself is visible in `tests/e2e/artifacts/06-agent-chat/final.png` — the agent names the immutability rule and offers recreate-and-delete — but is not asserted, per §4.5. |
| 3.5 | Non-destructive single-task actions are not gated | The same test asserts `approval-card` count is **0**. |

### US-F4 — Manage projects, statuses and priorities via the agent

| # | Criterion | How it was verified |
| --- | --- | --- |
| 4.1 | Create and rename projects, seeded | Phase 4 story harness (`docs/verification/phase-4`). |
| 4.2 | Manage statuses and priorities, project-scoped | Phase 4 story harness. |
| 4.3 | Deleting a project/status/priority requires confirmation | `06 › "US-F4.3"` runs the same strict cycle against `delete_project` — a different entity kind and a bare `projectId` input — which is also what proves the card and the label resolver are not task-specific. |
| 4.4 | Blocked deletions refused with the reason and a way forward | Phase 4 story harness, where the message is asserted verbatim. The chat pane relays a tool failure's `message` unaltered (`components/chat/action-entry.tsx`). |

### US-F5 — Bulk changes with confirmation

| # | Criterion | How it was verified |
| --- | --- | --- |
| 5.1 | Multi-task requests treated as bulk | `06 › "US-F5.2/5.3"` and the framework-held gate: `bulk_update_tasks`, `bulk_delete_tasks` and all four deletes are `always()`, and `update_task` gates from the second distinct task in a turn. |
| 5.2 | States exactly what it will do — which tasks, what change, how many — and waits | `06 › "US-F5.2/5.3"` asserts `data-count="3"`, exactly three `approval-target-*` nodes, each carrying a real fixture title, and the target status resolved to the name "Done". `04-approval-card-bulk.png` is the same card as a picture. The delete test additionally asserts the card names the task and carries `data-severity="destructive"`. |
| 5.3 | Approve applies everything; decline changes nothing | The bulk test asserts all three rows are still un-moved while the card is up, then all three moved after Approve. The delete test asserts the row survives a Deny. |
| 5.4 | Reports what actually changed | The settled `action-entry` renders "Updated 3 tasks / Status → Done" from the tool result — see `05-approved-and-landed.png`. |

### US-F6 — Visible agent actions

| # | Criterion | How it was verified |
| --- | --- | --- |
| 6.1 | One structured entry per action, separate from prose | `06 › "US-F3.2/3.5 + US-F6.1"` asserts exactly one `action-entry[data-tool="update_task"]`. Entries render outside the prose bubbles — visible in every screenshot. |
| 6.2 | The reply also summarises in plain language | Visible in `05-approved-and-landed.png` and in the artifacts screenshot. Deliberately **not** E2E-asserted: it is the assistant's prose, which §4.5 forbids asserting. |
| 6.3 | Multiple actions show one entry each, in order | `components/message-animated.tsx` walks `message.parts` in full original order, so entries interleave with prose exactly as the model produced them. Visible in `05-approved-and-landed.png`: the `list_statuses` read, then the plan, then the write. |
| 6.4 | Entries persist as part of the history | `06 › "US-F1.3/1.4 + US-F6.3"` asserts the `create_task` entry is still rendered after a reload. |

---

## Observations (not acceptance criteria)

- **`ask_question` is handled by construction, not by test.** It arrives through
  the same `input.requested` protocol as an approval and is rendered by the same
  `ApprovalCard`, branching on `request.display` / `options` / `allowFreeform`
  rather than on a tool name — so its prompt is rendered verbatim and its own
  option ids become the buttons. Phase 4 recorded it as live but unexercised;
  forcing model ambiguity deterministically is outside this phase's control, so
  this closes the gap structurally rather than with a flaky test.
- **Accessibility.** `agent-browser a11y --tags wcag2a,wcag2aa` over the shell
  with a live conversation and an approval card on screen returned **zero
  violations**.
- **Console and page errors.** Zero of each on a fresh load of the rewired
  shell, and zero page errors across the whole `06` suite
  (`tests/e2e/artifacts/06-agent-chat/errors.json`).
- **No Stop button.** `agent.stop()` only detaches the client stream — the
  server turn keeps running and billing — so shipping one would be misleading.
  Recorded in `docs/decisions/phase-5-decisions.md`; nothing in US-F1–F6 asks
  for it.

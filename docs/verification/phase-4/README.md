# Phase 4 verification packet — EVE agent (Epic F backend half)

**Verdict: PASS.** All **17 acceptance criteria** across the four stories in
scope — **US-F2, US-F3, US-F4, US-F5** — were exercised on 2026-07-28 against a
real EVE agent (`anthropic/claude-sonnet-5`, eve 0.27.8) driven non-interactively
through `eve/client` against a real `next dev` (Next 16.2.6) on the **test**
Neon database, and all 17 pass. Nothing was skipped and nothing is blocked. No
model call is mocked, no tool is stubbed, and every state claim below is an
independent HTTP read of committed rows rather than a restatement of what the
agent said. Two things are reported honestly rather than smoothed over: the
`verify:agent` run in this packet **exits 1** on one assertion in scenario 03
(the assertion inspects only the *last* assistant message of a turn, and the
alternative was offered in that turn's first message and again as four labelled
`ask_question` options — quoted verbatim below, so the criterion itself passes);
and US-F2.2's "changes made through the UI" was exercised as an HTTP write
against the same `/api/tasks` routes the UI's mutations call, because this phase
is the backend half and has no chat pane to drive.

**Not in scope here.** US-F1 (split screen, persisted conversation) and US-F6
(structured activity entries in the chat) are Epic F's *front-end* half and are
Phase 5's work; they are not claimed anywhere in this packet.

---

## How this was verified

Everything was produced by two scripted, non-interactive harnesses. The
interactive `eve dev` TUI was deliberately **not** used: the phase asks for
transcripts, and a TUI session cannot be captured as one.

```bash
pnpm exec eve info                # 00 — the discovered agent surface
pnpm verify:agent                 # 01–06, stdout in 10
pnpm verify:agent:stories         # 11–14, stdout in 15
pnpm typecheck                    # 07
pnpm lint                         # 08
pnpm test                         # 09
```

Both harnesses ([`scripts/verify-agent-tools.ts`](../../../scripts/verify-agent-tools.ts),
[`scripts/verify-agent-stories.ts`](../../../scripts/verify-agent-stories.ts))
work the same way:

1. spawn one `next dev` on a free loopback port, with `DATABASE_URL` overridden
   **in the child environment only** to the separate test-database URL — never
   on a command line, so no credential can reach a process listing or any file
   in this directory;
2. wait for `/api/health` and then `/eve/v1/health`, so both the app and the EVE
   runtime mounted by `withEve` are live;
3. drive the agent with `eve/client`'s `Client`/`ClientSession`, **iterating the
   event stream** rather than awaiting an aggregate — the approval scenarios have
   to observe `input.requested` and read the database *while the run is still
   parked*, which is the only way to prove a gated tool had not already run;
4. build fixtures and check post-conditions over the HTTP API;
5. write one JSON transcript per scenario containing **every stream event
   verbatim**, plus the derived `toolCalls`, `approvalRequests` and
   `finalMessage`. No transcript contains an environment variable.

`verify-agent-stories.ts` was written for this packet: `verify-agent-tools.ts`
covers the phase's *exit criteria* (grounded read, rule violation relayed with an
alternative, delete pausing for approval), and the criteria it does not touch —
creation defaults, field edits, text search, read freshness, project/status/
priority management, the other two gated deletes — needed live evidence too.

Both live in `scripts/` rather than `tests/` because every run makes real, paid,
non-deterministic model calls; a flaky third-party model inside `pnpm test` would
poison the regression signal the 307-test suite exists to give. Run either one
with no other `pnpm dev` or `eve dev` process active — they share `.eve/` and
`.next/`.

**The agent surface under test** ([`00-eve-info.txt`](./00-eve-info.txt)):
compile ready, **0 diagnostics, 0 warnings**, **19 authored tools** — exactly the
plan §2.4 inventory — and 9 disabled framework tools (`bash`, `read_file`,
`write_file`, `glob`, `grep`, `web_fetch`, `web_search`, `agent`, `todo`).

---

## Results at a glance

| Story | # | Criterion (verbatim) | Result | Evidence |
| --- | --- | --- | --- | --- |
| US-F2 | 1 | Questions like "what's in progress in Website?" or "how many high-priority tasks are open?" are answered from current data. | **pass** | [`01`](./01-grounded-read.json) |
| US-F2 | 2 | Answers reflect changes made through the UI moments earlier (no stale reads). | **pass** (see note) | [`12`](./12-search-and-freshness.json) |
| US-F2 | 3 | The agent can find tasks by text ("the task about the header bug") using search, not guesswork. | **pass** | [`12`](./12-search-and-freshness.json) |
| US-F2 | 4 | When asked about something that doesn't exist, the agent says so rather than inventing it. | **pass** | [`01`](./01-grounded-read.json) |
| US-F3 | 1 | "Create a task called X in project Y" creates the task; omitted fields take the same defaults as UI creation (first status, default priority). | **pass** | [`11`](./11-task-lifecycle.json) |
| US-F3 | 2 | The agent can edit title, description, status, and priority of an identified task, and move a task's status directly ("move X to Done"). | **pass** | [`11`](./11-task-lifecycle.json) |
| US-F3 | 3 | Deleting a task via the agent requires the agent to ask for confirmation first; declining leaves the task unchanged. | **pass** | [`04`](./04-delete-approval-denied.json) |
| US-F3 | 4 | Asking to move a task to a different project is refused, with an explanation of the immutability rule and a valid alternative (e.g., recreate in the other project). | **pass** | [`02`](./02-project-move-refused.json) |
| US-F3 | 5 | Non-destructive single-task actions execute without a confirmation gate. | **pass** | [`11`](./11-task-lifecycle.json) |
| US-F4 | 1 | The agent can create and rename projects; new projects get the standard seeded defaults. | **pass** | [`13`](./13-list-management.json) |
| US-F4 | 2 | The agent can create, rename, reorder, and toggle-completed statuses, and create, rename, reorder, and set-default priorities — always scoped to a named project. | **pass** | [`13`](./13-list-management.json) |
| US-F4 | 3 | Deleting a project, status, or priority via the agent requires confirmation first. | **pass** | [`14`](./14-delete-gates-and-blocks.json), [`03`](./03-blocked-status-delete.json) |
| US-F4 | 4 | Blocked deletions (in use, last remaining, project with tasks) are refused with the same rules as the UI, and the agent explains the block and offers a valid path forward. | **pass** (see note) | [`14`](./14-delete-gates-and-blocks.json), [`03`](./03-blocked-status-delete.json) |
| US-F5 | 1 | A request that would modify or delete more than one task … is treated as bulk. | **pass** | [`05`](./05-bulk-approval-approved.json), [`06`](./06-looped-edit-gated.json) |
| US-F5 | 2 | Before executing, the agent states exactly what it is about to do (which tasks, what change, how many) and waits for approval. | **pass** | [`05`](./05-bulk-approval-approved.json) |
| US-F5 | 3 | On approval, all stated changes are applied; on decline, nothing changes. | **pass** | [`05`](./05-bulk-approval-approved.json), [`06`](./06-looped-edit-gated.json) |
| US-F5 | 4 | After execution, the agent reports what was actually changed. | **pass** | [`05`](./05-bulk-approval-approved.json) |

Harness totals: **42/42** assertions pass in `verify:agent:stories`
([`15`](./15-verify-agent-stories-run.txt), exit 0) and **27/28** in
`verify:agent` ([`10`](./10-verify-agent-tools-run.txt), exit 1 — the one failing
assertion is discussed under US-F4.4).

---

## US-F2 — Ask questions about my data

### F2.1 — answered from current data

Four tasks were seeded over the API, then asked about. The agent read before it
answered (`list_projects` → `list_tasks`), and the count and every title match a
direct `GET /api/tasks` taken afterwards. Evidence:
[`01-grounded-read.json`](./01-grounded-read.json).

```
tools called: ["list_projects","list_tasks"]

"Phase4 Grounded 33d4d9a0" has 4 tasks:

- **Fix the header bug** — To Do
- **Write release notes** — To Do
- **Migrate the settings page** — In Progress
- **Review the onboarding copy** — In Progress
```

The harness also asserts that **no write tool ran** in either turn of that
session, so the answer is a read, not a side effect.

### F2.2 — no stale reads

Scenario 12 asks a question, then changes the data **between turns**, then asks
again in the same session. The between-turns change was an HTTP `PATCH` and
`POST` against `/api/tasks` — the same route handlers the left-hand UI's
mutations call. Evidence:
[`12-search-and-freshness.json`](./12-search-and-freshness.json).

```
turn 1 (before the change):
  "The task \"Sticky header overlaps the nav on mobile\" … is currently in **To Do** status."

out-of-band: PATCH the header task → In Progress; POST a new task "Rotate the TLS certificate"

turn 2 tools called: ["list_tasks"]
  Here are the 4 tasks in "Phase4 Freshness 6e26e428":

  - **Sticky header overlaps the nav on mobile** — In Progress *(note: this moved from To Do since I last checked)*
  - **Update the billing FAQ** — To Do
  - **Compress the hero images** — In Progress
  - **Rotate the TLS certificate** — To Do
```

Committed state read back independently: exactly those four rows in exactly those
statuses. The agent re-read rather than reusing its own previous answer, picked
up a task that did not exist when it last looked, and reported the moved task in
its new status.

> **Note on this criterion.** The criterion says "through the UI". Phase 4 is the
> backend half and the harness is headless, so the change was made over HTTP
> against the routes the UI calls, not by clicking. The UI-driven half of this
> loop (agent change → UI, UI change → agent) is Epic G / Phase 5's US-G1 and is
> not claimed here.

### F2.3 — found by search, not guesswork

Same scenario, first turn. The request named no title ("the task about the header
bug"); the tool call carried a search term:

```json
{ "projectId": "c18c8397-…", "search": "header", "includeCompleted": true }
```

and the reply named the real row, `"Sticky header overlaps the nav on mobile"`.

### F2.4 — says so when it does not exist

Second turn of [`01-grounded-read.json`](./01-grounded-read.json), asking about a
project name generated to be absent:

```
I checked the project list and there's no project named "Nonexistent 289ea518" —
only "Personal" and "Phase4 Grounded 33d4d9a0" exist. So that project doesn't
exist, and there are no tasks to count.
```

No task or project was invented, and no write tool ran.

---

## US-F3 — Manage tasks via the agent

All three turns below are one session in
[`11-task-lifecycle.json`](./11-task-lifecycle.json); every post-condition is a
`GET /api/tasks/:id` afterwards.

### F3.1 — create takes the UI's defaults

Request: *Create a task called "Ship the changelog" in the project "…"* — with no
status and no priority named.

```
tools called: ["list_projects","create_task"]
Created "Ship the changelog" in Phase4 Lifecycle 14b12ee0, with the default
status (To Do) and priority (Medium).
```

Committed row: `status = "To Do"` (the project's **first** status) and
`priority = "Medium"` (the project's **default** priority) — byte-identical to
`lib/domain/defaults.ts`, which is also what UI creation uses.

### F3.2 — edits every field, and moves status directly

```
turn 2 — "Rename that task to …, set its description to …, change its priority to High."
  tools: ["list_priorities","update_task"]
  → committed: title "Ship the changelog (v2)", description "Draft it, get it
    reviewed by the team, then publish to the blog.", priority "High"

turn 3 — "Move it to Done."
  tools: ["list_statuses","update_task"]
  → committed: status "Done"
```

Title, description, priority and status are all covered, and the status move went
through `update_task` exactly as the plan intends.

### F3.3 — delete asks first; declining changes nothing

[`04-delete-approval-denied.json`](./04-delete-approval-denied.json). The run
**parks** at `input.requested` carrying the exact id the tool would delete:

```json
["delete_task", { "taskId": "d6ac7735-8998-41c7-9c46-8f29e7187561" }, "Approve tool call: delete_task"]
```

While parked, an independent `GET /api/tasks` shows the row **still present** —
this is what proves the pause is framework-enforced rather than prompt
compliance. The harness then answers `deny`:

```
The deletion was declined, so "Cancel the old DNS record" is still in your list.
Nothing was changed.
```

and the row is still there afterwards.

### F3.4 — a project move is refused, explained, and an alternative offered

[`02-project-move-refused.json`](./02-project-move-refused.json):

```
I found the task, but I can't do this: a task's project is fixed once created —
there's no move-between-projects operation in this app, so "Renew the SSL
certificate" can't be relocated from "Phase4 MoveFrom 25ac8abb" to "Phase4
MoveTo 73cfb1de".

A concrete alternative: I can create a new task titled "Renew the SSL
certificate" in "Phase4 MoveTo 73cfb1de" (copying its status/priority/
description if you'd like) and then delete the original from "Phase4 MoveFrom
25ac8abb". Want me to do that?
```

No `update_task` call carried a `projectId` — `updateTaskSchema` is a
`strictObject` with no such field, so the move is structurally inexpressible —
and the task is still in its original project afterwards.

### F3.5 — non-destructive single-task actions are not gated

Across the three turns of scenario 11 — create, multi-field edit, status move —
`approvalRequests` is **empty** in every turn. The corresponding structural fact
(`never()` on the thirteen non-destructive tools) is asserted by invoking each
policy in `tests/unit/agent/tools.test.ts`, in [`09-test.txt`](./09-test.txt).

---

## US-F4 — Manage projects, statuses, and priorities via the agent

Scenario [`13-list-management.json`](./13-list-management.json) is one session of
four turns; every list below was read back from
`/api/projects/:id/{statuses,priorities}` afterwards.

### F4.1 — create and rename projects, with seeded defaults

```
turn 1 tools: ["create_project"]
  Created the project "Phase4 Lists 1e85e3fa", seeded with the standard statuses
  (To Do, In Progress, Done) and priorities (Low, Medium, High).

turn 2 tools: ["rename_project"]
  Renamed the project from "Phase4 Lists 1e85e3fa" to "Phase4 Lists 1e85e3fa (renamed)".
```

Committed seed, read independently:
`statuses = [["To Do",false],["In Progress",false],["Done",true]]`,
`priorities = [["Low",false],["Medium",true],["High",false]]` — the standard
defaults, Medium default, exactly as UI creation produces.

### F4.2 — statuses and priorities: create, rename, reorder, toggle/default

```
turn 3 — "add a status called \"Shipped\", mark \"Shipped\" as counting as completed,
          rename \"To Do\" to \"Backlog\", and move \"Shipped\" to the front"
  tools: ["list_statuses","create_status","update_status","update_status"]
  → committed: [["Shipped",0,true],["Backlog",1,false],["In Progress",2,false],["Done",3,true]]

turn 4 — "add a priority called \"Critical\", make it the default, rename \"Low\" to
          \"Whenever\", reorder so the list reads Critical, Whenever, Medium, High"
  tools: ["list_priorities","create_priority","update_priority","update_priority",
          "update_priority","list_priorities"]
  → committed: [["Critical",0,true],["Whenever",1,false],["Medium",2,false],["High",3,false]]
```

Create, rename, reorder and toggle-completed are all demonstrated for statuses;
create, rename, reorder and set-default for priorities; exactly one default
priority survives. Every request named its project, and the agent listed that
project's statuses/priorities before acting — the "always scoped to a named
project" half of the criterion.

### F4.3 — deleting a project, status or priority asks first

All three destructive list tools park at `input.requested` before anything runs:

| Tool | Approval payload | Evidence |
| --- | --- | --- |
| `delete_project` | `{ "projectId": "4a35172e-…" }` | [`14`](./14-delete-gates-and-blocks.json) |
| `delete_priority` | `{ "priorityId": "73bc34df-…" }` | [`14`](./14-delete-gates-and-blocks.json) |
| `delete_status` | `{ "statusId": "46ac4a51-…" }` (from `14`; `03` parks the same tool on a different project) | [`14`](./14-delete-gates-and-blocks.json), [`03`](./03-blocked-status-delete.json) |

Each prompt carries the concrete id the tool would act on, so an approval card
renders exactly what is about to happen.

### F4.4 — blocked deletions are refused, explained, and a way forward offered

All three block rules were exercised live, each by **approving** the gate so the
action really ran and really threw, and each verified by reading the row back:

**Project that still has tasks** ([`14`](./14-delete-gates-and-blocks.json)):

```
I couldn't delete "Phase4 Blocks a0aad364" — it still has one task, "Reconcile
the invoice export", and projects with tasks can't be deleted. Since tasks can't
move between projects, your options are to delete that task (then I can delete
the project) or leave the project as is. How would you like to proceed?
```

**Priority still in use** ([`14`](./14-delete-gates-and-blocks.json)):

```
That was blocked — "Medium" is currently used by the task "Reconcile the invoice
export" in that project, and a priority still in use can't be deleted. If you'd
like, I can reassign that task to "Low" or "High" first, and then delete
"Medium." Let me know which priority to move it to (or if you'd rather delete
the task instead).
```

**Last remaining status** ([`14`](./14-delete-gates-and-blocks.json)):

```
That's blocked — "To Do" is the only status "Phase4 LastStatus 587fb09a" has,
and every project needs at least one status. If you want, I can create a new
status for that project first (e.g., "In Progress" or "Done"), and then delete
"To Do." Just let me know what to name it.
```

**Status still in use** ([`03`](./03-blocked-status-delete.json)) — this is the
one that trips a harness assertion, and it is worth reading in full:

```
message 1 of the turn:
  The deletion was blocked: "In Progress" still has 1 task assigned to it, and a
  status in use can't be deleted. Want me to move that task to another status
  (e.g., "To Do" or "Done") first, or would you rather I find and delete the task
  itself?

then list_tasks, then message 2 of the same turn:
  The task currently in "In Progress" is **"Rebuild the search index"**. Let me
  know how you'd like to proceed:

then ask_question:
  prompt:  The "In Progress" status is still used by one task: "Rebuild the
           search index". How would you like to handle it before I can delete
           the status?
  options: "Move it to 'To Do'" | "Move it to 'Done'" | "Delete the task instead"
           | "Leave everything as is"
```

The status still exists afterwards, the rule is relayed, and a concrete way
forward is offered twice — once in prose, once as four labelled options. The
assertion `a concrete way forward is offered` nonetheless **fails** in
[`10-verify-agent-tools-run.txt`](./10-verify-agent-tools-run.txt) (making that
run exit 1), because `Turn.finalMessage` keeps only the *last* assistant message
of a turn and the alternative landed in the first. That is a limitation of the
harness's derived summary field, not of the agent: the criterion is judged here
on the full event stream, which the transcript carries verbatim. Left as an
observation rather than silently fixed and re-run, so the packet reports what
actually happened.

---

## US-F5 — Bulk changes with confirmation

### F5.1 — a multi-task request is treated as bulk

Two shapes, because "treated as bulk" has to hold whether or not the bulk tool
can express the request.

*When it can* ([`05-bulk-approval-approved.json`](./05-bulk-approval-approved.json)):
three To Do tasks, one instruction, and the agent routes it through **exactly one**
`bulk_update_tasks` call and **zero** `update_task` calls:

```
tools called: ["list_projects","list_statuses","list_tasks","bulk_update_tasks"]
```

*When it cannot* ([`06-looped-edit-gated.json`](./06-looped-edit-gated.json)):
`bulk_update_tasks` has no title field, so "rename this one to X and that one to
Y" must loop `update_task` — and the second call still pauses:

```
tools called: ["list_projects","list_tasks","update_task","update_task"]
approvals:    [["update_task", { "taskId": "a57b3f21-…", "title": "Backfill the search index (v2)" }]]
```

An API read taken **while the run is parked** shows exactly one of the two
renames committed, so the gate lands before the second task changes.

### F5.2 — states exactly what it will do, then waits

```
I'll move all 3 To Do tasks in "Phase4 BulkMove 920e2d34" — "Audit the image
pipeline," "Draft the migration plan," and "Prune stale feature flags" — to In
Progress.
```

Which tasks (by name), what change, how many — and then the run parks, with the
approval payload naming all three ids explicitly:

```json
{ "taskIds": ["261e95f6-…", "db7f40a8-…", "5aedcecd-…"], "statusId": "368d6b91-…" }
```

### F5.3 — approve applies everything; decline changes nothing

Approving the bulk call moves **all three** rows — verified by
`GET /api/tasks?project=…`, every seeded task now carrying the In Progress status
id. On the decline side, [`04`](./04-delete-approval-denied.json) (delete denied,
row still present) and [`06`](./06-looped-edit-gated.json) (second rename denied,
title unchanged) both show nothing further being written after a denial:

```
Done partially: "Rotate the signing keys" is now renamed to "Rotate the signing
keys (Q3)". The second rename — "Backfill the search index" → "Backfill the
search index (v2)" — was not approved, so that task's title is unchanged.
```

### F5.4 — reports what actually changed

```
Done — moved all 3 To Do tasks in "Phase4 BulkMove 920e2d34" to In Progress:
"Audit the image pipeline," "Draft the migration plan," and "Prune stale feature
flags."
```

Plain language, the right count, the right destination, and it matches the
committed rows rather than the request.

---

## Supporting gates

| File | Result |
| --- | --- |
| [`07-typecheck.txt`](./07-typecheck.txt) | `pnpm typecheck` — clean, exit 0 |
| [`08-lint.txt`](./08-lint.txt) | `pnpm lint` — 0 errors; 1 pre-existing warning in `.remember/tmp/`, outside this phase's tree; exit 0 |
| [`09-test.txt`](./09-test.txt) | `pnpm test` — **307 tests, 307 pass, 0 fail, 0 skipped**, exit 0. Includes `tests/unit/agent/`, which asserts the §2.4 inventory, `inputSchema` identity with the shared zod objects, and the approval table by invoking every policy. |
| [`00-eve-info.txt`](./00-eve-info.txt) | `eve info` — compile ready, 0 diagnostics, 19 authored tools, 9 disabled framework tools |

---

## Observations (not acceptance criteria)

1. **The harness's `finalMessage` is a lossy summary.** Both scripts keep only
   the last `message.completed` of a turn in that field, and assertions written
   against it can miss text the agent produced earlier in the same turn — as
   happened in scenario 03. The transcripts themselves are complete (every stream
   event, verbatim), so nothing is lost; but a future run of `verify:agent` may
   flake on that one assertion again. Recording rather than fixing, because
   changing the assertion mid-verification would mean re-rolling the run it was
   meant to judge.
2. **The agent uses `ask_question` for genuine ambiguity, as instructed.** In
   scenario 03 it followed a blocked delete with a four-option question rather
   than guessing. That is behaviour the instructions ask for and no criterion
   forbids, but it does mean a turn can end parked on a *question* rather than an
   approval — worth knowing for the Phase 5 chat pane, which must render both.
3. **Model non-determinism is real.** Scenario 13's fourth turn issued three
   `update_priority` calls and then re-listed, concluding "the list already reads
   Critical, Whenever, Medium, High — no further reordering needed". The committed
   end state is correct; the route to it varies run to run. Assertions in both
   harnesses are therefore written against committed state and tool *names*
   wherever possible, not against a fixed call sequence.

---

## Reading a transcript

Each `.json` scenario file carries `scenario`, `model`, the fixtures it created,
an `assertions` array, and a `turns` array. Every turn holds:

- `events` — every stream event verbatim, so the file stays valid evidence even
  if the derived summaries ever need re-deriving;
- `toolCalls` — `{ name, input }` per call, derived from `actions.requested`;
- `approvalRequests` — the `input.requested` payloads, each carrying
  `action.toolName` and `action.input` (what a channel renders as the approval
  card);
- `finalMessage` — the last completed assistant message of the turn (see
  observation 1).

# User Stories & Acceptance Criteria

**Companion to:** [product-spec.md](./product-spec.md) (Draft v2)
**Status:** Draft v1
**Last updated:** 2026-07-27

These stories decompose the product spec into implementable, verifiable slices. They are ordered so that each epic builds on the previous, and can be used as an incremental validation checklist during implementation.

**How to read the agent stories:** because parity is the product, most capabilities appear twice — once as a direct-UI story (Epics B–E) and once under the agent (Epic F). The agent stories deliberately do not re-list every rule; they assert that *the same rules hold* through the agent path. The parity matrix in §Appendix ties the two together.

---

## Epic A — First Run & Foundation

### US-A1: Seeded workspace on first run
*As a new user, I want the app to be immediately usable on first launch, so that my first interaction can be real work instead of setup.*

**Acceptance criteria**
1. Given a fresh install with no data, when the app is opened, then exactly one project exists (e.g., "Personal").
2. The seeded project has statuses **To Do**, **In Progress**, **Done** in that order, with *Done* flagged as completed.
3. The seeded project has priorities **Low**, **Medium**, **High** in that order, with *Medium* designated as the default.
4. A task can be created in the seeded project immediately, through either the UI or the agent, with no additional setup.
5. Seeding happens exactly once — reopening the app does not create duplicate starter projects.

---

## Epic B — Task Management (Direct UI)

### US-B1: Create a task
*As a user, I want to create a task with a title, so that I can capture work quickly.*

**Acceptance criteria**
1. I can create a task by providing a title and selecting a project; description, status, and priority are optional inputs.
2. A task cannot be created without a title or without a project.
3. When status is omitted, the task gets the project's first status by order.
4. When priority is omitted, the task gets the project's default priority.
5. Only statuses and priorities belonging to the selected project are offered/accepted.
6. The new task appears in the task list immediately after creation.

### US-B2: View and browse tasks
*As a user, I want to see my tasks in a sensibly ordered list, so that the most important open work is on top.*

**Acceptance criteria**
1. The task list shows each task's title, project, status, and priority (status/project/priority rendered as tags/chips).
2. Open tasks sort by priority (highest first), then creation date (oldest first).
3. Tasks in completed statuses are hidden by default and revealed by a "show completed" toggle/filter.
4. When shown, completed tasks appear below open tasks and are visually distinct.
5. Opening a task shows all of its fields, including its full description.

### US-B3: Filter and search tasks
*As a user, I want to filter by tags and search by text, so that I can find any task quickly.*

**Acceptance criteria**
1. I can filter the list by project, by status, and by priority, individually or in combination.
2. Selecting/deselecting a tag updates the list immediately.
3. A text search input narrows the list to tasks whose title or description matches the query.
4. Search and tag filters combine (search applies within the filtered set).
5. An empty result state is shown when nothing matches, with a way to clear filters/search.

### US-B4: Edit a task
*As a user, I want to change a task's details, so that tasks stay accurate as work evolves.*

**Acceptance criteria**
1. I can edit a task's title, description, status, and priority.
2. The title cannot be cleared to empty.
3. Status and priority choices are limited to the task's own project's lists.
4. The task's project is displayed but **not editable** — there is no way in the UI to move a task to another project.
5. Saved changes are reflected in the list immediately.

### US-B5: Move a task's status
*As a user, I want a quick way to advance a task's status, so that updating progress is one action, not a form edit.*

**Acceptance criteria**
1. From the task list, I can change a task's status without opening a full edit form.
2. The available statuses are presented in the project's defined order.
3. Moving a task into a completed status makes it subject to the completed-task display rules (US-B2).
4. The change persists and is visible immediately.

### US-B6: Delete a task
*As a user, I want to delete a task I no longer need, with a guard against accidents.*

**Acceptance criteria**
1. Deleting a task requires an explicit confirmation step.
2. Declining the confirmation leaves the task unchanged.
3. Confirming removes the task from the list immediately and permanently.

---

## Epic C — Project Management

### US-C1: Create a project
*As a user, I want to create a new project that is instantly usable.*

**Acceptance criteria**
1. I can create a project by providing a name.
2. The new project is seeded with the default statuses (To Do / In Progress / Done, *Done* = completed) and priorities (Low / Medium / High, *Medium* = default).
3. A task can be created in the new project immediately.

### US-C2: Rename a project
*As a user, I want to rename a project without affecting its contents.*

**Acceptance criteria**
1. Renaming a project updates its name everywhere it appears (task tags, filters, management screens).
2. The project's tasks, statuses, and priorities are unaffected.

### US-C3: Delete a project
*As a user, I want to delete an empty project, and be clearly stopped when it still has tasks.*

**Acceptance criteria**
1. Deleting a project with zero tasks succeeds (after confirmation) and removes it and its statuses/priorities.
2. Attempting to delete a project that has tasks (open **or** completed) is blocked.
3. The block message states the reason (e.g., how many tasks remain) and what I can do about it.

---

## Epic D — Status Management (per project)

### US-D1: Manage statuses
*As a user, I want to define the workflow labels for each project.*

**Acceptance criteria**
1. Status management is always in the context of a selected project; each project's statuses are independent.
2. I can create a status, rename a status, and reorder statuses; the defined order is respected everywhere statuses appear.
3. I can toggle a status's **completed** flag; tasks in that status immediately follow the completed display rules.
4. Changes are reflected on existing tasks' tags immediately (e.g., a rename shows on every task in that status).

### US-D2: Delete a status
*As a user, I want to remove unused statuses, and be clearly stopped otherwise.*

**Acceptance criteria**
1. Deleting a status used by zero tasks succeeds.
2. Deleting a status that any task currently uses is blocked, with a message stating the reason and remedy (reassign or delete those tasks first).
3. Deleting the project's **last remaining status** is blocked, even if unused.

---

## Epic E — Priority Management (per project)

### US-E1: Manage priorities
*As a user, I want to define the priority scale for each project.*

**Acceptance criteria**
1. Priority management is always in the context of a selected project; each project's priorities are independent.
2. I can create a priority, rename a priority, and reorder priorities; order is respected everywhere (including task list sorting).
3. I can designate a priority as the project's **default**; exactly one default exists at all times.
4. Renames are reflected on existing tasks' tags immediately.

### US-E2: Delete a priority
*As a user, I want to remove unused priorities, and be clearly stopped otherwise.*

**Acceptance criteria**
1. Deleting a priority used by zero tasks succeeds.
2. Deleting a priority that any task currently uses is blocked, with a message stating the reason and remedy.
3. Deleting the project's **last remaining priority** is blocked, even if unused.
4. If the deleted priority was the default, the default designation automatically moves to the project's first priority by order.

---

## Epic F — The Agent

### US-F1: Converse with the agent
*As a user, I want to chat with a real agent alongside my task list, so that I can work in natural language.*

**Acceptance criteria**
1. The app is a **split screen**: the direct UI (task view + list management) occupies the left half, the agent chat the right half — both visible and usable at all times, with no navigation between them.
2. The chat is powered by a **real agent built on the Vercel EVE Agent Framework** — responses come from a live agent reasoning over live data, not mocks or canned replies.
3. There is a single ongoing conversation; reloading the page or restarting the app preserves the full history.
4. Prior context carries across sessions — a follow-up like "move that one to Done" resolves against earlier conversation turns.

### US-F2: Ask questions about my data
*As a user, I want the agent to answer questions from my live data, so that its answers are trustworthy.*

**Acceptance criteria**
1. Questions like "what's in progress in Website?" or "how many high-priority tasks are open?" are answered from current data.
2. Answers reflect changes made through the UI moments earlier (no stale reads).
3. The agent can find tasks by text ("the task about the header bug") using search, not guesswork.
4. When asked about something that doesn't exist, the agent says so rather than inventing it.

### US-F3: Manage tasks via the agent
*As a user, I want to create, edit, move, and delete tasks by asking, so that the agent is a full peer of the UI.*

**Acceptance criteria**
1. "Create a task called X in project Y" creates the task; omitted fields take the same defaults as UI creation (first status, default priority).
2. The agent can edit title, description, status, and priority of an identified task, and move a task's status directly ("move X to Done").
3. Deleting a task via the agent requires the agent to ask for confirmation first; declining leaves the task unchanged.
4. Asking to move a task to a different project is refused, with an explanation of the immutability rule and a valid alternative (e.g., recreate in the other project).
5. Non-destructive single-task actions execute without a confirmation gate.

### US-F4: Manage projects, statuses, and priorities via the agent
*As a user, I want the agent to manage my lists too, so that no capability is UI-only.*

**Acceptance criteria**
1. The agent can create and rename projects; new projects get the standard seeded defaults.
2. The agent can create, rename, reorder, and toggle-completed statuses, and create, rename, reorder, and set-default priorities — always scoped to a named project.
3. Deleting a project, status, or priority via the agent requires confirmation first.
4. Blocked deletions (in use, last remaining, project with tasks) are refused with the same rules as the UI, and the agent explains the block and offers a valid path forward.

### US-F5: Bulk changes with confirmation
*As a user, I want the agent to handle multi-task requests safely.*

**Acceptance criteria**
1. A request that would modify or delete more than one task (e.g., "move everything in To Do to In Progress", "delete all completed tasks") is treated as bulk.
2. Before executing, the agent states exactly what it is about to do (which tasks, what change, how many) and waits for approval.
3. On approval, all stated changes are applied; on decline, nothing changes.
4. After execution, the agent reports what was actually changed.

### US-F6: Visible agent actions
*As a user, I want to see exactly what the agent did, so that I can trust and verify it.*

**Acceptance criteria**
1. Each action the agent performs is rendered in the chat as a distinct, structured activity entry (e.g., *Created task "Fix header" in Website*), separate from prose.
2. The agent's reply also summarizes in plain language what changed and where.
3. A conversation with multiple actions shows one entry per action, in order.
4. Structured action entries persist as part of the conversation history.

---

## Epic G — Live Sync & Parity

### US-G1: Agent changes appear live in the UI
*As a user, I want to watch the agent's changes land in my task list in real time.*

**Acceptance criteria**
1. With the task UI open, an agent-made change (create/edit/move/delete, or list changes like a status rename) appears in the UI without a manual refresh.
2. This holds for all entity types: tasks, projects, statuses, priorities.

### US-G2: UI changes are visible to the agent
*As a user, I want the agent to always see my latest manual changes.*

**Acceptance criteria**
1. A change made in the UI is reflected in the agent's very next read/answer — no stale answers about data changed moments before.

### US-G3: Concurrent edits converge
*As a user, I want simultaneous edits to resolve predictably.*

**Acceptance criteria**
1. When the UI and agent modify the same task around the same time, the last write wins and no error/lock state is surfaced.
2. Both interfaces subsequently show the same converged state.

### US-G4: Parity holds across the whole capability set
*As a reviewer of this reference app, I want to verify that every capability works identically through both interfaces.*

**Acceptance criteria**
1. Every capability row in the parity matrix (Appendix) can be demonstrated through the UI **and** through the agent, with the same result.
2. Every rule (project immutability, per-project scoping, block-if-in-use, minimum lists) produces the same outcome through both interfaces — allowed the same, blocked the same.
3. There is no capability available to one interface but not the other.

---

## Appendix — Parity matrix

Use this as the final validation checklist: each row must pass through both interfaces.

| Capability | UI story | Agent story |
|---|---|---|
| Create task (with defaults) | US-B1 | US-F3 |
| View/browse/filter/search tasks | US-B2, US-B3 | US-F2 |
| Edit task fields | US-B4 | US-F3 |
| Move task status | US-B5 | US-F3 |
| Delete task (confirmed) | US-B6 | US-F3 |
| Project change blocked (immutability) | US-B4.4 | US-F3.4 |
| Create project (seeded) | US-C1 | US-F4 |
| Rename project | US-C2 | US-F4 |
| Delete project (blocked when has tasks) | US-C3 | US-F4 |
| Create/rename/reorder statuses, toggle completed | US-D1 | US-F4 |
| Delete status (in-use / last-one blocked) | US-D2 | US-F4 |
| Create/rename/reorder priorities, set default | US-E1 | US-F4 |
| Delete priority (in-use / last-one blocked, default reassigns) | US-E2 | US-F4 |
| Bulk change (agent: confirm first) | — (deferred, §11) | US-F5 |

# Product Spec — Agent-Native Task Manager

**Status:** Draft v2
**Last updated:** 2026-07-27

---

## 1. Purpose

This project is a **reference application** for building *agent-native* software. The product itself — a basic task manager — is intentionally simple. Its value is in demonstrating and validating one architectural idea:

> **The user and the AI agent are peers.** Every action a user can take through the UI, the agent can take through its tools, and both are backed by the exact same underlying capability. There is no action the UI can perform that the agent cannot, and none the agent can perform that the UI cannot.

Feature sophistication is explicitly *not* a goal. The goal is a clean, honest demonstration of UI/agent parity that others can study and pattern-match against.

### Design principles

1. **One set of actions, two front doors.** The UI and the agent are two interfaces onto a single shared set of actions. Neither has privileged capabilities.
2. **Parity is the product.** If a capability exists for one interface, it must exist for the other. Divergence is a defect.
3. **One source of truth.** Both interfaces read and write the same data. A change made through one is immediately true for the other.
4. **Keep the domain small.** The task-management feature set stays minimal so attention stays on the architecture.

---

## 2. Goals & non-goals

### Goals
- A working task manager that a single person can use to organize work.
- Complete parity between what the user can do in the UI and what the agent can do via its tools.
- A live, shared view of data: changes from either interface are reflected in the other without manual refresh.
- Clear, safe handling of destructive actions.

### Given constraints

This spec avoids implementation details, with two deliberate exceptions that are product decisions in their own right:

- **The agent is real, and built on the Vercel EVE Agent Framework** ([eve.dev](https://eve.dev/docs/getting-started)). The project already contains a basic chat UI; it must be powered by an actual EVE-based agent — not a mock, canned responses, or a bare model call. Validating EVE as the agent architecture is part of this project's purpose as a reference app.
- **The starting point is the existing app.** The current chat UI is the shell the agent experience grows from, rather than a separate rebuild.

### Non-goals (for v1)
- Multiple users, accounts, authentication, sharing, or collaboration.
- Rich task features beyond the defined fields (no due dates, attachments, comments, subtasks, recurring tasks, reminders, etc.).
- Notifications, calendar/email integrations, or external sync.
- Analytics, reporting, or dashboards.
- Mobile-native apps (responsive web is sufficient).

---

## 3. Users

**Single user, no authentication.** There is one implicit owner of all data. The app opens directly into a usable state with no login. Concepts like ownership, permissions, and assignees are out of scope.

**First run.** On first launch, the app is seeded with one starter project (e.g., "Personal"), which carries the standard default statuses and priorities. There is no setup wall — the very first interaction can be creating a task, through either interface.

The single user interacts through two interfaces that are always available:
- The **direct UI** (lists, forms, controls).
- The **agent** (a chat conversation).

Both operate on the same data at the same time.

---

## 4. Domain model

The system manages four kinds of things.

### 4.1 Project
A container that scopes work. Everything else lives inside a project.

- A project has a **name**.
- A project **owns its own set of Statuses and Priorities** — these are not global. Two projects can have entirely different statuses and priorities.
- When a project is created, it is **seeded with sensible default Statuses and Priorities** so it is immediately usable. The user (or agent) can rename, reorder, add, or remove these afterward.
  - Default statuses: **To Do**, **In Progress**, **Done** (with *Done* marked as completed).
  - Default priorities: **Low**, **Medium**, **High**.

### 4.2 Status (per project)
A label describing where a task is in its lifecycle.

- Belongs to exactly one project.
- Has a **name**.
- Has an **order** relative to the project's other statuses (used for consistent display and progression).
- Can be flagged as **completed/terminal** — one or more statuses per project may represent "done" work. This lets the app distinguish open work from finished work.

### 4.3 Priority (per project)
A label describing how important/urgent a task is.

- Belongs to exactly one project.
- Has a **name**.
- Has an **order** relative to the project's other priorities (e.g., Low → High).
- Exactly **one priority per project is designated the default** (used when a task is created without an explicit priority). In the seeded set, *Medium* is the default. If the default priority is deleted, the designation moves to the project's first priority by order.

### 4.4 Task
The unit of work.

A task has exactly these fields:

| Field | Description |
|---|---|
| **Title** | Short summary of the task. Required. |
| **Description** | Longer free-text detail. Optional. |
| **Project** | The project the task belongs to. Required. **Set once, immutable** — a task can never move to a different project after creation. |
| **Status** | One of the task's project's statuses. Required. |
| **Priority** | One of the task's project's priorities. Required. |

Rules:
- A task's Status and Priority must always be ones that belong to that task's project. A task can never reference a status or priority from another project.
- **Creation defaults.** If not specified at creation, a task takes the project's **first status by order** and the project's **default priority** (the middle of the seeded set, e.g., *Medium*; each project designates one priority as its default). Task creation must always succeed against a freshly-created project without extra setup.
- Every task always has a status and a priority — there is no "none" state for either.

---

## 5. Capabilities (the shared action set)

These are the actions the system supports. **Each one is available identically to both the UI and the agent.** This list is the contract for parity — if an item here works in one interface but not the other, that is a bug.

### Tasks
- Create a task (in a project, with title, optional description, optional status/priority — defaults apply when omitted).
- View a task and its fields.
- List/browse tasks, filtered by project, status, and priority.
- **Search tasks** by text across title and description (combinable with the filters above).
- Edit a task's title, description, status, and priority.
- **Move a task's status** (a common, first-class action).
- Delete a task.
- (A task's project can be read but **never changed**.)

### Projects
- Create a project (seeded with default statuses and priorities).
- View/list projects.
- Rename a project.
- Delete a project — **only if it has no tasks** (see §7).

### Statuses (within a project)
- Create a status.
- Rename a status, change its order, toggle its completed flag.
- Reorder statuses.
- Delete a status — **only if no task in the project uses it** (see §7).

### Priorities (within a project)
- Create a priority.
- Rename a priority, change its order.
- Reorder priorities.
- Set a priority as the project's **default**.
- Delete a priority — **only if no task in the project uses it** (see §7).

---

## 6. Agent behavior & parity

The agent is a conversational assistant that can perform **every** capability in §5 — including managing projects, statuses, and priorities, not just tasks. It is a full peer of the UI, not a limited helper.

### Expectations
- **Full capability parity.** Anything in the capability set can be initiated by the agent through natural language.
- **Grounded in real data.** The agent reads live data to answer questions ("what's in progress in the Website project?") and acts on live data. It does not invent or cache stale state.
- **Confirmation before destructive actions.** Before executing a destructive or bulk action, the agent must confirm intent with the user. Destructive actions include:
  - Deleting a task, project, status, or priority.
  - Any **bulk change** — defined as a single request that would modify or delete more than one task.

  Non-destructive actions (creating, editing a single task, moving a status, etc.) execute directly without a confirmation gate.
- **Respects the same rules as the UI.** The agent cannot move a task between projects, cannot assign a status/priority from a different project, and cannot delete something that is still in use. When a request violates a rule, the agent explains why and offers a valid path forward (e.g., "The 'Design' project still has 4 tasks — I can reassign or delete them first, or archive the project instead once that's supported").
- **Transparency.** The agent's actions are visible in two layers:
  - **Structured activity in chat.** Each action the agent takes is rendered in the conversation as a distinct, structured entry (e.g., *Created task "Fix header" in Website*) — not buried in prose. This makes the shared action set literally visible, which is central to the reference-app goal.
  - **Plain-language summary.** The agent's reply also states in plain language what it did (what changed, and where), so the user can trust and verify it.

### Agent interaction surface
- A **chat UI** where the user converses with the agent — the app's existing chat interface, powered by a real agent built on the **Vercel EVE Agent Framework** (see Given constraints, §2).
- **One persistent conversation.** There is a single ongoing conversation with the agent that survives page reloads and app restarts. Conversation history — including the structured action entries — is retained, so the agent has continuity ("move that one to Done" works across sessions). Multiple threads are out of scope for v1.
- The chat occupies the right half of the split-screen layout (§8.0), alongside the direct UI, so the user can watch the agent's changes appear in the UI in real time.

---

## 7. Rules & constraints

These rules hold regardless of which interface (UI or agent) triggers the action.

1. **Project immutability.** A task's project is fixed at creation and can never change.
2. **Scoped references.** A task's status and priority must always belong to the task's own project.
3. **Delete-if-unused (block otherwise).**
   - A **project** can be deleted only if it contains no tasks.
   - A **status** can be deleted only if no task in its project currently uses it.
   - A **priority** can be deleted only if no task in its project currently uses it.
   - When blocked, the system clearly explains what is blocking the deletion and what the user can do about it (reassign the tasks, delete them, etc.).
4. **Defaults on project creation.** Every new project is immediately usable, seeded with default statuses and priorities.
5. **Minimum lists.** Every project must always retain **at least one status and at least one priority** — the last one cannot be deleted, even if unused. This guarantees task creation is always possible.
6. **Concurrent edits.** The user and agent may act at the same time. The system resolves this simply: **last write wins**, with no locking. Both interfaces converge on the latest state via live sync (§8.3).

---

## 8. UI experience

The direct UI is where the user makes changes by hand. It must expose the full capability set from §5.

### 8.0 Layout: split screen
The app is a **split-screen** experience:

- The **left half** is the direct UI — the task view and list management.
- The **right half** is the agent chat.
- Both halves are visible and usable at all times; neither is a drawer, modal, or separate page. This makes the core thesis directly observable: ask the agent for a change on the right, watch it land in the UI on the left.
- On viewports too narrow for a usable split (e.g., phones), the halves may stack or toggle — the side-by-side experience is the primary target, per the desktop-web focus in §2.

### 8.1 Task view ("ToDo UI")
- A **filterable list of tasks**. This is the primary view.
- **Status, Project, and Priority appear as tags/chips.** The user filters the list by selecting these tags (e.g., show tasks in the "Website" project that are "In Progress" and "High" priority).
- A **text search** box narrows the list by title/description, combinable with the tag filters.
- **Default ordering:** tasks in completed statuses sink to the bottom; open tasks sort by priority (highest first), then by creation date (oldest first). 
- **Open vs. done:** tasks in completed statuses are visually distinct and hidden by default behind a "show completed" toggle/filter, so the default view is the open work.
- Creating and editing a task is done through a simple form exposing the task's fields.
- **Moving a task's status** is a quick, prominent action (statuses are shown in their defined order).
- Deleting a task asks for confirmation.

### 8.2 List management
Dedicated management surfaces for the "list" entities:
- **Projects** — create, rename, delete (delete blocked when tasks exist).
- **Statuses** (per project) — create, rename, reorder, toggle completed, delete (blocked when in use).
- **Priorities** (per project) — create, rename, reorder, delete (blocked when in use).

Because statuses and priorities are per-project, managing them is always done in the context of a selected project.

### 8.3 Live sync
- Changes made by the **agent** appear in the open UI **immediately**, without a manual refresh.
- Changes made in the **UI** are likewise immediately visible to the agent's reads.
- The UI and agent share one source of truth; the user should never see two conflicting versions of the data.

---

## 9. Cross-cutting behavior

- **Consistency.** The same input produces the same result and the same rule enforcement, whether it came from the UI or the agent.
- **Clear errors.** When an action is rejected (rule violation, deleting something in use, invalid status for a project), the reason is stated in plain language, in both interfaces.
- **Safety.** Destructive actions are guarded — confirmation in the UI, and confirmation-before-execution by the agent.
- **No hidden capabilities.** There is no admin-only or interface-only action. §5 is the whole surface, for everyone.

---

## 10. Success criteria

This reference application is successful when:

1. **Parity holds.** For every capability in §5, a reviewer can perform it through the UI *and* ask the agent to perform it, with identical results and identical rule enforcement.
2. **The shared-action model is visible.** It is evident to someone studying the app that the UI and agent are two interfaces onto one shared set of actions — not two separate implementations kept in sync by hand.
3. **Live parity is demonstrable.** A user can ask the agent to make a change and watch it appear in the UI in real time, and vice-versa.
4. **Rules are honored uniformly.** Project immutability, per-project scoping, and delete-if-unused behave the same no matter who triggers them.
5. **It stays simple.** The domain remains small enough that the architecture — not the feature set — is the takeaway.

---

## 11. Open questions / future

Deliberately deferred; noted so they aren't mistaken for oversights:
- **Archiving** as an alternative to hard deletes (would relax the block-if-in-use rule).
- **Multi-user, accounts, and collaboration** (assignees, sharing, permissions).
- **Richer task fields** (due dates, labels, subtasks, attachments).
- **Bulk operations UX** in the direct UI (the agent handles bulk via confirmation today).
- **Undo / history** for both interfaces.
- **Multiple agent conversations/threads** (v1 has one persistent conversation).
- **Agent attribution in the task UI** (marking which changes were made by the agent vs. by hand).

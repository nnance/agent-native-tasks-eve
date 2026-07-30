/**
 * The MCP tool inventory — the third front door onto the shared action layer
 * (implementation plan §2.8), and the file that makes parity checkable.
 *
 * It is the same table as §2.4's tool inventory, in the same order, with the
 * same nineteen names. Every entry does exactly what an `agent/tools/*.ts`
 * module does and nothing more: advertise the shared `lib/schemas` object
 * itself, parse with it, call the one shared action, and let `runAction` map
 * the outcome. No product rule is re-checked here, and no capability exists
 * here that the EVE agent lacks — `tests/unit/mcp/inventory.test.ts` derives
 * its expectations from `agent/tools/` by import, so drift on either side
 * fails a test rather than surviving review.
 *
 * Three columns are worth reading closely:
 *
 * - **`gate`** is this interface's translation of EVE's approval column.
 *   `"always"` is `always()`; `"first-edit-free"` is `afterFirstTaskInTurn`
 *   re-scoped to an MCP session; `"none"` is `never()`. What the gate *does*
 *   once it trips is `mcp/guard.ts`'s problem, and the honest limits of it are
 *   written down in `mcp/README.md`.
 * - **`annotations`** are MCP's advisory hints. They are not the gate — a host
 *   is free to ignore them — but they are how a host that prompts knows which
 *   calls deserve a louder prompt, so the destructive six are marked as such.
 * - **`call`** returns the payload the model sees, already trimmed for the six
 *   array-shaped tools by the same `compactPayload` the EVE tools use. MCP has
 *   no "channel" half to send full rows to, so the trimmed value is the whole
 *   result; `get_task` is the escape hatch for a task's full text, exactly as
 *   it is for the internal agent.
 */

import type { z } from "zod"

import {
  bulkDeleteTasks,
  bulkUpdateTasks,
  createPriority,
  createProject,
  createStatus,
  createTask,
  deletePriority,
  deleteProject,
  deleteStatus,
  deleteTask,
  getTask,
  listPriorities,
  listProjects,
  listStatuses,
  listTasks,
  renameProject,
  updatePriority,
  updateStatus,
  updateTask,
} from "../lib/actions/index.ts"
import {
  compactDeletedTask,
  compactPayload,
  compactPriority,
  compactProject,
  compactStatus,
  compactTask,
} from "../lib/compact.ts"
import type { Database } from "../lib/db/client.ts"
import {
  bulkDeleteTasksSchema,
  bulkUpdateTasksSchema,
  createPrioritySchema,
  createProjectSchema,
  createStatusSchema,
  createTaskSchema,
  deletePrioritySchema,
  deleteProjectSchema,
  deleteStatusSchema,
  deleteTaskSchema,
  getTaskSchema,
  listPrioritiesSchema,
  listProjectsSchema,
  listStatusesSchema,
  listTasksSchema,
  renameProjectSchema,
  updatePrioritySchema,
  updateStatusSchema,
  updateTaskSchema,
} from "../lib/schemas/index.ts"
import { runAction } from "../lib/tool-result.ts"

/**
 * How a call is guarded. The three values are exactly the three distinct
 * approval policies in plan §2.4's table, named for what they do rather than
 * for the EVE helper they mirror, since the mechanism differs (see mcp/guard).
 */
export type Gate = "none" | "always" | "first-edit-free"

/** MCP's advisory hints, as served on every tool. */
export type Annotations = {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export type McpToolEntry = {
  name: string
  description: string
  /** The shared schema object itself — never a copy, never a superset. */
  schema: z.ZodType
  gate: Gate
  annotations: Annotations
  /** Runs the action and returns the model-facing payload. */
  call: (args: unknown, database?: Database) => Promise<unknown>
}

/** Every tool in this repo acts on one small, closed domain. */
const CLOSED_WORLD = { openWorldHint: false } as const

/** A read. `destructiveHint` and `idempotentHint` are moot when readOnly. */
const READ: Annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  ...CLOSED_WORLD,
}

/** A write that adds something, or sets named fields to given values. */
const WRITE: Annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  ...CLOSED_WORLD,
}

/**
 * A write that removes data, or overwrites it across many rows at once.
 * `idempotentHint` is false for the deletes on purpose: a second call with the
 * same id is not a no-op, it is a `not_found`.
 */
const DESTRUCTIVE: Annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  ...CLOSED_WORLD,
}

/**
 * The nineteen capabilities of product spec §5, in plan §2.4's order.
 *
 * The descriptions are this interface's own, as `lib/api/respond.ts` and
 * `lib/tool-result.ts` are two vocabularies for the same two errors: they say
 * the same things about the domain as the EVE tool descriptions, and different
 * things about the gate, because the gate an external caller meets is not the
 * one the chat pane renders.
 */
export const INVENTORY: readonly McpToolEntry[] = [
  {
    name: "list_projects",
    description:
      "List every project, oldest first. Takes no arguments. Start here when " +
      "the user names a project by name and you need its id.",
    schema: listProjectsSchema,
    gate: "none",
    annotations: READ,
    call: async (args, database) =>
      compactPayload(
        await runAction(() =>
          listProjects(listProjectsSchema.parse(args), database)
        ),
        compactProject
      ),
  },
  {
    name: "create_project",
    description:
      "Create a project. It is seeded with the standard statuses (To Do, In " +
      "Progress, Done) and priorities (Low, Medium, High, with Medium as the " +
      "default), so a task can be created in it immediately with no further " +
      "setup.",
    schema: createProjectSchema,
    gate: "none",
    annotations: WRITE,
    call: (args, database) =>
      runAction(() => createProject(createProjectSchema.parse(args), database)),
  },
  {
    name: "rename_project",
    description:
      "Rename a project. Its tasks, statuses and priorities are untouched.",
    schema: renameProjectSchema,
    gate: "none",
    annotations: { ...WRITE, idempotentHint: true },
    call: (args, database) =>
      runAction(() => renameProject(renameProjectSchema.parse(args), database)),
  },
  {
    name: "delete_project",
    description:
      "Delete a project permanently, with its statuses and priorities. Only " +
      "possible when the project has no tasks; otherwise the call is refused " +
      "and says how many tasks are blocking it. Requires the user's " +
      "confirmation before it runs.",
    schema: deleteProjectSchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: (args, database) =>
      runAction(() => deleteProject(deleteProjectSchema.parse(args), database)),
  },
  {
    name: "list_tasks",
    description:
      "List tasks, optionally filtered by project, status, priority, and a " +
      "case-insensitive text search over titles and descriptions. Every filter " +
      "combines. Completed tasks are hidden unless includeCompleted is true or " +
      "you filter to a completed status explicitly. Results come back in the " +
      "same order the user's list shows them: open before completed, then " +
      "highest priority first, then oldest first. Rows are compact and carry no " +
      "description — call get_task when you need a task's full text.",
    schema: listTasksSchema,
    gate: "none",
    annotations: READ,
    call: async (args, database) =>
      compactPayload(
        await runAction(() => listTasks(listTasksSchema.parse(args), database)),
        compactTask
      ),
  },
  {
    name: "get_task",
    description:
      "Read one task in full, including its description and the names of its " +
      "project, status and priority.",
    schema: getTaskSchema,
    gate: "none",
    annotations: READ,
    call: (args, database) =>
      runAction(() => getTask(getTaskSchema.parse(args), database)),
  },
  {
    name: "create_task",
    description:
      "Create a task in a project. An omitted statusId takes the project's " +
      "first status and an omitted priorityId takes the project's default " +
      "priority, so do not ask the user for either unless they raised it. A " +
      "status or priority must belong to the same project as the task.",
    schema: createTaskSchema,
    gate: "none",
    annotations: WRITE,
    call: (args, database) =>
      runAction(() => createTask(createTaskSchema.parse(args), database)),
  },
  {
    name: "update_task",
    description:
      "Edit one task's title, description, status and/or priority. This is also " +
      "how a task moves between statuses. Supply at least one field beyond " +
      "taskId; pass description as null to clear it. The new status or priority " +
      "must belong to the task's own project. A task's project cannot be " +
      "changed and there is no field for it. When more than one task is " +
      "affected, use bulk_update_tasks instead of calling this repeatedly: the " +
      "first task you edit in a session runs immediately, and editing a second " +
      "task with this tool requires the user's confirmation, one task at a time.",
    schema: updateTaskSchema,
    gate: "first-edit-free",
    annotations: { ...WRITE, idempotentHint: true },
    call: (args, database) =>
      runAction(() => updateTask(updateTaskSchema.parse(args), database)),
  },
  {
    name: "delete_task",
    description:
      "Delete one task permanently. Requires the user's confirmation before it " +
      "runs — pass the task id you actually read from list_tasks. To delete " +
      "several tasks, use bulk_delete_tasks instead so the user sees one " +
      "accurate confirmation.",
    schema: deleteTaskSchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: (args, database) =>
      runAction(() => deleteTask(deleteTaskSchema.parse(args), database)),
  },
  {
    name: "bulk_update_tasks",
    description:
      "Apply one status and/or priority to several tasks at once, atomically — " +
      "all of them succeed or none do. Use this instead of repeated update_task " +
      "calls whenever more than one task changes. Supply a statusId and/or a " +
      "priorityId; every status or priority must belong to the project of every " +
      "task named. Requires the user's confirmation, and the confirmation names " +
      "the tasks you passed, so pass explicit ids you read from list_tasks.",
    schema: bulkUpdateTasksSchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: async (args, database) =>
      compactPayload(
        await runAction(() =>
          bulkUpdateTasks(bulkUpdateTasksSchema.parse(args), database)
        ),
        compactTask
      ),
  },
  {
    name: "bulk_delete_tasks",
    description:
      "Delete several tasks permanently, atomically — all of them or none. " +
      "Requires the user's confirmation, which names every task you passed.",
    schema: bulkDeleteTasksSchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: async (args, database) =>
      compactPayload(
        await runAction(() =>
          bulkDeleteTasks(bulkDeleteTasksSchema.parse(args), database)
        ),
        compactDeletedTask
      ),
  },
  {
    name: "list_statuses",
    description:
      "List a project's statuses in their defined order. Statuses are " +
      "per-project, so a task can only use one of its own project's statuses.",
    schema: listStatusesSchema,
    gate: "none",
    annotations: READ,
    call: async (args, database) =>
      compactPayload(
        await runAction(() =>
          listStatuses(listStatusesSchema.parse(args), database)
        ),
        compactStatus
      ),
  },
  {
    name: "create_status",
    description:
      "Create a status in a project. It is appended to the end of the " +
      "project's list. Set isCompleted when the status means the work is " +
      "finished — tasks in a completed status sink to the bottom of the list " +
      "and are hidden by default.",
    schema: createStatusSchema,
    gate: "none",
    annotations: WRITE,
    call: (args, database) =>
      runAction(() => createStatus(createStatusSchema.parse(args), database)),
  },
  {
    name: "update_status",
    description:
      "Rename a status, move it to a new position, or change whether it counts " +
      "as completed. Supply at least one field beyond statusId. `order` is the " +
      "0-based target position within the project's list, so 0 moves the " +
      "status to the front; the other statuses renumber around it.",
    schema: updateStatusSchema,
    gate: "none",
    annotations: { ...WRITE, idempotentHint: true },
    call: (args, database) =>
      runAction(() => updateStatus(updateStatusSchema.parse(args), database)),
  },
  {
    name: "delete_status",
    description:
      "Delete a status permanently. Refused when a task in the project still " +
      "uses it, and refused when it is the project's last remaining status. " +
      "Requires the user's confirmation before it runs.",
    schema: deleteStatusSchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: (args, database) =>
      runAction(() => deleteStatus(deleteStatusSchema.parse(args), database)),
  },
  {
    name: "list_priorities",
    description:
      "List a project's priorities in their defined order, lowest first. " +
      "Exactly one is the project's default, used when a task is created " +
      "without an explicit priority.",
    schema: listPrioritiesSchema,
    gate: "none",
    annotations: READ,
    call: async (args, database) =>
      compactPayload(
        await runAction(() =>
          listPriorities(listPrioritiesSchema.parse(args), database)
        ),
        compactPriority
      ),
  },
  {
    name: "create_priority",
    description:
      "Create a priority in a project. It is appended as the highest " +
      "priority and is never the default; use update_priority to make it one.",
    schema: createPrioritySchema,
    gate: "none",
    annotations: WRITE,
    call: (args, database) =>
      runAction(() =>
        createPriority(createPrioritySchema.parse(args), database)
      ),
  },
  {
    name: "update_priority",
    description:
      "Rename a priority, move it to a new position, or make it the project's " +
      "default. Supply at least one field beyond priorityId. `order` is the " +
      "0-based target position, lowest priority first. isDefault can only be " +
      "set to true — a project always has exactly one default, so naming a new " +
      "one is the only way to move the designation.",
    schema: updatePrioritySchema,
    gate: "none",
    annotations: { ...WRITE, idempotentHint: true },
    call: (args, database) =>
      runAction(() =>
        updatePriority(updatePrioritySchema.parse(args), database)
      ),
  },
  {
    name: "delete_priority",
    description:
      "Delete a priority permanently. Refused when a task in the project still " +
      "uses it, and refused when it is the project's last remaining priority. " +
      "If it was the default, the designation moves to the project's first " +
      "priority by order. Requires the user's confirmation before it runs.",
    schema: deletePrioritySchema,
    gate: "always",
    annotations: DESTRUCTIVE,
    call: (args, database) =>
      runAction(() =>
        deletePriority(deletePrioritySchema.parse(args), database)
      ),
  },
]

/** By name, for `tools/call` dispatch. */
export const TOOLS_BY_NAME: ReadonlyMap<string, McpToolEntry> = new Map(
  INVENTORY.map((entry) => [entry.name, entry])
)

/**
 * What the user is asked to confirm, in words.
 *
 * The EVE approval prompt renders the raw tool input next to the model's own
 * prose, and `agent/instructions.md` makes the model name the affected items in
 * that prose before calling (US-F5.2). An MCP client has no such second half:
 * the elicitation message is the only thing the human reads, and a prompt whose
 * entire content is `{"taskIds":["8f3c…","b21e…"]}` is not a confirmation of
 * anything. So this module reads the affected rows back and states the change
 * the way the user would say it.
 *
 * Two constraints it holds to:
 *
 * - **Reads only, through the shared actions.** No SQL, no new query, and no
 *   judgement about whether the operation is allowed — the action layer decides
 *   that after the user answers, and its refusal message is the one they see.
 *   Where a count appears ("4 tasks are using it") it is context for the human,
 *   not a rule being pre-checked.
 * - **Never fails the call.** Any read that throws, or an entity that has since
 *   been deleted, degrades to the ids. A gate that cannot describe itself must
 *   still gate.
 *
 * `delete_status` and `delete_priority` cost one query per project to resolve a
 * name, because their schemas carry no `projectId` and `listStatuses` needs
 * one. That is the price of not adding a lookup-by-id the action layer chose
 * not to expose; it is paid once, on an interactive confirmation path, in an
 * app whose whole domain is a handful of projects.
 */

import {
  getTask,
  listPriorities,
  listProjects,
  listStatuses,
  listTasks,
} from "../lib/actions/index.ts"
import type { Database } from "../lib/db/client.ts"
import type {
  BulkDeleteTasksInput,
  BulkUpdateTasksInput,
  DeletePriorityInput,
  DeleteProjectInput,
  DeleteStatusInput,
  DeleteTaskInput,
  UpdateTaskInput,
} from "../lib/schemas/index.ts"

/** How many titles a bulk confirmation spells out before summarising. */
const NAMED_LIMIT = 10

const quote = (value: string) => `"${value}"`

/** "1 task" / "3 tasks" — the message reads as prose, so it has to agree. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/** `["a", "b", "c"]` → `a, b and c`. */
function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/** The titles of up to NAMED_LIMIT tasks, followed by "and N more". */
async function namedTasks(
  taskIds: readonly string[],
  database?: Database
): Promise<string> {
  const shown = taskIds.slice(0, NAMED_LIMIT)
  const titles: string[] = []

  // Sequential, not Promise.all: `database` may be a transaction, and a
  // transaction is one connection. Ten reads on a confirmation path is not a
  // latency problem worth risking connection contention for.
  for (const taskId of shown) {
    titles.push(quote((await getTask({ taskId }, database)).title))
  }

  const rest = taskIds.length - shown.length

  return rest > 0
    ? `${titles.join(", ")} and ${count(rest, "other")}`
    : list(titles)
}

type Named = { name: string; projectId: string; projectName: string }

/** Finds a status by id across every project. See the file comment. */
async function findStatus(
  statusId: string,
  database?: Database
): Promise<Named | null> {
  for (const project of await listProjects({}, database)) {
    const statuses = await listStatuses({ projectId: project.id }, database)
    const match = statuses.find((status) => status.id === statusId)

    if (match) {
      return {
        name: match.name,
        projectId: project.id,
        projectName: project.name,
      }
    }
  }

  return null
}

/** Finds a priority by id across every project. See the file comment. */
async function findPriority(
  priorityId: string,
  database?: Database
): Promise<Named | null> {
  for (const project of await listProjects({}, database)) {
    const priorities = await listPriorities({ projectId: project.id }, database)
    const match = priorities.find((priority) => priority.id === priorityId)

    if (match) {
      return {
        name: match.name,
        projectId: project.id,
        projectName: project.name,
      }
    }
  }

  return null
}

/** How many tasks a project holds, completed ones included. */
async function projectTaskCount(
  projectId: string,
  database?: Database
): Promise<number> {
  const tasks = await listTasks({ projectId, includeCompleted: true }, database)
  return tasks.length
}

/** How many of a project's tasks currently sit on one status or priority. */
async function usageCount(
  projectId: string,
  filter: { statusId: string } | { priorityId: string },
  database?: Database
): Promise<number> {
  const tasks = await listTasks(
    { projectId, includeCompleted: true, ...filter },
    database
  )
  return tasks.length
}

async function describeDeleteProject(
  input: DeleteProjectInput,
  database?: Database
): Promise<string> {
  const projects = await listProjects({}, database)
  const project = projects.find((candidate) => candidate.id === input.projectId)

  if (!project) return `Delete the project ${input.projectId}.`

  const tasks = await projectTaskCount(project.id, database)

  return (
    `Delete the project ${quote(project.name)}, with its statuses and ` +
    `priorities. It currently holds ` +
    `${tasks === 0 ? "no tasks" : count(tasks, "task")}.`
  )
}

async function describeDeleteTask(
  input: DeleteTaskInput,
  database?: Database
): Promise<string> {
  const task = await getTask({ taskId: input.taskId }, database)

  return `Delete the task ${quote(task.title)} in ${quote(task.project.name)}.`
}

async function describeDeleteStatus(
  input: DeleteStatusInput,
  database?: Database
): Promise<string> {
  const found = await findStatus(input.statusId, database)

  if (!found) return `Delete the status ${input.statusId}.`

  const inUse = await usageCount(
    found.projectId,
    { statusId: input.statusId },
    database
  )

  return (
    `Delete the status ${quote(found.name)} from the project ` +
    `${quote(found.projectName)}. ${count(inUse, "task")} ` +
    `${inUse === 1 ? "is" : "are"} currently on it.`
  )
}

async function describeDeletePriority(
  input: DeletePriorityInput,
  database?: Database
): Promise<string> {
  const found = await findPriority(input.priorityId, database)

  if (!found) return `Delete the priority ${input.priorityId}.`

  const inUse = await usageCount(
    found.projectId,
    { priorityId: input.priorityId },
    database
  )

  return (
    `Delete the priority ${quote(found.name)} from the project ` +
    `${quote(found.projectName)}. ${count(inUse, "task")} ` +
    `${inUse === 1 ? "is" : "are"} currently on it.`
  )
}

/** "move them to the status "Done"" / "set their priority to "High"". */
async function describeMove(
  input: { statusId?: string; priorityId?: string },
  database?: Database
): Promise<string[]> {
  const clauses: string[] = []

  if (input.statusId !== undefined) {
    const status = await findStatus(input.statusId, database)
    clauses.push(
      `move to the status ${status ? quote(status.name) : input.statusId}`
    )
  }

  if (input.priorityId !== undefined) {
    const priority = await findPriority(input.priorityId, database)
    clauses.push(
      `set the priority to ${
        priority ? quote(priority.name) : input.priorityId
      }`
    )
  }

  return clauses
}

async function describeBulkUpdate(
  input: BulkUpdateTasksInput,
  database?: Database
): Promise<string> {
  const changes = await describeMove(input, database)
  const named = await namedTasks(input.taskIds, database)

  return (
    `Across ${count(input.taskIds.length, "task")} — ${named} — ` +
    `${list(changes)}. All of them change, or none do.`
  )
}

async function describeBulkDelete(
  input: BulkDeleteTasksInput,
  database?: Database
): Promise<string> {
  const named = await namedTasks(input.taskIds, database)

  return (
    `Delete ${count(input.taskIds.length, "task")}: ${named}. ` +
    `All of them go, or none do.`
  )
}

/**
 * The second task edited in one session (`mcp/guard.ts`). The message says why
 * it is being asked, since the same tool ran without a prompt a moment ago.
 */
async function describeUpdateTask(
  input: UpdateTaskInput,
  database?: Database
): Promise<string> {
  const task = await getTask({ taskId: input.taskId }, database)
  const changes = await describeMove(input, database)

  if (input.title !== undefined)
    changes.unshift(`retitle to ${quote(input.title)}`)
  if (input.description !== undefined) {
    changes.push(
      input.description === null
        ? "clear the description"
        : "replace the description"
    )
  }

  return (
    `Edit a second task in this session — ${quote(task.title)} in ` +
    `${quote(task.project.name)}: ${list(changes)}. Changing more than one ` +
    `task is a bulk change, so it needs confirming; bulk_update_tasks does it ` +
    `atomically with one confirmation.`
  )
}

/** The fallback when a read fails: honest, and still names the tool. */
function describeById(name: string, input: unknown): string {
  return `Run ${name} with ${JSON.stringify(input)}.`
}

/**
 * A sentence describing what the call will do, for the user to confirm.
 *
 * `input` must already have been parsed by the tool's shared schema, so the
 * casts below are the parse's guarantee rather than an assumption.
 */
export async function describeCall(
  name: string,
  input: unknown,
  database?: Database
): Promise<string> {
  try {
    switch (name) {
      case "delete_project":
        return await describeDeleteProject(
          input as DeleteProjectInput,
          database
        )
      case "delete_task":
        return await describeDeleteTask(input as DeleteTaskInput, database)
      case "delete_status":
        return await describeDeleteStatus(input as DeleteStatusInput, database)
      case "delete_priority":
        return await describeDeletePriority(
          input as DeletePriorityInput,
          database
        )
      case "bulk_update_tasks":
        return await describeBulkUpdate(input as BulkUpdateTasksInput, database)
      case "bulk_delete_tasks":
        return await describeBulkDelete(input as BulkDeleteTasksInput, database)
      case "update_task":
        return await describeUpdateTask(input as UpdateTaskInput, database)
      default:
        return describeById(name, input)
    }
  } catch {
    // A missing row, or a database that went away mid-confirmation. The gate
    // still has to gate, so fall back to the raw request.
    return describeById(name, input)
  }
}

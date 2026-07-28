/**
 * The task capabilities of product spec §5, and the only place their rules
 * live. See lib/actions/projects.ts for the house rules that apply to every
 * action in this directory.
 *
 * Two §7 rules are enforced here and nowhere else:
 *
 * - **Rule 1, project immutability.** Enforced structurally: `updateTaskSchema`
 *   has no `projectId` field and `updateTask` builds its patch from an explicit
 *   whitelist, so there is no "reject a project change" branch to forget.
 * - **Rule 2, scoped references.** `requireStatusInProject` /
 *   `requirePriorityInProject` reject a status or priority belonging to any
 *   other project, on create and on update alike (US-B1.5, US-B4.3).
 */

import { and, asc, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm"

import { db, type Database } from "../db/client.ts"
import {
  priorities,
  projects,
  statuses,
  tasks,
  type Priority,
  type Status,
} from "../db/schema.ts"
import { NotFoundError, RuleViolation } from "../domain/errors.ts"
import {
  bulkDeleteTasksSchema,
  bulkUpdateTasksSchema,
  createTaskSchema,
  deleteTaskSchema,
  getTaskSchema,
  listTasksSchema,
  updateTaskSchema,
  type BulkDeleteTasksInput,
  type BulkUpdateTasksInput,
  type CreateTaskInput,
  type DeleteTaskInput,
  type GetTaskInput,
  type ListTasksInput,
  type UpdateTaskInput,
} from "../schemas/tasks.ts"

/**
 * What every task read and write returns.
 *
 * Both front doors need the related names on every render — the UI shows
 * project/status/priority as chips (§8.1) and the agent must be able to say
 * "Created task 'Fix header' in Website" without a follow-up lookup (US-F6.2).
 * Producing the join once in the shared layer is cheaper than two clients each
 * re-deriving it, and the nested shape maps directly onto both the chip
 * components and the Phase 2 JSON response.
 */
export type TaskView = {
  id: string
  title: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  project: { id: string; name: string }
  status: { id: string; name: string; order: number; isCompleted: boolean }
  priority: { id: string; name: string; order: number; isDefault: boolean }
}

/**
 * A hand-written join rather than `database.query.*`, because the canonical
 * ordering and the completed-hiding filter both reference joined columns.
 */
function taskViewQuery(database: Database) {
  return database
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      project: { id: projects.id, name: projects.name },
      status: {
        id: statuses.id,
        name: statuses.name,
        order: statuses.order,
        isCompleted: statuses.isCompleted,
      },
      priority: {
        id: priorities.id,
        name: priorities.name,
        order: priorities.order,
        isDefault: priorities.isDefault,
      },
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(statuses, eq(tasks.statusId, statuses.id))
    .innerJoin(priorities, eq(tasks.priorityId, priorities.id))
}

/**
 * The canonical ordering, applied unconditionally: completed statuses sink to
 * the bottom, then highest priority first, then oldest first (§8.1, US-B2.2,
 * US-B2.4).
 *
 * Product spec §8.1 frames this as UI experience, but parity (§5, §6) requires
 * the agent's list and the UI's list to agree, so it lives in the one shared
 * layer rather than being implemented twice. `priorities.order` ascending is
 * ascending urgency (Low=0 < Medium=1 < High=2), so "highest first" is DESC.
 *
 * `asc(tasks.id)` is the final tie-break and is load-bearing, not cosmetic.
 * `tasks.created_at` defaults to `now()`, which Postgres evaluates as
 * `transaction_timestamp()` — constant for a whole transaction. Any tasks
 * created in one transaction therefore share a `created_at` and, without a
 * further key, sort in whatever order the planner happens to produce. That is
 * a parity bug before it is a test-flake bug: the UI and the agent could list
 * the same tasks in different orders (§5, §6).
 */
const TASK_ORDER = [
  asc(statuses.isCompleted),
  desc(priorities.order),
  asc(tasks.createdAt),
  asc(tasks.id),
] as const

/** Reads back one task in TaskView shape, or raises NotFoundError. */
async function readTask(database: Database, taskId: string): Promise<TaskView> {
  const [view] = await taskViewQuery(database).where(eq(tasks.id, taskId))

  if (!view) {
    throw new NotFoundError(`No task with id ${taskId}.`)
  }

  return view
}

/** Product spec §7 rule 2 / US-B1.5 / US-B4.3, for statuses. */
async function requireStatusInProject(
  database: Database,
  statusId: string,
  projectId: string,
  projectName: string
): Promise<Status> {
  const [status] = await database
    .select()
    .from(statuses)
    .where(eq(statuses.id, statusId))
    .limit(1)

  if (!status) {
    throw new NotFoundError(`No status with id ${statusId}.`)
  }

  if (status.projectId !== projectId) {
    throw new RuleViolation(
      `Status '${status.name}' belongs to a different project. A task in ` +
        `'${projectName}' can only use that project's own statuses.`
    )
  }

  return status
}

/** Product spec §7 rule 2 / US-B1.5 / US-B4.3, for priorities. */
async function requirePriorityInProject(
  database: Database,
  priorityId: string,
  projectId: string,
  projectName: string
): Promise<Priority> {
  const [priority] = await database
    .select()
    .from(priorities)
    .where(eq(priorities.id, priorityId))
    .limit(1)

  if (!priority) {
    throw new NotFoundError(`No priority with id ${priorityId}.`)
  }

  if (priority.projectId !== projectId) {
    throw new RuleViolation(
      `Priority '${priority.name}' belongs to a different project. A task in ` +
        `'${projectName}' can only use that project's own priorities.`
    )
  }

  return priority
}

/** Empty and whitespace-only descriptions are stored as NULL, not as "". */
function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === "" ? null : value
}

/**
 * Lists tasks, applying every provided filter (US-B3.1) and the canonical
 * ordering.
 *
 * Completed tasks are hidden by default (US-B2.3). An explicit `statusId`
 * filter wins over `includeCompleted`: someone filtering to "Done" plainly
 * wants to see Done tasks.
 */
export async function listTasks(
  input: ListTasksInput = {},
  database: Database = db
): Promise<TaskView[]> {
  const parsed = listTasksSchema.parse(input)

  const conditions: SQL[] = []

  if (parsed.projectId) conditions.push(eq(tasks.projectId, parsed.projectId))
  if (parsed.statusId) conditions.push(eq(tasks.statusId, parsed.statusId))
  if (parsed.priorityId) {
    conditions.push(eq(tasks.priorityId, parsed.priorityId))
  }

  if (parsed.search) {
    // Drizzle parameterizes both patterns, so there is no injection surface.
    const pattern = `%${parsed.search}%`
    const match = or(
      ilike(tasks.title, pattern),
      ilike(tasks.description, pattern)
    )
    if (match) conditions.push(match)
  }

  if (!parsed.statusId && parsed.includeCompleted !== true) {
    conditions.push(eq(statuses.isCompleted, false))
  }

  return taskViewQuery(database)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...TASK_ORDER)
}

/** Views one task and all of its fields, including its full description. */
export async function getTask(
  input: GetTaskInput,
  database: Database = db
): Promise<TaskView> {
  const parsed = getTaskSchema.parse(input)

  return readTask(database, parsed.taskId)
}

/**
 * Creates a task. Omitted status takes the project's first status by order and
 * omitted priority takes the project's default priority (§4.4, US-B1.3,
 * US-B1.4) — which is what makes "a task can be created in a brand-new project
 * with zero extra setup" true (US-C1.3, US-A1.4).
 */
export async function createTask(
  input: CreateTaskInput,
  database: Database = db
): Promise<TaskView> {
  const parsed = createTaskSchema.parse(input)

  return database.transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1)

    if (!project) {
      throw new NotFoundError(`No project with id ${parsed.projectId}.`)
    }

    let statusId = parsed.statusId

    if (statusId) {
      await requireStatusInProject(tx, statusId, project.id, project.name)
    } else {
      const [first] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.projectId, project.id))
        .orderBy(asc(statuses.order))
        .limit(1)

      if (!first) {
        throw new RuleViolation(
          `Project '${project.name}' has no statuses, so a task cannot be ` +
            `created in it. Create a status first.`
        )
      }

      statusId = first.id
    }

    let priorityId = parsed.priorityId

    if (priorityId) {
      await requirePriorityInProject(tx, priorityId, project.id, project.name)
    } else {
      const projectPriorities = await tx
        .select({ id: priorities.id, isDefault: priorities.isDefault })
        .from(priorities)
        .where(eq(priorities.projectId, project.id))
        .orderBy(asc(priorities.order))

      // First-by-order is a defensive fallback: the exactly-one-default
      // invariant maintained by lib/actions/priorities.ts should make the
      // `?? projectPriorities[0]` branch unreachable.
      const chosen =
        projectPriorities.find((candidate) => candidate.isDefault) ??
        projectPriorities[0]

      if (!chosen) {
        throw new RuleViolation(
          `Project '${project.name}' has no priorities, so a task cannot be ` +
            `created in it. Create a priority first.`
        )
      }

      priorityId = chosen.id
    }

    const [created] = await tx
      .insert(tasks)
      .values({
        projectId: project.id,
        title: parsed.title,
        description: normalizeDescription(parsed.description),
        statusId,
        priorityId,
      })
      .returning({ id: tasks.id })

    if (!created) {
      throw new Error("createTask: the task insert returned no row.")
    }

    return readTask(tx, created.id)
  })
}

/**
 * Edits a task's title, description, status and/or priority — which covers
 * moving a task's status as a first-class action (US-B4, US-B5).
 *
 * There is no `projectId` branch because the input type has no such field:
 * that is product spec §7 rule 1. Status and priority are scope-checked
 * against the task's own, unchanged project.
 */
export async function updateTask(
  input: UpdateTaskInput,
  database: Database = db
): Promise<TaskView> {
  const parsed = updateTaskSchema.parse(input)

  return database.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, parsed.taskId))
      .limit(1)

    if (!task) {
      throw new NotFoundError(`No task with id ${parsed.taskId}.`)
    }

    const [project] = await tx
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1)

    const projectName = project?.name ?? "this project"

    if (parsed.statusId !== undefined) {
      await requireStatusInProject(
        tx,
        parsed.statusId,
        task.projectId,
        projectName
      )
    }

    if (parsed.priorityId !== undefined) {
      await requirePriorityInProject(
        tx,
        parsed.priorityId,
        task.projectId,
        projectName
      )
    }

    await tx
      .update(tasks)
      .set({
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined
          ? { description: normalizeDescription(parsed.description) }
          : {}),
        ...(parsed.statusId !== undefined ? { statusId: parsed.statusId } : {}),
        ...(parsed.priorityId !== undefined
          ? { priorityId: parsed.priorityId }
          : {}),
      })
      .where(eq(tasks.id, task.id))

    return readTask(tx, task.id)
  })
}

/** Deletes one task. */
export async function deleteTask(
  input: DeleteTaskInput,
  database: Database = db
): Promise<{ id: string; title: string }> {
  const parsed = deleteTaskSchema.parse(input)

  return database.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(tasks)
      .where(eq(tasks.id, parsed.taskId))
      .returning({ id: tasks.id, title: tasks.title })

    if (!deleted) {
      throw new NotFoundError(`No task with id ${parsed.taskId}.`)
    }

    return deleted
  })
}

/**
 * Applies one status and/or priority across several tasks, all or nothing.
 *
 * Both bulk capabilities sit behind an EVE approval gate (plan §2.4) whose
 * prompt renders the exact input, and US-F5.3 promises that on approval all
 * stated changes are applied and on decline nothing changes. A partially
 * applied batch would leave the system in a state the agent never described,
 * so a missing id or a scoping violation aborts the whole batch before
 * anything is written. Scope is checked against every distinct project in the
 * set, so one status id spread across two projects is correctly refused.
 */
export async function bulkUpdateTasks(
  input: BulkUpdateTasksInput,
  database: Database = db
): Promise<TaskView[]> {
  const parsed = bulkUpdateTasksSchema.parse(input)
  const taskIds = [...new Set(parsed.taskIds)]

  return database.transaction(async (tx) => {
    const found = await tx
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(inArray(tasks.id, taskIds))

    const foundIds = new Set(found.map((task) => task.id))
    const missing = taskIds.filter((id) => !foundIds.has(id))

    if (missing.length > 0) {
      throw new NotFoundError(`No task with id ${missing.join(", ")}.`)
    }

    for (const projectId of new Set(found.map((task) => task.projectId))) {
      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      const projectName = project?.name ?? "this project"

      if (parsed.statusId !== undefined) {
        await requireStatusInProject(
          tx,
          parsed.statusId,
          projectId,
          projectName
        )
      }

      if (parsed.priorityId !== undefined) {
        await requirePriorityInProject(
          tx,
          parsed.priorityId,
          projectId,
          projectName
        )
      }
    }

    await tx
      .update(tasks)
      .set({
        ...(parsed.statusId !== undefined ? { statusId: parsed.statusId } : {}),
        ...(parsed.priorityId !== undefined
          ? { priorityId: parsed.priorityId }
          : {}),
      })
      .where(inArray(tasks.id, taskIds))

    return taskViewQuery(tx)
      .where(inArray(tasks.id, taskIds))
      .orderBy(...TASK_ORDER)
  })
}

/** Deletes several tasks, all or nothing — see bulkUpdateTasks for why. */
export async function bulkDeleteTasks(
  input: BulkDeleteTasksInput,
  database: Database = db
): Promise<{ id: string; title: string }[]> {
  const parsed = bulkDeleteTasksSchema.parse(input)
  const taskIds = [...new Set(parsed.taskIds)]

  return database.transaction(async (tx) => {
    const found = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, taskIds))

    const foundIds = new Set(found.map((task) => task.id))
    const missing = taskIds.filter((id) => !foundIds.has(id))

    if (missing.length > 0) {
      throw new NotFoundError(`No task with id ${missing.join(", ")}.`)
    }

    return tx
      .delete(tasks)
      .where(inArray(tasks.id, taskIds))
      .returning({ id: tasks.id, title: tasks.title })
  })
}

/**
 * The per-project priority capabilities of product spec §5, and the only place
 * their rules live. See lib/actions/projects.ts for the house rules that apply
 * to every action in this directory.
 *
 * Deliberately parallel to lib/actions/statuses.ts rather than factored into a
 * shared generic guard: the two diverge semantically — deletePriority has a
 * default-reassignment step deleteStatus does not, and the user-facing wording
 * differs — so a shared helper would need a growing set of hooks and flags to
 * stay correct across two short functions.
 *
 * Order runs Low → High: ascending `order` is ascending urgency, which is what
 * product spec §4.3's own example ("e.g., Low → High") describes and what
 * lib/domain/defaults.ts encodes. "Highest priority first" is therefore
 * ORDER BY order DESC, which lib/actions/tasks.ts relies on.
 */

import { and, asc, count, eq, max, sql } from "drizzle-orm"

import { db, type Database } from "../db/client.ts"
import { priorities, projects, tasks, type Priority } from "../db/schema.ts"
import { NotFoundError, RuleViolation } from "../domain/errors.ts"
import { reindexAfterMove, renumber } from "../domain/reorder.ts"
import {
  createPrioritySchema,
  deletePrioritySchema,
  listPrioritiesSchema,
  updatePrioritySchema,
  type CreatePriorityInput,
  type DeletePriorityInput,
  type ListPrioritiesInput,
  type UpdatePriorityInput,
} from "../schemas/priorities.ts"

/** Loads a priority or raises NotFoundError. */
async function requirePriority(
  database: Database,
  priorityId: string
): Promise<Priority> {
  const [priority] = await database
    .select()
    .from(priorities)
    .where(eq(priorities.id, priorityId))
    .limit(1)

  if (!priority) {
    throw new NotFoundError(`No priority with id ${priorityId}.`)
  }

  return priority
}

/** Writes back only the rows whose order actually changed. */
async function applyOrder(
  database: Database,
  assignments: { id: string; order: number }[],
  current: readonly { id: string; order: number }[]
): Promise<void> {
  const before = new Map(current.map((row) => [row.id, row.order]))

  for (const assignment of assignments) {
    if (before.get(assignment.id) === assignment.order) continue

    await database
      .update(priorities)
      .set({ order: assignment.order })
      .where(eq(priorities.id, assignment.id))
  }
}

/** Lists a project's priorities in their defined order (US-E1.1/E1.2). */
export async function listPriorities(
  input: ListPrioritiesInput,
  database: Database = db
): Promise<Priority[]> {
  const parsed = listPrioritiesSchema.parse(input)

  return database
    .select()
    .from(priorities)
    .where(eq(priorities.projectId, parsed.projectId))
    .orderBy(asc(priorities.order))
}

/**
 * Creates a priority, appended to the end of the project's list.
 *
 * It is never the default: the schema has no `isDefault` field, so the only
 * way to designate one is updatePriority, and the project's existing default
 * is left untouched (§4.3's "exactly one" holds by construction).
 */
export async function createPriority(
  input: CreatePriorityInput,
  database: Database = db
): Promise<Priority> {
  const parsed = createPrioritySchema.parse(input)

  return database.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, parsed.projectId))
      .limit(1)

    if (!project) {
      throw new NotFoundError(`No project with id ${parsed.projectId}.`)
    }

    const [highest] = await tx
      .select({ value: max(priorities.order) })
      .from(priorities)
      .where(eq(priorities.projectId, parsed.projectId))

    const [priority] = await tx
      .insert(priorities)
      .values({
        projectId: parsed.projectId,
        name: parsed.name,
        order: (highest?.value ?? -1) + 1,
        isDefault: false,
      })
      .returning()

    if (!priority) {
      throw new Error("createPriority: the priority insert returned no row.")
    }

    return priority
  })
}

/**
 * Renames a priority, moves it to a new position, and/or designates it the
 * project's default (US-E1.2, US-E1.3).
 *
 * The default flip is one UPDATE across the whole project setting
 * `is_default = (id = target)`, so no reader ever observes an intermediate
 * state with zero or two defaults and there is no read-then-write race window.
 */
export async function updatePriority(
  input: UpdatePriorityInput,
  database: Database = db
): Promise<Priority> {
  const parsed = updatePrioritySchema.parse(input)

  return database.transaction(async (tx) => {
    const priority = await requirePriority(tx, parsed.priorityId)

    if (parsed.name !== undefined) {
      await tx
        .update(priorities)
        .set({ name: parsed.name })
        .where(eq(priorities.id, priority.id))
    }

    if (parsed.isDefault !== undefined) {
      await tx
        .update(priorities)
        .set({ isDefault: sql`${priorities.id} = ${priority.id}::uuid` })
        .where(eq(priorities.projectId, priority.projectId))
    }

    if (parsed.order !== undefined) {
      const siblings = await tx
        .select({ id: priorities.id, order: priorities.order })
        .from(priorities)
        .where(eq(priorities.projectId, priority.projectId))
        .orderBy(asc(priorities.order))

      await applyOrder(
        tx,
        reindexAfterMove(siblings, priority.id, parsed.order),
        siblings
      )
    }

    return requirePriority(tx, priority.id)
  })
}

/**
 * Deletes a priority, subject to §7.5 (minimum one per project) and §7.3 (not
 * while any task uses it), in that order — see lib/actions/statuses.ts for why
 * last-remaining is checked first.
 *
 * When the deleted priority was the project's default, the designation moves
 * to the survivor that now holds order 0 (§4.3, US-E2.4), inside the same
 * transaction, so "exactly one default" is never observably false.
 */
export async function deletePriority(
  input: DeletePriorityInput,
  database: Database = db
): Promise<{ id: string; name: string }> {
  const parsed = deletePrioritySchema.parse(input)

  return database.transaction(async (tx) => {
    const priority = await requirePriority(tx, parsed.priorityId)

    const siblings = await tx
      .select({ id: priorities.id, order: priorities.order })
      .from(priorities)
      .where(eq(priorities.projectId, priority.projectId))
      .orderBy(asc(priorities.order))

    // §7.5 / US-E2.3 first: unconditional, and never leaves the user with a
    // remedy they cannot act on.
    if (siblings.length <= 1) {
      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, priority.projectId))
        .limit(1)

      throw new RuleViolation(
        `'${priority.name}' is the only priority in ` +
          `'${project?.name ?? "this project"}'. Every project must keep at ` +
          `least one priority, so it cannot be deleted. Create another ` +
          `priority first.`
      )
    }

    // §7.3 / US-E2.2: state what is blocking and what to do about it.
    const [inUse] = await tx
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.priorityId, priority.id),
          eq(tasks.projectId, priority.projectId)
        )
      )

    const using = inUse?.value ?? 0

    if (using > 0) {
      throw new RuleViolation(
        `Priority '${priority.name}' is used by ${using} ` +
          `task${using === 1 ? "" : "s"}. Move those tasks to another ` +
          `priority (or delete them) first, then delete the priority.`
      )
    }

    await tx.delete(priorities).where(eq(priorities.id, priority.id))

    const survivors = siblings.filter((sibling) => sibling.id !== priority.id)
    const assignments = renumber(survivors)
    await applyOrder(tx, assignments, survivors)

    if (priority.isDefault) {
      const first = assignments.find((assignment) => assignment.order === 0)

      if (first) {
        await tx
          .update(priorities)
          .set({ isDefault: true })
          .where(eq(priorities.id, first.id))
      }
    }

    return { id: priority.id, name: priority.name }
  })
}

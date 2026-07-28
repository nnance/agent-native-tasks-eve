/**
 * Verification harness: trigger every product-spec §7 rule against the real
 * test database and print the ACTUAL error type and message each one produces,
 * so the packet quotes the system rather than the source code.
 *
 * Everything runs inside `withRollback`, so the database is left untouched.
 *
 * Run from the repo root:
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-1/harness/rule-messages.ts
 */
import {
  createPriority,
  createProject,
  createTask,
  deletePriority,
  deleteProject,
  deleteStatus,
  deleteTask,
  getTask,
  listPriorities,
  listStatuses,
  updatePriority,
  updateTask,
} from "../../../../lib/actions/index.ts"
import { eq } from "drizzle-orm"

import type { Database } from "../../../../lib/db/connect.ts"
import { tasks } from "../../../../lib/db/schema.ts"
import { NotFoundError, RuleViolation } from "../../../../lib/domain/errors.ts"
import { withRollback } from "../../../../tests/support/db.ts"

let failures = 0

/** Runs `attempt`, expecting it to throw, and reports what came back. */
async function expectBlocked(label: string, attempt: () => Promise<unknown>) {
  try {
    await attempt()
    console.log(`\n${label}\n  !! NOT BLOCKED — the operation succeeded. FAIL.`)
    failures += 1
  } catch (error) {
    const kind =
      error instanceof RuleViolation
        ? "RuleViolation"
        : error instanceof NotFoundError
          ? "NotFoundError"
          : (error as Error).name
    const message =
      kind === "ZodError"
        ? JSON.stringify(
            JSON.parse((error as Error).message).map(
              (issue: { code: string; message: string; path: string[] }) => ({
                code: issue.code,
                path: issue.path,
                message: issue.message,
              })
            )
          )
        : (error as Error).message
    console.log(`\n${label}\n  ${kind}: ${message}`)
  }
}

await withRollback(async (tx: Database) => {
  const main = await createProject({ name: "Design" }, tx)
  const other = await createProject({ name: "Website" }, tx)

  const mainStatuses = await listStatuses({ projectId: main.id }, tx)
  const mainPriorities = await listPriorities({ projectId: main.id }, tx)
  const otherStatuses = await listStatuses({ projectId: other.id }, tx)
  const otherPriorities = await listPriorities({ projectId: other.id }, tx)

  console.log("fixtures: project 'Design' with")
  console.log(
    "  statuses  ->",
    mainStatuses.map((s) => `${s.order}:${s.name}${s.isCompleted ? "*" : ""}`)
  )
  console.log(
    "  priorities->",
    mainPriorities.map((p) => `${p.order}:${p.name}${p.isDefault ? "*" : ""}`)
  )
  console.log("plus a second project 'Website' for the scoping checks.")

  console.log("\n================ §7.1 Project immutability ================")
  const task = await createTask({ projectId: main.id, title: "Fix header" }, tx)
  await expectBlocked(
    "updateTask({ taskId, projectId: <Website> }) — moving a task between projects",
    () =>
      updateTask(
        { taskId: task.id, projectId: other.id } as never,
        tx
      )
  )
  const stillThere = await getTask({ taskId: task.id }, tx)
  // Read the raw column too, not just the joined view, so the assertion is
  // about what Postgres stores rather than what the action re-derives.
  const [stored] = await tx
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, task.id))
  console.log(
    `  task's stored project_id after the rejected attempt -> ` +
      (stored?.projectId === main.id
        ? `unchanged (still '${stillThere.project.name}')`
        : "CHANGED — FAIL")
  )
  if (stored?.projectId !== main.id) failures += 1

  console.log("\n================ §7.2 Scoped references ==================")
  await expectBlocked(
    "createTask with a status belonging to another project",
    () =>
      createTask(
        {
          projectId: main.id,
          title: "Wrong status",
          statusId: otherStatuses[0]!.id,
        },
        tx
      )
  )
  await expectBlocked(
    "updateTask with a priority belonging to another project",
    () =>
      updateTask({ taskId: task.id, priorityId: otherPriorities[0]!.id }, tx)
  )

  console.log("\n================ §7.3 Delete-if-unused ===================")
  await expectBlocked(
    "deleteProject on a project that still has tasks",
    () => deleteProject({ projectId: main.id }, tx)
  )
  await expectBlocked(
    `deleteStatus on '${stillThere.status.name}', a status a task is using`,
    () => deleteStatus({ statusId: stillThere.status.id }, tx)
  )
  await expectBlocked(
    `deletePriority on '${stillThere.priority.name}', a priority a task is using`,
    () => deletePriority({ priorityId: stillThere.priority.id }, tx)
  )

  console.log("\n================ §7.5 Minimum lists ======================")
  // Clear the task so only the last-remaining rule can be what blocks.
  await deleteTask({ taskId: task.id }, tx)
  const solo = await createProject({ name: "Solo" }, tx)
  const soloStatuses = await listStatuses({ projectId: solo.id }, tx)
  const soloPriorities = await listPriorities({ projectId: solo.id }, tx)
  for (const status of soloStatuses.slice(1)) {
    await deleteStatus({ statusId: status.id }, tx)
  }
  for (const priority of soloPriorities.slice(1)) {
    await deletePriority({ priorityId: priority.id }, tx)
  }
  console.log(
    "  'Solo' pared down to",
    (await listStatuses({ projectId: solo.id }, tx)).length,
    "status and",
    (await listPriorities({ projectId: solo.id }, tx)).length,
    "priority, both unused"
  )
  await expectBlocked(
    "deleteStatus on the project's last remaining status (unused)",
    async () =>
      deleteStatus(
        { statusId: (await listStatuses({ projectId: solo.id }, tx))[0]!.id },
        tx
      )
  )
  await expectBlocked(
    "deletePriority on the project's last remaining priority (unused)",
    async () =>
      deletePriority(
        {
          priorityId: (await listPriorities({ projectId: solo.id }, tx))[0]!.id,
        },
        tx
      )
  )

  console.log("\n===== §4.3 / US-E1.3 Exactly one default, always =========")
  await expectBlocked(
    "createPriority({ isDefault: true }) — the field does not exist on the schema",
    () =>
      createPriority(
        { projectId: main.id, name: "Urgent", isDefault: true } as never,
        tx
      )
  )
  await expectBlocked(
    "updatePriority({ isDefault: false }) — a default can never be un-set alone",
    () =>
      updatePriority(
        { priorityId: mainPriorities[1]!.id, isDefault: false } as never,
        tx
      )
  )
  await updatePriority({ priorityId: mainPriorities[2]!.id, isDefault: true }, tx)
  const afterMove = await listPriorities({ projectId: main.id }, tx)
  console.log(
    "\nafter moving the default to 'High':",
    afterMove.map((p) => `${p.name}${p.isDefault ? " (default)" : ""}`).join(", ")
  )
  const defaults = afterMove.filter((p) => p.isDefault).length
  console.log("  priorities flagged default ->", defaults, defaults === 1 ? "(exactly one)" : "FAIL")
  if (defaults !== 1) failures += 1

  console.log("\n===== US-E2.4 Deleting the default reassigns it ==========")
  const target = afterMove.find((p) => p.isDefault)!
  console.log(`deletePriority on the current default ('${target.name}') …`)
  await deletePriority({ priorityId: target.id }, tx)
  const afterDelete = await listPriorities({ projectId: main.id }, tx)
  console.log(
    "  surviving priorities ->",
    afterDelete
      .map((p) => `${p.order}:${p.name}${p.isDefault ? " (default)" : ""}`)
      .join(", ")
  )
  const reassigned = afterDelete.filter((p) => p.isDefault)
  console.log(
    "  default moved to the survivor at order 0 ->",
    reassigned.length === 1 && reassigned[0]!.order === 0 ? "yes" : "FAIL"
  )
  if (!(reassigned.length === 1 && reassigned[0]!.order === 0)) failures += 1

  console.log("\n===== §7.4 New projects are usable immediately ===========")
  const fresh = await createProject({ name: "Brand new" }, tx)
  const freshTask = await createTask(
    { projectId: fresh.id, title: "works with no setup" },
    tx
  )
  const freshStatuses = await listStatuses({ projectId: fresh.id }, tx)
  const freshPriorities = await listPriorities({ projectId: fresh.id }, tx)
  console.log(
    "  seeded statuses  ->",
    freshStatuses.map((s) => `${s.order}:${s.name}${s.isCompleted ? " (completed)" : ""}`).join(", ")
  )
  console.log(
    "  seeded priorities->",
    freshPriorities.map((p) => `${p.order}:${p.name}${p.isDefault ? " (default)" : ""}`).join(", ")
  )
  console.log(
    "  a task created with no status/priority took ->",
    `${freshTask.status.name} (first by order) / ${freshTask.priority.name} (the default)`
  )

  console.log("\n===== §7.6 Concurrent edits (last write wins) ============")
  console.log(
    "  NOT exercised in Phase 1. This rule is about two interfaces racing;\n" +
      "  there is only one interface (this layer) so far. The action layer takes\n" +
      "  no locks and holds no versions, which is the precondition, but the rule\n" +
      "  itself is an Epic G / US-G3 concern verified in Phase 6."
  )
})

console.log(`\n\nunexpected results: ${failures}`)
process.exit(failures === 0 ? 0 : 1)

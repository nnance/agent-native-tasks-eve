/**
 * Preconditions for the evals, written straight through the shared action
 * layer.
 *
 * Not a `.eval.ts` file, so `eve eval` never discovers it as a case.
 *
 * ## Where these rows land
 *
 * `lib/actions/*` default to `lib/db/client.ts`'s handle, which reads
 * `process.env.DATABASE_URL`. `scripts/eval.ts` sets that to the **test**
 * database on the `eve eval` child, and the eval runner and the target it
 * boots both inherit it — so fixtures and the agent under test are writing to
 * the same database *by construction*, rather than by two independent
 * resolutions that could disagree. (Which is also why nothing here calls
 * `resolveTestDbUrl()`: inside that child, `DATABASE_URL` already *is* the
 * test URL, and the guard's whole job is to refuse when the two are equal.)
 *
 * No HTTP. The agent's own tools call `lib/actions` directly too, so a round
 * trip through the Next app would exercise a layer the evals are not grading
 * and would require a second server to be running.
 *
 * ## Isolation, which is by construction rather than by reset
 *
 * `eve eval` runs discovered eval files **concurrently** (capped at 4 in
 * `evals.config.ts`), unlike the E2E suite's serial `--test-concurrency=1`.
 * So there is no per-eval database reset — one would wipe a sibling's world
 * mid-run. `scripts/eval.ts` resets once, before the runner starts, and from
 * there isolation is structural: every eval creates its own uniquely-named
 * project, and **every prompt names that project explicitly**, so an unscoped
 * `list_tasks` from a sibling eval can never change an assertion here.
 */

import {
  createProject,
  createTask,
  listPriorities,
  listStatuses,
} from "../../lib/actions/index.ts"
import type { TaskView } from "../../lib/actions/tasks.ts"
import type { Priority, Project, Status } from "../../lib/db/schema.ts"

/**
 * A collision-free, **letters-only** token.
 *
 * Letters-only is load-bearing, not tidiness: `grounded-counts.eval.ts` gates
 * on a specific digit appearing in the agent's reply, and a hex token sitting
 * inside a fixture title in that same reply is a false positive waiting to
 * happen. The digits are mapped up into `g`–`p` rather than stripped, so the
 * token keeps its full entropy.
 */
export function uniqueToken(): string {
  return crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 8)
    .replace(/\d/g, (digit) => String.fromCharCode(103 + Number(digit)))
}

/** `"Orchard qmbxfkzc"` — a name no sibling eval can collide with. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${uniqueToken()}`
}

/**
 * A fresh project with its seeded statuses and priorities read back.
 *
 * Read back rather than echoed: `createProject` returns the project row only,
 * deliberately, so the defaults linkage is provable against the database.
 */
export async function evalProject(prefix: string): Promise<{
  project: Project
  statuses: Status[]
  priorities: Priority[]
}> {
  const project = await createProject({ name: uniqueName(prefix) })

  const [statuses, priorities] = await Promise.all([
    listStatuses({ projectId: project.id }),
    listPriorities({ projectId: project.id }),
  ])

  return { project, statuses, priorities }
}

/** One task in a project, taking the project's default status and priority. */
export async function evalTask(
  projectId: string,
  title: string,
  options: { statusId?: string } = {}
): Promise<TaskView> {
  return createTask({
    projectId,
    title,
    ...(options.statusId === undefined ? {} : { statusId: options.statusId }),
  })
}

export type { Priority, Project, Status, TaskView }

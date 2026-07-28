/**
 * Makes the nested `[projectId]` URL segment load-bearing.
 *
 * `updateStatusSchema` and friends carry no `projectId`, so without this a
 * PATCH to /api/projects/<any-project>/statuses/<id> would quietly succeed and
 * the nested REST shape the plan mandates would be a lie — one that Phase 3's
 * UI would then be built on top of.
 *
 * This is **address resolution** ("is this id reachable at this address"), not
 * a second enforcement of product-spec §7 rule 2 ("a task's status must belong
 * to the task's project"), which is a different question answered in
 * lib/actions/tasks.ts. What keeps it on the right side of that line is that it
 * is implemented in terms of the existing read actions rather than raw SQL: the
 * route layer still touches no database.
 *
 * A GET on the *collection* deliberately does not 404 for an unknown project —
 * listStatuses/listPriorities report absence as emptiness by design, and
 * inventing a project-existence probe here would add a read the action layer
 * chose not to do. POST to the same collection does 404, because
 * createStatus/createPriority already raise NotFoundError themselves.
 */

import { listPriorities, listStatuses } from "../actions/index.ts"
import { NotFoundError } from "../domain/errors.ts"

/**
 * `listStatuses` parses `projectId` itself, so a malformed project segment
 * surfaces as a ZodError (400) before this check can 404.
 */
export async function requireStatusInProject(
  projectId: string,
  statusId: string
): Promise<void> {
  const statuses = await listStatuses({ projectId })

  if (!statuses.some((status) => status.id === statusId)) {
    throw new NotFoundError(
      `No status with id ${statusId} in project ${projectId}.`
    )
  }
}

export async function requirePriorityInProject(
  projectId: string,
  priorityId: string
): Promise<void> {
  const priorities = await listPriorities({ projectId })

  if (!priorities.some((priority) => priority.id === priorityId)) {
    throw new NotFoundError(
      `No priority with id ${priorityId} in project ${projectId}.`
    )
  }
}

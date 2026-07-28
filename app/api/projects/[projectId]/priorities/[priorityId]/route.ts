import { deletePriority, updatePriority } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { requirePriorityInProject } from "@/lib/api/scope"
import { deletePrioritySchema, updatePrioritySchema } from "@/lib/schemas"

/**
 * One priority (implementation plan §2.3).
 *
 * PATCH is the single consolidated endpoint for rename / reorder /
 * set-default. `isDefault` is `z.literal(true)` in the shared schema, so
 * "make zero priorities default" is inexpressible through this front door for
 * exactly the same reason it is inexpressible through the tool — the parity
 * contract does the work, not a route-level check.
 */
type Params = { params: Promise<{ projectId: string; priorityId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId, priorityId } = await params
    const body = await readJsonObject(request)
    const parsed = updatePrioritySchema.parse({ ...body, priorityId })

    await requirePriorityInProject(projectId, priorityId)

    return updatePriority(parsed)
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId, priorityId } = await params
    const parsed = deletePrioritySchema.parse({ priorityId })

    await requirePriorityInProject(projectId, priorityId)

    return deletePriority(parsed)
  })
}

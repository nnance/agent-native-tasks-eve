import { deleteStatus, updateStatus } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { requireStatusInProject } from "@/lib/api/scope"
import { deleteStatusSchema, updateStatusSchema } from "@/lib/schemas"

/**
 * One status (implementation plan §2.3).
 *
 * PATCH is deliberately a **single consolidated endpoint** covering rename,
 * reorder and toggle-completed, mirroring the consolidated `update_status`
 * tool. Splitting it into /rename and /reorder would look tidier and would
 * break the parity the whole architecture is for.
 *
 * Step order is load-bearing: parse first, so a malformed id is a 400 rather
 * than a lookup; scope-check second, so a well-formed id under the wrong
 * project is a 404; then the action, which owns every §7 rule.
 */
type Params = { params: Promise<{ projectId: string; statusId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId, statusId } = await params
    const body = await readJsonObject(request)
    const parsed = updateStatusSchema.parse({ ...body, statusId })

    await requireStatusInProject(projectId, statusId)

    return updateStatus(parsed)
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId, statusId } = await params
    const parsed = deleteStatusSchema.parse({ statusId })

    await requireStatusInProject(projectId, statusId)

    return deleteStatus(parsed)
  })
}

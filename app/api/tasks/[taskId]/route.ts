import { deleteTask, getTask, updateTask } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import {
  deleteTaskSchema,
  getTaskSchema,
  updateTaskSchema,
} from "@/lib/schemas"

/**
 * One task (implementation plan §2.3).
 *
 * There is no project-immutability check here and there must not be: product
 * spec §7 rule 1 is structural, because `updateTaskSchema` is a strictObject
 * with no `projectId` field. A body carrying one is a ZodError → 400 by
 * construction, through this front door and the Phase 4 tool alike.
 */
type Params = { params: Promise<{ taskId: string }> }

export async function GET(_request: Request, { params }: Params) {
  return respond(async () => {
    const { taskId } = await params

    return getTask(getTaskSchema.parse({ taskId }))
  })
}

export async function PATCH(request: Request, { params }: Params) {
  return respond(async () => {
    const { taskId } = await params
    const body = await readJsonObject(request)

    return updateTask(updateTaskSchema.parse({ ...body, taskId }))
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  return respond(async () => {
    const { taskId } = await params

    return deleteTask(deleteTaskSchema.parse({ taskId }))
  })
}

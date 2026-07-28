import { createStatus, listStatuses } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { createStatusSchema, listStatusesSchema } from "@/lib/schemas"

/** A project's status collection (implementation plan §2.3). */
type Params = { params: Promise<{ projectId: string }> }

/**
 * An unknown-but-well-formed project id yields `200 []`, not 404: listStatuses
 * reports absence as emptiness by design. See lib/api/scope.ts for why the
 * item-level check is the asymmetric case.
 */
export async function GET(_request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId } = await params

    return listStatuses(listStatusesSchema.parse({ projectId }))
  })
}

export async function POST(request: Request, { params }: Params) {
  return respond(
    async () => {
      const { projectId } = await params
      const body = await readJsonObject(request)

      return createStatus(createStatusSchema.parse({ ...body, projectId }))
    },
    { status: 201 }
  )
}

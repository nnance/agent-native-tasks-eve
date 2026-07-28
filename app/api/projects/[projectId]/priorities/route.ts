import { createPriority, listPriorities } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { createPrioritySchema, listPrioritiesSchema } from "@/lib/schemas"

/**
 * A project's priority collection (implementation plan §2.3). The exact mirror
 * of the statuses collection — see that file, and lib/api/scope.ts for why an
 * unknown project is `200 []` here but 404 on POST.
 */
type Params = { params: Promise<{ projectId: string }> }

export async function GET(_request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId } = await params

    return listPriorities(listPrioritiesSchema.parse({ projectId }))
  })
}

export async function POST(request: Request, { params }: Params) {
  return respond(
    async () => {
      const { projectId } = await params
      const body = await readJsonObject(request)

      return createPriority(createPrioritySchema.parse({ ...body, projectId }))
    },
    { status: 201 }
  )
}

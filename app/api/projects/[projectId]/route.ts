import { deleteProject, renameProject } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { deleteProjectSchema, renameProjectSchema } from "@/lib/schemas"

/**
 * One project (implementation plan §2.3).
 *
 * `params` is a Promise and must be awaited — a breaking change in Next
 * v15.0.0-RC (node_modules/next/dist/docs/.../route.md version history). Typed
 * inline rather than with the global `RouteContext<'…'>` helper, because that
 * helper is generated during `next dev`/`next build`/`next typegen` and
 * `pnpm typecheck` is a bare `tsc --noEmit` that must pass on a clean checkout.
 *
 * `{ ...body, projectId }` is deliberate: when the URL segment and a body key
 * name the same field, **the URL wins**. The address is what the client asked
 * for and what any log or proxy records; a body key that disagrees is at best
 * redundant. Spread order makes that a single unmissable line.
 */
type Params = { params: Promise<{ projectId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId } = await params
    const body = await readJsonObject(request)

    return renameProject(renameProjectSchema.parse({ ...body, projectId }))
  })
}

export async function DELETE(_request: Request, { params }: Params) {
  return respond(async () => {
    const { projectId } = await params

    return deleteProject(deleteProjectSchema.parse({ projectId }))
  })
}

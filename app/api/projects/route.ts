import { createProject, listProjects } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { createProjectSchema, listProjectsSchema } from "@/lib/schemas"

/**
 * The project collection (implementation plan §2.3).
 *
 * Every handler in app/api/ has the same three-step body: read transport
 * input, `.parse()` the shared lib/schemas object, call the one matching
 * lib/actions function. No rule is re-checked here and no query is issued
 * here — `respond()` maps whatever the action throws onto the status
 * vocabulary in lib/api/respond.ts.
 *
 * No route-segment config: Next 16 route handlers are dynamic by default (see
 * app/api/health/route.ts, and route.md's own v15.0.0-RC version note).
 */
export async function GET() {
  return respond(async () => listProjects(listProjectsSchema.parse({})))
}

export async function POST(request: Request) {
  return respond(
    async () =>
      createProject(createProjectSchema.parse(await readJsonObject(request))),
    { status: 201 }
  )
}

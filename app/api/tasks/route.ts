import type { NextRequest } from "next/server"
import { z } from "zod"

import { createTask, listTasks } from "@/lib/actions"
import { readJsonObject } from "@/lib/api/request"
import { respond } from "@/lib/api/respond"
import { createTaskSchema, listTasksSchema } from "@/lib/schemas"

/**
 * The task collection (implementation plan §2.3).
 *
 * This is the one handler that does real transport adaptation. The URL spells
 * the filters `?project=&status=&priority=&q=&includeCompleted=`; the shared
 * schema spells them `projectId`, `statusId`, `priorityId`, `search`,
 * `includeCompleted`. The longer names are deliberate — that schema doubles as
 * the tool input a model reads — so the translation belongs here, in the layer
 * that exists to do it, and not in lib/schemas/.
 */

/**
 * A URL carries strings; an EVE tool always emits a real boolean. Keeping this
 * coercion local means URL-string handling never leaks into the model-facing
 * parity contract. A bad value throws a ZodError, which flows through the same
 * 400 branch as everything else.
 */
const includeCompletedSchema = z.stringbool()

/**
 * An empty or whitespace-only value means "not provided".
 *
 * Without this, `?q=` sends `search: ""` into a `.min(1)` schema and 400s — and
 * a UI that binds filters to form inputs emits exactly that on every cleared
 * field. §2.3's own example writes all five params with empty values.
 */
function optionalParam(
  params: URLSearchParams,
  key: string
): string | undefined {
  const value = params.get(key)
  if (value === null) return undefined

  return value.trim() === "" ? undefined : value
}

export async function GET(request: NextRequest) {
  return respond(async () => {
    const params = request.nextUrl.searchParams
    const input: Record<string, unknown> = {}

    const project = optionalParam(params, "project")
    if (project !== undefined) input.projectId = project

    const status = optionalParam(params, "status")
    if (status !== undefined) input.statusId = status

    const priority = optionalParam(params, "priority")
    if (priority !== undefined) input.priorityId = priority

    const search = optionalParam(params, "q")
    if (search !== undefined) input.search = search

    const includeCompleted = optionalParam(params, "includeCompleted")
    if (includeCompleted !== undefined) {
      input.includeCompleted = includeCompletedSchema.parse(includeCompleted)
    }

    return listTasks(listTasksSchema.parse(input))
  })
}

export async function POST(request: Request) {
  return respond(
    async () =>
      createTask(createTaskSchema.parse(await readJsonObject(request))),
    { status: 201 }
  )
}

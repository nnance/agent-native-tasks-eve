/**
 * Prints what the API actually says when a rule blocks, an entity is missing,
 * or input is malformed — rather than quoting the source and asking the reader
 * to believe it.
 *
 * Boots the same server the API suite uses, drives it over HTTP, and dumps the
 * literal status code and response body for every branch of the status
 * vocabulary. Run:
 *
 *   node --env-file=.env.local --env-file-if-exists=.env.test \
 *     docs/verification/phase-2/harness/rule-bodies.ts
 */

import {
  createFixtureProject,
  createFixtureTask,
  cleanupFixtures,
} from "../../../../tests/api/support/fixtures.ts"
import { closeApiTestDb } from "../../../../tests/api/support/db.ts"
import {
  api,
  startApiServer,
  stopApiServer,
} from "../../../../tests/api/support/server.ts"

type NamedRow = { id: string; name: string; isCompleted?: boolean }

let section = 0

/** `body` is JSON-encoded; `rawBody` is sent exactly as written (for bad JSON). */
async function show(
  label: string,
  method: string,
  path: string,
  body?: unknown,
  rawBody?: string
): Promise<void> {
  const sent =
    rawBody !== undefined
      ? rawBody
      : body === undefined
        ? undefined
        : JSON.stringify(body)

  const response = await api(path, {
    method,
    ...(sent === undefined ? {} : { body: sent }),
  })
  const raw = await response.text()

  section += 1
  console.log(`\n[${section}] ${label}`)
  console.log(`    ${method} ${path}`)
  if (sent !== undefined) console.log(`    body: ${sent}`)
  console.log(`    -> ${response.status}`)
  console.log(`    ${raw}`)
}

async function main(): Promise<void> {
  await startApiServer()
  console.log("Live transcript of every error branch, against a real server.")
  console.log("Nothing below is quoted from source; it is what the wire said.")

  // --- 409 RuleViolation ---------------------------------------------------
  const blocked = await createFixtureProject("Design")
  await createFixtureTask(blocked.id, "Ship the landing page")
  await show(
    "409 RuleViolation — delete a project that still has tasks (§7.3)",
    "DELETE",
    `/api/projects/${blocked.id}`
  )

  const statusProject = await createFixtureProject("Roadmap")
  const statuses = (await (
    await api(`/api/projects/${statusProject.id}/statuses`)
  ).json()) as NamedRow[]
  await createFixtureTask(statusProject.id, "In flight", {
    statusId: statuses[0]!.id,
  })
  await show(
    "409 RuleViolation — delete a status a task still uses (§7.3)",
    "DELETE",
    `/api/projects/${statusProject.id}/statuses/${statuses[0]!.id}`
  )

  const lastStatus = await createFixtureProject("Solo")
  const soloStatuses = (await (
    await api(`/api/projects/${lastStatus.id}/statuses`)
  ).json()) as NamedRow[]
  for (const doomed of soloStatuses.slice(1)) {
    await api(`/api/projects/${lastStatus.id}/statuses/${doomed.id}`, {
      method: "DELETE",
    })
  }
  await show(
    "409 RuleViolation — delete the last remaining status (§7.5)",
    "DELETE",
    `/api/projects/${lastStatus.id}/statuses/${soloStatuses[0]!.id}`
  )

  const lastPriority = await createFixtureProject("Alone")
  const soloPriorities = (await (
    await api(`/api/projects/${lastPriority.id}/priorities`)
  ).json()) as NamedRow[]
  for (const doomed of soloPriorities.slice(1)) {
    await api(`/api/projects/${lastPriority.id}/priorities/${doomed.id}`, {
      method: "DELETE",
    })
  }
  await show(
    "409 RuleViolation — delete the last remaining priority (§7.5)",
    "DELETE",
    `/api/projects/${lastPriority.id}/priorities/${soloPriorities[0]!.id}`
  )

  const scopeA = await createFixtureProject("Website")
  const scopeB = await createFixtureProject("Backend")
  const foreign = (await (
    await api(`/api/projects/${scopeB.id}/statuses`)
  ).json()) as NamedRow[]
  await show(
    "409 RuleViolation — a task using another project's status (§7 rule 2)",
    "POST",
    "/api/tasks",
    { projectId: scopeA.id, title: "Cross-project", statusId: foreign[0]!.id }
  )

  // --- 404 NotFoundError ---------------------------------------------------
  const missing = crypto.randomUUID()
  await show(
    "404 NotFoundError — unknown project",
    "PATCH",
    `/api/projects/${missing}`,
    {
      name: "Nope",
    }
  )
  await show("404 NotFoundError — unknown task", "GET", `/api/tasks/${missing}`)

  const owner = await createFixtureProject("Owner")
  const stranger = await createFixtureProject("Stranger")
  const owned = (await (
    await api(`/api/projects/${owner.id}/statuses`)
  ).json()) as NamedRow[]
  await show(
    "404 — a real status addressed under the wrong project (scope guard)",
    "PATCH",
    `/api/projects/${stranger.id}/statuses/${owned[0]!.id}`,
    { name: "Hijacked" }
  )

  // --- 400 ZodError / BadRequest -------------------------------------------
  await show(
    "400 ZodError — missing required field",
    "POST",
    "/api/projects",
    {}
  )
  await show(
    "400 ZodError — unknown key (strictObject)",
    "POST",
    "/api/projects",
    { name: "Website", colour: "blue" }
  )
  await show(
    "400 ZodError — projectId on a task update (immutability, §7 rule 1)",
    "PATCH",
    `/api/tasks/${missing}`,
    { title: "Moved", projectId: owner.id }
  )
  await show(
    "400 ZodError — malformed id in the URL",
    "PATCH",
    "/api/projects/not-a-uuid",
    { name: "Nope" }
  )
  await show(
    "400 ZodError — uncoercible includeCompleted",
    "GET",
    "/api/tasks?includeCompleted=maybe"
  )
  await show(
    "400 BadRequest — malformed JSON body",
    "POST",
    "/api/projects",
    undefined,
    "{oops"
  )
  await show(
    "400 BadRequest — a JSON array where an object is required",
    "POST",
    "/api/projects",
    [1, 2]
  )

  // --- 200: an empty query string is a no-op, not an error -----------------
  const emptyFilters = await api(
    "/api/tasks?project=&status=&priority=&q=&includeCompleted="
  )
  section += 1
  console.log(
    `\n[${section}] 200 — all five filters empty behaves as unfiltered`
  )
  console.log(
    "    GET /api/tasks?project=&status=&priority=&q=&includeCompleted="
  )
  console.log(`    -> ${emptyFilters.status}`)
  console.log(
    `    (${((await emptyFilters.json()) as unknown[]).length} tasks returned)`
  )
}

try {
  await main()
} finally {
  await cleanupFixtures()
  await closeApiTestDb()
  await stopApiServer()
}

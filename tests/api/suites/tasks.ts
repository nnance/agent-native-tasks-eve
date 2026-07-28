/**
 * GET/POST /api/tasks and GET/PATCH/DELETE /api/tasks/[taskId].
 *
 * The filter tests always scope themselves to their own fixture project, or
 * search on a token unique to the run, because the API suite writes real
 * committed rows into a shared database — an unscoped "the list contains
 * exactly N" assertion would be a flake waiting for the next suite to land.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createFixtureProject } from "../support/fixtures.ts"
import { apiJson } from "../support/server.ts"

type TaskBody = {
  id: string
  title: string
  description: string | null
  createdAt: string
  updatedAt: string
  project: { id: string; name: string }
  status: { id: string; name: string; order: number; isCompleted: boolean }
  priority: { id: string; name: string; order: number; isDefault: boolean }
}
type NamedRow = { id: string; name: string; order: number }
type StatusRow = NamedRow & { isCompleted: boolean }
type PriorityRow = NamedRow & { isDefault: boolean }
type ErrorBody = { error: string; issues?: unknown[] }

async function listsOf(projectId: string) {
  const { body: statuses } = await apiJson<StatusRow[]>(
    `/api/projects/${projectId}/statuses`
  )
  const { body: priorities } = await apiJson<PriorityRow[]>(
    `/api/projects/${projectId}/priorities`
  )

  return { statuses, priorities }
}

async function postTask(
  input: Record<string, unknown>
): Promise<{ status: number; body: TaskBody }> {
  return apiJson<TaskBody>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function registerTasksSuite(): void {
  describe("POST /api/tasks", () => {
    // §4.4 / US-B1.3 / US-B1.4: omitted status takes first-by-order, omitted
    // priority takes the project's default.
    it("applies the project's first status and default priority", async () => {
      const project = await createFixtureProject("CreateTask")
      const { statuses, priorities } = await listsOf(project.id)

      const { status, body } = await postTask({
        projectId: project.id,
        title: "Write the spec",
      })

      assert.equal(status, 201)
      assert.equal(body.title, "Write the spec")
      assert.equal(body.description, null)
      assert.equal(body.project.id, project.id)
      assert.equal(body.status.id, statuses[0]!.id)
      assert.equal(body.priority.id, priorities.find((p) => p.isDefault)!.id)
    })

    // §7 rule 2 / US-B1.5, relayed verbatim from lib/actions/tasks.ts.
    it("answers 409 for a status belonging to another project", async () => {
      const project = await createFixtureProject("ScopeTask")
      const other = await createFixtureProject("ScopeOther")
      const { statuses: theirs } = await listsOf(other.id)
      const stranger = theirs[0]!

      const { status, body } = await apiJson<ErrorBody>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "Cross-project",
          statusId: stranger.id,
        }),
      })

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `Status '${stranger.name}' belongs to a different project. A task ` +
          `in '${project.name}' can only use that project's own statuses.`
      )
    })

    it("answers 409 for a priority belonging to another project", async () => {
      const project = await createFixtureProject("ScopePriorityTask")
      const other = await createFixtureProject("ScopePriorityOther")
      const { priorities: theirs } = await listsOf(other.id)
      const stranger = theirs[0]!

      const { status, body } = await apiJson<ErrorBody>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "Cross-project",
          priorityId: stranger.id,
        }),
      })

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `Priority '${stranger.name}' belongs to a different project. A task ` +
          `in '${project.name}' can only use that project's own priorities.`
      )
    })

    it("answers 404 for an unknown project", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ projectId: missing, title: "Orphan" }),
      })

      assert.equal(status, 404)
      assert.equal(body.error, `No project with id ${missing}.`)
    })

    it("rejects a missing title and an unknown key", async () => {
      const project = await createFixtureProject("BadTask")

      const missingTitle = await apiJson<ErrorBody>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ projectId: project.id }),
      })
      assert.equal(missingTitle.status, 400)

      const unknownKey = await apiJson<ErrorBody>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          title: "x",
          assignee: "nick",
        }),
      })
      assert.equal(unknownKey.status, 400)
    })
  })

  describe("GET /api/tasks", () => {
    it("filters by project", async () => {
      const project = await createFixtureProject("FilterProject")
      const other = await createFixtureProject("FilterOther")
      const mine = await postTask({ projectId: project.id, title: "Mine" })
      await postTask({ projectId: other.id, title: "Theirs" })

      const { status, body } = await apiJson<TaskBody[]>(
        `/api/tasks?project=${project.id}`
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(
        body.map((task) => task.id),
        [mine.body.id]
      )
    })

    // US-B3.1 / US-B3.4: every filter is combinable, and they narrow together.
    it("combines project, status, priority and q", async () => {
      const project = await createFixtureProject("Combined")
      const { statuses, priorities } = await listsOf(project.id)
      const token = crypto.randomUUID().slice(0, 8)

      const wanted = await postTask({
        projectId: project.id,
        title: `keep ${token}`,
        statusId: statuses[1]!.id,
        priorityId: priorities[2]!.id,
      })
      // Each of these differs from `wanted` in exactly one filtered dimension.
      await postTask({
        projectId: project.id,
        title: `keep ${token}`,
        statusId: statuses[0]!.id,
        priorityId: priorities[2]!.id,
      })
      await postTask({
        projectId: project.id,
        title: `keep ${token}`,
        statusId: statuses[1]!.id,
        priorityId: priorities[0]!.id,
      })
      await postTask({
        projectId: project.id,
        title: "different words entirely",
        statusId: statuses[1]!.id,
        priorityId: priorities[2]!.id,
      })

      const query =
        `/api/tasks?project=${project.id}&status=${statuses[1]!.id}` +
        `&priority=${priorities[2]!.id}&q=keep%20${token}`
      const { status, body } = await apiJson<TaskBody[]>(query)

      assert.equal(status, 200)
      assert.deepStrictEqual(
        body.map((task) => task.id),
        [wanted.body.id]
      )
    })

    it("searches descriptions as well as titles", async () => {
      const project = await createFixtureProject("Search")
      const token = crypto.randomUUID().slice(0, 8)

      const byDescription = await postTask({
        projectId: project.id,
        title: "Nothing notable in the title",
        description: `buried ${token} in the body`,
      })

      const { status, body } = await apiJson<TaskBody[]>(
        `/api/tasks?project=${project.id}&q=${token}`
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(
        body.map((task) => task.id),
        [byDescription.body.id]
      )
    })

    // US-B2.3: completed tasks are hidden unless asked for.
    it("hides completed tasks by default and reveals them on request", async () => {
      const project = await createFixtureProject("Completed")
      const { statuses } = await listsOf(project.id)
      const done = statuses.find((row) => row.isCompleted)!

      const open = await postTask({ projectId: project.id, title: "Open" })
      const closed = await postTask({
        projectId: project.id,
        title: "Closed",
        statusId: done.id,
      })

      const hidden = await apiJson<TaskBody[]>(
        `/api/tasks?project=${project.id}`
      )
      assert.deepStrictEqual(
        hidden.body.map((task) => task.id),
        [open.body.id]
      )

      // Both spellings a URL actually carries, via z.stringbool().
      for (const value of ["true", "1"]) {
        const shown = await apiJson<TaskBody[]>(
          `/api/tasks?project=${project.id}&includeCompleted=${value}`
        )
        assert.equal(shown.status, 200)
        assert.deepStrictEqual(
          shown.body.map((task) => task.id).sort(),
          [open.body.id, closed.body.id].sort(),
          `includeCompleted=${value} did not reveal the completed task`
        )
      }

      const off = await apiJson<TaskBody[]>(
        `/api/tasks?project=${project.id}&includeCompleted=false`
      )
      assert.deepStrictEqual(
        off.body.map((task) => task.id),
        [open.body.id]
      )
    })

    it("answers 400 for an uncoercible includeCompleted", async () => {
      const { status, body } = await apiJson<ErrorBody>(
        "/api/tasks?includeCompleted=maybe"
      )

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
    })

    it("answers 400 for a malformed filter id", async () => {
      const { status } = await apiJson<ErrorBody>(
        "/api/tasks?project=not-a-uuid"
      )

      assert.equal(status, 400)
    })

    // §2.3 writes the filters with empty values; a UI bound to form inputs
    // emits exactly that on every cleared field, so it must be a no-op.
    it("treats empty filter values as absent", async () => {
      const project = await createFixtureProject("EmptyFilters")
      const task = await postTask({ projectId: project.id, title: "Present" })

      const { status, body } = await apiJson<TaskBody[]>(
        "/api/tasks?project=&status=&priority=&q=&includeCompleted="
      )

      assert.equal(status, 200)
      assert.ok(
        body.some((row) => row.id === task.body.id),
        "an all-empty query should behave as unfiltered"
      )
    })
  })

  describe("GET /api/tasks/[taskId]", () => {
    it("returns the nested project/status/priority view", async () => {
      const project = await createFixtureProject("GetTask")
      const created = await postTask({
        projectId: project.id,
        title: "Readable",
        description: "with a description",
      })

      const { status, body } = await apiJson<TaskBody>(
        `/api/tasks/${created.body.id}`
      )

      assert.equal(status, 200)
      assert.equal(body.id, created.body.id)
      assert.equal(body.description, "with a description")
      assert.equal(body.project.id, project.id)
      assert.ok(body.status.name.length > 0)
      assert.ok(body.priority.name.length > 0)
    })

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const missing = crypto.randomUUID()

      const unknown = await apiJson<ErrorBody>(`/api/tasks/${missing}`)
      assert.equal(unknown.status, 404)
      assert.equal(unknown.body.error, `No task with id ${missing}.`)

      const malformed = await apiJson<ErrorBody>("/api/tasks/nope")
      assert.equal(malformed.status, 400)
    })
  })

  describe("PATCH /api/tasks/[taskId]", () => {
    it("edits a title and moves a status", async () => {
      const project = await createFixtureProject("PatchTask")
      const { statuses } = await listsOf(project.id)
      const created = await postTask({
        projectId: project.id,
        title: "Before",
      })

      const { status, body } = await apiJson<TaskBody>(
        `/api/tasks/${created.body.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: "After",
            statusId: statuses[1]!.id,
          }),
        }
      )

      assert.equal(status, 200)
      assert.equal(body.title, "After")
      assert.equal(body.status.id, statuses[1]!.id)
    })

    it("clears a description with an explicit null", async () => {
      const project = await createFixtureProject("ClearDescription")
      const created = await postTask({
        projectId: project.id,
        title: "Has one",
        description: "for now",
      })

      const { status, body } = await apiJson<TaskBody>(
        `/api/tasks/${created.body.id}`,
        { method: "PATCH", body: JSON.stringify({ description: null }) }
      )

      assert.equal(status, 200)
      assert.equal(body.description, null)
    })

    // §7 rule 1, enforced structurally: updateTaskSchema has no projectId
    // field and is strict, so this is a 400 with no route-level check at all.
    it("answers 400 for a projectId in the body — immutability", async () => {
      const project = await createFixtureProject("Immutable")
      const other = await createFixtureProject("ImmutableTarget")
      const created = await postTask({ projectId: project.id, title: "Fixed" })

      const { status, body } = await apiJson<ErrorBody>(
        `/api/tasks/${created.body.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Moved", projectId: other.id }),
        }
      )

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")

      // Nothing changed — not even the title that shared the request.
      const { body: after } = await apiJson<TaskBody>(
        `/api/tasks/${created.body.id}`
      )
      assert.equal(after.title, "Fixed")
      assert.equal(after.project.id, project.id)
    })

    it("rejects an empty patch", async () => {
      const project = await createFixtureProject("EmptyTaskPatch")
      const created = await postTask({ projectId: project.id, title: "Idle" })

      const { status } = await apiJson<ErrorBody>(
        `/api/tasks/${created.body.id}`,
        { method: "PATCH", body: JSON.stringify({}) }
      )

      assert.equal(status, 400)
    })

    it("answers 404 for an unknown id", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(
        `/api/tasks/${missing}`,
        { method: "PATCH", body: JSON.stringify({ title: "Nope" }) }
      )

      assert.equal(status, 404)
      assert.equal(body.error, `No task with id ${missing}.`)
    })
  })

  describe("DELETE /api/tasks/[taskId]", () => {
    // 200 with the summary the action already produces, never 204: both the
    // UI and the agent relay "deleted <title>" (§9).
    it("returns the deleted task's id and title", async () => {
      const project = await createFixtureProject("DeleteTask")
      const created = await postTask({ projectId: project.id, title: "Doomed" })

      const { status, body } = await apiJson<{ id: string; title: string }>(
        `/api/tasks/${created.body.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, { id: created.body.id, title: "Doomed" })

      const gone = await apiJson<ErrorBody>(`/api/tasks/${created.body.id}`)
      assert.equal(gone.status, 404)
    })

    it("answers 404 for an unknown id", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(
        `/api/tasks/${missing}`,
        { method: "DELETE" }
      )

      assert.equal(status, 404)
      assert.equal(body.error, `No task with id ${missing}.`)
    })
  })
}

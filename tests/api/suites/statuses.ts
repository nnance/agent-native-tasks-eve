/**
 * GET/POST /api/projects/[projectId]/statuses and
 * PATCH/DELETE /api/projects/[projectId]/statuses/[statusId].
 *
 * The seeded default names are read from lib/domain/defaults.ts rather than
 * hardcoded, so this suite cannot quietly disagree with the one source of
 * truth for what a new project looks like.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEFAULT_STATUSES } from "../../../lib/domain/defaults.ts"
import { createFixtureProject, createFixtureTask } from "../support/fixtures.ts"
import { apiJson } from "../support/server.ts"

type StatusBody = {
  id: string
  projectId: string
  name: string
  order: number
  isCompleted: boolean
}
type ErrorBody = { error: string; issues?: unknown[] }

const statusesOf = (projectId: string) => `/api/projects/${projectId}/statuses`

export function registerStatusesSuite(): void {
  describe("GET /api/projects/[projectId]/statuses", () => {
    it("returns the seeded defaults in order", async () => {
      const project = await createFixtureProject("Statuses")

      const { status, body } = await apiJson<StatusBody[]>(
        statusesOf(project.id)
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(
        body.map((row) => ({
          name: row.name,
          isCompleted: row.isCompleted,
          order: row.order,
        })),
        DEFAULT_STATUSES.map((seeded, index) => ({
          name: seeded.name,
          isCompleted: seeded.isCompleted,
          order: index,
        }))
      )
    })

    // Absence is emptiness, not a 404: listStatuses reports it that way by
    // design, and a project-existence probe here would be a read the action
    // layer deliberately does not do. See lib/api/scope.ts.
    it("returns an empty array for an unknown but well-formed project id", async () => {
      const { status, body } = await apiJson<StatusBody[]>(
        statusesOf(crypto.randomUUID())
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, [])
    })

    it("answers 400 for a malformed project segment", async () => {
      const { status } = await apiJson<ErrorBody>(statusesOf("nope"))

      assert.equal(status, 400)
    })
  })

  describe("POST /api/projects/[projectId]/statuses", () => {
    it("appends the new status at the end of the list", async () => {
      const project = await createFixtureProject("AppendStatus")

      const { status, body } = await apiJson<StatusBody>(
        statusesOf(project.id),
        { method: "POST", body: JSON.stringify({ name: "Blocked" }) }
      )

      assert.equal(status, 201)
      assert.equal(body.name, "Blocked")
      assert.equal(body.order, DEFAULT_STATUSES.length)
      assert.equal(body.isCompleted, false)
      assert.equal(body.projectId, project.id)
    })

    it("answers 404 for an unknown project — createStatus raises it", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(statusesOf(missing), {
        method: "POST",
        body: JSON.stringify({ name: "Blocked" }),
      })

      assert.equal(status, 404)
      assert.equal(body.error, `No project with id ${missing}.`)
    })

    it("rejects a missing name", async () => {
      const project = await createFixtureProject("BadStatus")

      const { status } = await apiJson<ErrorBody>(statusesOf(project.id), {
        method: "POST",
        body: JSON.stringify({}),
      })

      assert.equal(status, 400)
    })
  })

  // One consolidated PATCH, mirroring the consolidated update_status tool.
  describe("PATCH .../statuses/[statusId]", () => {
    it("renames a status", async () => {
      const project = await createFixtureProject("RenameStatus")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(project.id))
      const target = list[0]!

      const { status, body } = await apiJson<StatusBody>(
        `${statusesOf(project.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ name: "Backlog" }) }
      )

      assert.equal(status, 200)
      assert.equal(body.id, target.id)
      assert.equal(body.name, "Backlog")
    })

    it("reorders a status to a new 0-based position", async () => {
      const project = await createFixtureProject("ReorderStatus")
      const { body: before } = await apiJson<StatusBody[]>(
        statusesOf(project.id)
      )
      const last = before[before.length - 1]!

      const { status } = await apiJson<StatusBody>(
        `${statusesOf(project.id)}/${last.id}`,
        { method: "PATCH", body: JSON.stringify({ order: 0 }) }
      )
      assert.equal(status, 200)

      const { body: after } = await apiJson<StatusBody[]>(
        statusesOf(project.id)
      )
      assert.equal(after[0]?.id, last.id)
      assert.deepStrictEqual(
        after.map((row) => row.order),
        after.map((_, index) => index)
      )
    })

    it("toggles the completed flag", async () => {
      const project = await createFixtureProject("CompleteStatus")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(project.id))
      const target = list[0]!

      const { status, body } = await apiJson<StatusBody>(
        `${statusesOf(project.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ isCompleted: true }) }
      )

      assert.equal(status, 200)
      assert.equal(body.isCompleted, true)
    })

    it("rejects an empty patch — the schema's refinement reaches the wire", async () => {
      const project = await createFixtureProject("EmptyStatusPatch")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(project.id))

      const { status, body } = await apiJson<ErrorBody>(
        `${statusesOf(project.id)}/${list[0]!.id}`,
        { method: "PATCH", body: JSON.stringify({}) }
      )

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
    })

    // Address resolution: the [projectId] segment has to mean something, or
    // the nested REST shape is a lie Phase 3's UI would be built on.
    it("answers 404 when the status belongs to a different project", async () => {
      const owner = await createFixtureProject("Owner")
      const stranger = await createFixtureProject("Stranger")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(owner.id))
      const target = list[0]!

      const { status, body } = await apiJson<ErrorBody>(
        `${statusesOf(stranger.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) }
      )

      assert.equal(status, 404)
      assert.equal(
        body.error,
        `No status with id ${target.id} in project ${stranger.id}.`
      )

      // And the status really was left alone.
      const { body: after } = await apiJson<StatusBody[]>(statusesOf(owner.id))
      assert.equal(after.find((row) => row.id === target.id)?.name, target.name)
    })

    it("answers 400 for a malformed status segment, before the scope check", async () => {
      const project = await createFixtureProject("BadStatusId")

      const { status } = await apiJson<ErrorBody>(
        `${statusesOf(project.id)}/nope`,
        { method: "PATCH", body: JSON.stringify({ name: "x" }) }
      )

      assert.equal(status, 400)
    })
  })

  describe("DELETE .../statuses/[statusId]", () => {
    it("deletes an unused, non-last status and renumbers the survivors", async () => {
      const project = await createFixtureProject("DeleteStatus")
      const { body: before } = await apiJson<StatusBody[]>(
        statusesOf(project.id)
      )
      const target = before[1]!

      const { status, body } = await apiJson<{ id: string; name: string }>(
        `${statusesOf(project.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, { id: target.id, name: target.name })

      const { body: after } = await apiJson<StatusBody[]>(
        statusesOf(project.id)
      )
      assert.equal(after.length, before.length - 1)
      assert.deepStrictEqual(
        after.map((row) => row.order),
        after.map((_, index) => index)
      )
    })

    // Product spec §7.3 / US-D2.2, verbatim.
    it("answers 409 while a task still uses the status", async () => {
      const project = await createFixtureProject("StatusInUse")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(project.id))
      const target = list[0]!
      await createFixtureTask(project.id, "Uses the status", {
        statusId: target.id,
      })

      const { status, body } = await apiJson<ErrorBody>(
        `${statusesOf(project.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `Status '${target.name}' is used by 1 task. Move those tasks to ` +
          `another status (or delete them) first, then delete the status.`
      )
    })

    // Product spec §7.5 / US-D2.3, verbatim — unconditional, even when unused.
    it("answers 409 for the last remaining status", async () => {
      const project = await createFixtureProject("LastStatus")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(project.id))

      for (const doomed of list.slice(1)) {
        const { status } = await apiJson(
          `${statusesOf(project.id)}/${doomed.id}`,
          { method: "DELETE" }
        )
        assert.equal(status, 200)
      }

      const survivor = list[0]!
      const { status, body } = await apiJson<ErrorBody>(
        `${statusesOf(project.id)}/${survivor.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `'${survivor.name}' is the only status in '${project.name}'. Every ` +
          `project must keep at least one status, so it cannot be deleted. ` +
          `Create another status first.`
      )
    })

    it("answers 404 when the status belongs to a different project", async () => {
      const owner = await createFixtureProject("DeleteOwner")
      const stranger = await createFixtureProject("DeleteStranger")
      const { body: list } = await apiJson<StatusBody[]>(statusesOf(owner.id))
      const target = list[0]!

      const { status, body } = await apiJson<ErrorBody>(
        `${statusesOf(stranger.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 404)
      assert.equal(
        body.error,
        `No status with id ${target.id} in project ${stranger.id}.`
      )

      const { body: after } = await apiJson<StatusBody[]>(statusesOf(owner.id))
      assert.ok(after.some((row) => row.id === target.id))
    })
  })
}

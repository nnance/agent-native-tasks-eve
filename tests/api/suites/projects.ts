/**
 * GET/POST /api/projects and PATCH/DELETE /api/projects/[projectId].
 *
 * Exports a register function rather than calling `describe` at import time,
 * so tests/api/index.test.ts's root before/after hooks are provably registered
 * first. See tests/api/support/server.ts.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  createFixtureProject,
  createFixtureTask,
  deleteFixtureTask,
} from "../support/fixtures.ts"
import { api, apiJson } from "../support/server.ts"

type ProjectBody = { id: string; name: string; createdAt: string }
type ErrorBody = { error: string; issues?: unknown[] }

export function registerProjectsSuite(): void {
  describe("POST /api/projects", () => {
    it("creates a project and answers 201 with it", async () => {
      const name = `Website ${crypto.randomUUID().slice(0, 8)}`
      const { status, body } = await apiJson<ProjectBody>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      })

      assert.equal(status, 201)
      assert.equal(body.name, name)
      assert.match(
        body.id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )

      // Clean up through the API, which also exercises DELETE.
      assert.equal(
        (await api(`/api/projects/${body.id}`, { method: "DELETE" })).status,
        200
      )
    })

    it("rejects a missing name with 400 and a structured issue list", async () => {
      const { status, body } = await apiJson<ErrorBody>("/api/projects", {
        method: "POST",
        body: JSON.stringify({}),
      })

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
      assert.ok(Array.isArray(body.issues) && body.issues.length > 0)
    })

    it("rejects a blank name", async () => {
      const { status } = await apiJson<ErrorBody>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      })

      assert.equal(status, 400)
    })

    it("rejects malformed JSON with the transport-level message", async () => {
      const { status, body } = await apiJson<ErrorBody>("/api/projects", {
        method: "POST",
        body: "{oops",
      })

      assert.equal(status, 400)
      assert.equal(body.error, "Request body must be valid JSON.")
    })

    it("rejects a non-object JSON body", async () => {
      const { status, body } = await apiJson<ErrorBody>("/api/projects", {
        method: "POST",
        body: "[1,2]",
      })

      assert.equal(status, 400)
      assert.equal(body.error, "Request body must be a JSON object.")
    })

    // z.strictObject in lib/schemas/ — an unknown key is a loud rejection, not
    // a silent strip, through this front door exactly as through the tool one.
    it("rejects an unknown key", async () => {
      const { status, body } = await apiJson<ErrorBody>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "Website", colour: "blue" }),
      })

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
    })
  })

  describe("GET /api/projects", () => {
    it("returns a bare array containing the fixture — no envelope", async () => {
      const project = await createFixtureProject("List")

      const { status, body } = await apiJson<ProjectBody[]>("/api/projects")

      assert.equal(status, 200)
      assert.ok(Array.isArray(body))
      assert.ok(body.some((row) => row.id === project.id))
    })
  })

  describe("PATCH /api/projects/[projectId]", () => {
    it("renames a project and returns the updated row", async () => {
      const project = await createFixtureProject("Rename")
      const renamed = `${project.name} renamed`

      const { status, body } = await apiJson<ProjectBody>(
        `/api/projects/${project.id}`,
        { method: "PATCH", body: JSON.stringify({ name: renamed }) }
      )

      assert.equal(status, 200)
      assert.equal(body.id, project.id)
      assert.equal(body.name, renamed)
    })

    it("answers 404 with the action's own message for an unknown id", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(
        `/api/projects/${missing}`,
        { method: "PATCH", body: JSON.stringify({ name: "Nope" }) }
      )

      assert.equal(status, 404)
      assert.equal(body.error, `No project with id ${missing}.`)
    })

    it("answers 400 for a malformed id segment, before any lookup", async () => {
      const { status, body } = await apiJson<ErrorBody>(
        "/api/projects/not-a-uuid",
        { method: "PATCH", body: JSON.stringify({ name: "Nope" }) }
      )

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
    })

    it("rejects an empty patch", async () => {
      const project = await createFixtureProject("EmptyPatch")

      const { status } = await apiJson<ErrorBody>(
        `/api/projects/${project.id}`,
        { method: "PATCH", body: JSON.stringify({}) }
      )

      assert.equal(status, 400)
    })

    // The address is authoritative: a body key naming a *different* project is
    // ignored, not obeyed. Asserted directly because it is a security-shaped
    // property, not a stylistic one.
    it("lets the URL win over a projectId smuggled into the body", async () => {
      const target = await createFixtureProject("UrlWins")
      const other = await createFixtureProject("Bystander")
      const renamed = `${target.name} via url`

      const { status, body } = await apiJson<ProjectBody>(
        `/api/projects/${target.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: renamed, projectId: other.id }),
        }
      )

      assert.equal(status, 200)
      assert.equal(body.id, target.id)
      assert.equal(body.name, renamed)

      const { body: all } = await apiJson<ProjectBody[]>("/api/projects")
      const bystander = all.find((row) => row.id === other.id)
      assert.equal(bystander?.name, other.name, "the bystander was renamed")
    })
  })

  describe("DELETE /api/projects/[projectId]", () => {
    // Product spec §7.3 / US-C3.2: the message states what is blocking and
    // what to do about it, and reaches the caller verbatim (§9). Compared in
    // full rather than by fragment — these strings are a product deliverable.
    it("answers 409 with the verbatim block message while a task remains", async () => {
      const project = await createFixtureProject("Blocked")
      const task = await createFixtureTask(project.id, "Still here")

      const blocked = await apiJson<ErrorBody>(`/api/projects/${project.id}`, {
        method: "DELETE",
      })

      assert.equal(blocked.status, 409)
      assert.equal(
        blocked.body.error,
        `Project '${project.name}' still has 1 task. Delete or move those ` +
          `tasks first, then delete the project.`
      )

      // …and succeeds once the blocker is gone, so the 409 was about the task
      // and not about the project being undeletable.
      await deleteFixtureTask(task.id)

      const { status, body } = await apiJson<{ id: string; name: string }>(
        `/api/projects/${project.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, { id: project.id, name: project.name })
    })

    it("answers 404 for an unknown id", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(
        `/api/projects/${missing}`,
        { method: "DELETE" }
      )

      assert.equal(status, 404)
      assert.equal(body.error, `No project with id ${missing}.`)
    })

    it("answers 400 for a malformed id segment", async () => {
      const { status } = await apiJson<ErrorBody>("/api/projects/nope", {
        method: "DELETE",
      })

      assert.equal(status, 400)
    })
  })
}

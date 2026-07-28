/**
 * GET/POST /api/projects/[projectId]/priorities and
 * PATCH/DELETE /api/projects/[projectId]/priorities/[priorityId].
 *
 * Mirrors the statuses suite, plus the three things priorities have that
 * statuses do not: the exactly-one-default invariant (§4.3, US-E1.3), the
 * `isDefault: false` rejection the shared schema makes structural, and
 * default-reassignment on delete (US-E2.4).
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { DEFAULT_PRIORITIES } from "../../../lib/domain/defaults.ts"
import { createFixtureProject, createFixtureTask } from "../support/fixtures.ts"
import { apiJson } from "../support/server.ts"

type PriorityBody = {
  id: string
  projectId: string
  name: string
  order: number
  isDefault: boolean
}
type ErrorBody = { error: string; issues?: unknown[] }

const prioritiesOf = (projectId: string) =>
  `/api/projects/${projectId}/priorities`

/** Every read of the list re-checks §4.3: exactly one default, always. */
function assertExactlyOneDefault(list: PriorityBody[]): PriorityBody {
  const defaults = list.filter((row) => row.isDefault)
  assert.equal(defaults.length, 1, "expected exactly one default priority")
  return defaults[0]!
}

export function registerPrioritiesSuite(): void {
  describe("GET /api/projects/[projectId]/priorities", () => {
    it("returns the seeded defaults in order, with exactly one default", async () => {
      const project = await createFixtureProject("Priorities")

      const { status, body } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(
        body.map((row) => ({
          name: row.name,
          isDefault: row.isDefault,
          order: row.order,
        })),
        DEFAULT_PRIORITIES.map((seeded, index) => ({
          name: seeded.name,
          isDefault: seeded.isDefault,
          order: index,
        }))
      )
      assertExactlyOneDefault(body)
    })

    it("returns an empty array for an unknown but well-formed project id", async () => {
      const { status, body } = await apiJson<PriorityBody[]>(
        prioritiesOf(crypto.randomUUID())
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, [])
    })

    it("answers 400 for a malformed project segment", async () => {
      const { status } = await apiJson<ErrorBody>(prioritiesOf("nope"))

      assert.equal(status, 400)
    })
  })

  describe("POST /api/projects/[projectId]/priorities", () => {
    it("appends the new priority and never makes it the default", async () => {
      const project = await createFixtureProject("AppendPriority")

      const { status, body } = await apiJson<PriorityBody>(
        prioritiesOf(project.id),
        { method: "POST", body: JSON.stringify({ name: "Urgent" }) }
      )

      assert.equal(status, 201)
      assert.equal(body.name, "Urgent")
      assert.equal(body.order, DEFAULT_PRIORITIES.length)
      assert.equal(body.isDefault, false)

      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      assertExactlyOneDefault(list)
    })

    // createPrioritySchema has no isDefault field at all — strictObject turns
    // the omission into a rejection rather than a silent strip.
    it("rejects an isDefault field on create", async () => {
      const project = await createFixtureProject("CreateDefault")

      const { status } = await apiJson<ErrorBody>(prioritiesOf(project.id), {
        method: "POST",
        body: JSON.stringify({ name: "Urgent", isDefault: true }),
      })

      assert.equal(status, 400)
    })

    it("answers 404 for an unknown project", async () => {
      const missing = crypto.randomUUID()

      const { status, body } = await apiJson<ErrorBody>(prioritiesOf(missing), {
        method: "POST",
        body: JSON.stringify({ name: "Urgent" }),
      })

      assert.equal(status, 404)
      assert.equal(body.error, `No project with id ${missing}.`)
    })
  })

  describe("PATCH .../priorities/[priorityId]", () => {
    it("renames a priority", async () => {
      const project = await createFixtureProject("RenamePriority")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const target = list[0]!

      const { status, body } = await apiJson<PriorityBody>(
        `${prioritiesOf(project.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ name: "Someday" }) }
      )

      assert.equal(status, 200)
      assert.equal(body.name, "Someday")
    })

    it("reorders a priority to a new 0-based position", async () => {
      const project = await createFixtureProject("ReorderPriority")
      const { body: before } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const last = before[before.length - 1]!

      const { status } = await apiJson<PriorityBody>(
        `${prioritiesOf(project.id)}/${last.id}`,
        { method: "PATCH", body: JSON.stringify({ order: 0 }) }
      )
      assert.equal(status, 200)

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      assert.equal(after[0]?.id, last.id)
      assert.deepStrictEqual(
        after.map((row) => row.order),
        after.map((_, index) => index)
      )
    })

    // US-E1.3 / §4.3: designating a new default moves the flag, it does not
    // add one. Asserted over the whole list, not just the response body.
    it("moves the default flag so exactly one remains", async () => {
      const project = await createFixtureProject("SetDefault")
      const { body: before } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const previousDefault = assertExactlyOneDefault(before)
      const target = before.find((row) => !row.isDefault)!

      const { status, body } = await apiJson<PriorityBody>(
        `${prioritiesOf(project.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ isDefault: true }) }
      )

      assert.equal(status, 200)
      assert.equal(body.isDefault, true)

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const nowDefault = assertExactlyOneDefault(after)
      assert.equal(nowDefault.id, target.id)
      assert.notEqual(nowDefault.id, previousDefault.id)
    })

    // z.literal(true) in the shared schema makes "un-set the default" — which
    // would leave the project with zero — inexpressible, not merely refused.
    it("rejects isDefault: false with a 400", async () => {
      const project = await createFixtureProject("UnsetDefault")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const current = assertExactlyOneDefault(list)

      const { status, body } = await apiJson<ErrorBody>(
        `${prioritiesOf(project.id)}/${current.id}`,
        { method: "PATCH", body: JSON.stringify({ isDefault: false }) }
      )

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      assert.equal(assertExactlyOneDefault(after).id, current.id)
    })

    it("rejects an empty patch", async () => {
      const project = await createFixtureProject("EmptyPriorityPatch")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )

      const { status } = await apiJson<ErrorBody>(
        `${prioritiesOf(project.id)}/${list[0]!.id}`,
        { method: "PATCH", body: JSON.stringify({}) }
      )

      assert.equal(status, 400)
    })

    it("answers 404 when the priority belongs to a different project", async () => {
      const owner = await createFixtureProject("PriorityOwner")
      const stranger = await createFixtureProject("PriorityStranger")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(owner.id)
      )
      const target = list[0]!

      const { status, body } = await apiJson<ErrorBody>(
        `${prioritiesOf(stranger.id)}/${target.id}`,
        { method: "PATCH", body: JSON.stringify({ name: "Hijacked" }) }
      )

      assert.equal(status, 404)
      assert.equal(
        body.error,
        `No priority with id ${target.id} in project ${stranger.id}.`
      )

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(owner.id)
      )
      assert.equal(after.find((row) => row.id === target.id)?.name, target.name)
    })

    it("answers 400 for a malformed priority segment", async () => {
      const project = await createFixtureProject("BadPriorityId")

      const { status } = await apiJson<ErrorBody>(
        `${prioritiesOf(project.id)}/nope`,
        { method: "PATCH", body: JSON.stringify({ name: "x" }) }
      )

      assert.equal(status, 400)
    })
  })

  describe("DELETE .../priorities/[priorityId]", () => {
    it("deletes an unused, non-last priority and renumbers the survivors", async () => {
      const project = await createFixtureProject("DeletePriority")
      const { body: before } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const target = before.find((row) => !row.isDefault)!

      const { status, body } = await apiJson<{ id: string; name: string }>(
        `${prioritiesOf(project.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 200)
      assert.deepStrictEqual(body, { id: target.id, name: target.name })

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      assert.equal(after.length, before.length - 1)
      assert.deepStrictEqual(
        after.map((row) => row.order),
        after.map((_, index) => index)
      )
      assertExactlyOneDefault(after)
    })

    // US-E2.4 / §4.3: deleting the default reassigns rather than leaving zero.
    it("reassigns the default when the default itself is deleted", async () => {
      const project = await createFixtureProject("DeleteDefault")
      const { body: before } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const current = assertExactlyOneDefault(before)

      const { status } = await apiJson(
        `${prioritiesOf(project.id)}/${current.id}`,
        { method: "DELETE" }
      )
      assert.equal(status, 200)

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const reassigned = assertExactlyOneDefault(after)
      assert.notEqual(reassigned.id, current.id)
      assert.equal(reassigned.order, 0)
    })

    // Product spec §7.3 / US-E2.2, verbatim.
    it("answers 409 while a task still uses the priority", async () => {
      const project = await createFixtureProject("PriorityInUse")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )
      const target = list[0]!
      await createFixtureTask(project.id, "Uses the priority", {
        priorityId: target.id,
      })

      const { status, body } = await apiJson<ErrorBody>(
        `${prioritiesOf(project.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `Priority '${target.name}' is used by 1 task. Move those tasks to ` +
          `another priority (or delete them) first, then delete the priority.`
      )
    })

    // Product spec §7.5 / US-E2.3, verbatim.
    it("answers 409 for the last remaining priority", async () => {
      const project = await createFixtureProject("LastPriority")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(project.id)
      )

      for (const doomed of list.slice(1)) {
        const { status } = await apiJson(
          `${prioritiesOf(project.id)}/${doomed.id}`,
          { method: "DELETE" }
        )
        assert.equal(status, 200)
      }

      const survivor = list[0]!
      const { status, body } = await apiJson<ErrorBody>(
        `${prioritiesOf(project.id)}/${survivor.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 409)
      assert.equal(
        body.error,
        `'${survivor.name}' is the only priority in '${project.name}'. Every ` +
          `project must keep at least one priority, so it cannot be deleted. ` +
          `Create another priority first.`
      )
    })

    it("answers 404 when the priority belongs to a different project", async () => {
      const owner = await createFixtureProject("DeletePriorityOwner")
      const stranger = await createFixtureProject("DeletePriorityStranger")
      const { body: list } = await apiJson<PriorityBody[]>(
        prioritiesOf(owner.id)
      )
      const target = list[0]!

      const { status, body } = await apiJson<ErrorBody>(
        `${prioritiesOf(stranger.id)}/${target.id}`,
        { method: "DELETE" }
      )

      assert.equal(status, 404)
      assert.equal(
        body.error,
        `No priority with id ${target.id} in project ${stranger.id}.`
      )

      const { body: after } = await apiJson<PriorityBody[]>(
        prioritiesOf(owner.id)
      )
      assert.ok(after.some((row) => row.id === target.id))
    })
  })
}

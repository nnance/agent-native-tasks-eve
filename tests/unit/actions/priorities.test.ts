import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import {
  createPriority,
  deletePriority,
  listPriorities,
  updatePriority,
} from "../../../lib/actions/priorities.ts"
import { createProject } from "../../../lib/actions/projects.ts"
import type { Database } from "../../../lib/db/connect.ts"
import { priorities, statuses, tasks } from "../../../lib/db/schema.ts"
import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"
import { withRollback } from "../../support/db.ts"

/** Inserts one task directly, so this file does not depend on lib/actions/tasks.ts. */
async function seedTask(tx: Database, projectId: string, priorityId: string) {
  const [status] = await tx
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.order))
    .limit(1)

  await tx.insert(tasks).values({
    projectId,
    title: "Fixture",
    statusId: status!.id,
    priorityId,
  })
}

/** The whole project's default flags — "exactly one" is a project-wide claim. */
async function defaultNames(tx: Database, projectId: string) {
  const listed = await listPriorities({ projectId }, tx)
  return listed.filter((p) => p.isDefault).map((p) => p.name)
}

describe("listPriorities", () => {
  // US-E1.1: priorities are per project and independent.
  it("returns only the given project's priorities, in order", async () => {
    await withRollback(async (tx) => {
      const a = await createProject({ name: "Alpha" }, tx)
      const b = await createProject({ name: "Beta" }, tx)

      await createPriority({ projectId: b.id, name: "Urgent" }, tx)

      const listed = await listPriorities({ projectId: a.id }, tx)
      assert.deepStrictEqual(
        listed.map((p) => p.name),
        ["Low", "Medium", "High"]
      )
    })
  })
})

describe("createPriority", () => {
  it("appends the new priority and never makes it the default", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const created = await createPriority(
        { projectId: project.id, name: "Urgent" },
        tx
      )

      assert.strictEqual(created.order, 3)
      assert.strictEqual(created.isDefault, false)

      // US-E1.3: the existing default is untouched, so exactly one remains.
      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Medium"])
    })
  })

  it("has no isDefault field at all — the schema rejects one", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      await assert.rejects(
        () =>
          createPriority(
            { projectId: project.id, name: "Urgent", isDefault: true } as never,
            tx
          ),
        z.ZodError
      )
    })
  })

  it("rejects a blank name and an unknown project", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      await assert.rejects(
        () => createPriority({ projectId: project.id, name: " " }, tx),
        z.ZodError
      )
      await assert.rejects(
        () => createPriority({ projectId: crypto.randomUUID(), name: "X" }, tx),
        NotFoundError
      )
    })
  })
})

describe("updatePriority", () => {
  it("renames a priority without touching order or the default", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const [low] = await listPriorities({ projectId: project.id }, tx)

      const renamed = await updatePriority(
        { priorityId: low!.id, name: "Someday" },
        tx
      )

      assert.strictEqual(renamed.name, "Someday")
      assert.strictEqual(renamed.order, 0)
      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Medium"])
    })
  })

  // US-E1.2: order is respected everywhere, including task list sorting.
  it("moves a priority and renumbers every sibling densely", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const high = listed.find((p) => p.name === "High")!

      await updatePriority({ priorityId: high.id, order: 0 }, tx)

      const reordered = await listPriorities({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        reordered.map((p) => p.name),
        ["High", "Low", "Medium"]
      )
      assert.deepStrictEqual(
        reordered.map((p) => p.order),
        [0, 1, 2]
      )
    })
  })

  // US-E1.3: exactly one default exists at all times — asserted across the
  // whole project, not just on the priority that was targeted.
  it("moves the default designation, leaving exactly one", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const high = listed.find((p) => p.name === "High")!

      const updated = await updatePriority(
        { priorityId: high.id, isDefault: true },
        tx
      )

      assert.strictEqual(updated.isDefault, true)
      assert.deepStrictEqual(await defaultNames(tx, project.id), ["High"])
    })
  })

  it("leaves another project's default untouched", async () => {
    await withRollback(async (tx) => {
      const a = await createProject({ name: "Alpha" }, tx)
      const b = await createProject({ name: "Beta" }, tx)

      const alphaPriorities = await listPriorities({ projectId: a.id }, tx)
      const alphaHigh = alphaPriorities.find((p) => p.name === "High")!

      await updatePriority({ priorityId: alphaHigh.id, isDefault: true }, tx)

      assert.deepStrictEqual(await defaultNames(tx, a.id), ["High"])
      assert.deepStrictEqual(await defaultNames(tx, b.id), ["Medium"])
    })
  })

  it("re-designating the current default is idempotent", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const medium = listed.find((p) => p.name === "Medium")!

      await updatePriority({ priorityId: medium.id, isDefault: true }, tx)

      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Medium"])
    })
  })

  it("rejects isDefault: false — a default can never be un-set alone", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const medium = listed.find((p) => p.name === "Medium")!

      await assert.rejects(
        () =>
          updatePriority(
            { priorityId: medium.id, isDefault: false } as never,
            tx
          ),
        z.ZodError
      )
      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Medium"])
    })
  })

  it("rejects an empty patch and an unknown id", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const [low] = await listPriorities({ projectId: project.id }, tx)

      await assert.rejects(
        () => updatePriority({ priorityId: low!.id } as never, tx),
        z.ZodError
      )
      await assert.rejects(
        () =>
          updatePriority({ priorityId: crypto.randomUUID(), name: "X" }, tx),
        NotFoundError
      )
    })
  })
})

describe("deletePriority", () => {
  // US-E2.1: deleting an unused priority succeeds and closes the order gap.
  it("deletes an unused priority and renumbers the survivors", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const low = listed.find((p) => p.name === "Low")!

      const deleted = await deletePriority({ priorityId: low.id }, tx)
      assert.deepStrictEqual(deleted, { id: low.id, name: "Low" })

      const survivors = await listPriorities({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        survivors.map((p) => [p.name, p.order]),
        [
          ["Medium", 0],
          ["High", 1],
        ]
      )
    })
  })

  // US-E2.4: the designation moves to the project's first priority by order.
  it("reassigns the default to the survivor at order 0", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const medium = listed.find((p) => p.name === "Medium")!

      await deletePriority({ priorityId: medium.id }, tx)

      const survivors = await listPriorities({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        survivors.map((p) => [p.name, p.order, p.isDefault]),
        [
          ["Low", 0, true],
          ["High", 1, false],
        ]
      )
    })
  })

  it("leaves the default alone when a non-default is deleted", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const high = listed.find((p) => p.name === "High")!

      await deletePriority({ priorityId: high.id }, tx)

      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Medium"])
    })
  })

  // US-E2.2: blocked, with the reason and the remedy.
  it("blocks deletion of a priority a task still uses", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const medium = listed.find((p) => p.name === "Medium")!

      await seedTask(tx, project.id, medium.id)

      await assert.rejects(
        () => deletePriority({ priorityId: medium.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /'Medium' is used by 1 task\./)
          assert.match(error.message, /Move those tasks to another priority/)
          return true
        }
      )

      const survivors = await listPriorities({ projectId: project.id }, tx)
      assert.strictEqual(survivors.length, 3)
    })
  })

  // US-E2.3: the last remaining priority cannot go, even when unused.
  it("blocks deletion of the last remaining priority even when unused", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)

      await deletePriority({ priorityId: listed[2]!.id }, tx)
      await deletePriority({ priorityId: listed[1]!.id }, tx)

      await assert.rejects(
        () => deletePriority({ priorityId: listed[0]!.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /only priority in 'Website'/)
          assert.match(error.message, /at least one priority/)
          return true
        }
      )

      // The survivor inherited the default along the way, so the invariant
      // still holds after all that churn.
      assert.deepStrictEqual(await defaultNames(tx, project.id), ["Low"])
    })
  })

  it("reports last-remaining, not in-use, when both block at once", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listPriorities({ projectId: project.id }, tx)
      const low = listed.find((p) => p.name === "Low")!

      await deletePriority({ priorityId: listed[2]!.id }, tx)
      await deletePriority({ priorityId: listed[1]!.id }, tx)
      await seedTask(tx, project.id, low.id)

      await assert.rejects(
        () => deletePriority({ priorityId: low.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /only priority/)
          assert.doesNotMatch(error.message, /is used by/)
          return true
        }
      )
    })
  })

  it("leaves other projects' priorities alone", async () => {
    await withRollback(async (tx) => {
      const a = await createProject({ name: "Alpha" }, tx)
      const b = await createProject({ name: "Beta" }, tx)

      const alphaPriorities = await listPriorities({ projectId: a.id }, tx)
      await deletePriority({ priorityId: alphaPriorities[0]!.id }, tx)

      const betaPriorities = await listPriorities({ projectId: b.id }, tx)
      assert.deepStrictEqual(
        betaPriorities.map((p) => [p.name, p.order, p.isDefault]),
        [
          ["Low", 0, false],
          ["Medium", 1, true],
          ["High", 2, false],
        ]
      )

      const stillAlpha = await tx
        .select()
        .from(priorities)
        .where(eq(priorities.projectId, a.id))
      assert.strictEqual(stillAlpha.length, 2)
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => deletePriority({ priorityId: crypto.randomUUID() }, tx),
        NotFoundError
      )
    })
  })
})

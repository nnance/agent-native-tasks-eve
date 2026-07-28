import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import { createProject } from "../../../lib/actions/projects.ts"
import {
  createStatus,
  deleteStatus,
  listStatuses,
  updateStatus,
} from "../../../lib/actions/statuses.ts"
import type { Database } from "../../../lib/db/connect.ts"
import { priorities, statuses, tasks } from "../../../lib/db/schema.ts"
import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"
import { withRollback } from "../../support/db.ts"

/** Inserts one task directly, so this file does not depend on lib/actions/tasks.ts. */
async function seedTask(tx: Database, projectId: string, statusId: string) {
  const [priority] = await tx
    .select()
    .from(priorities)
    .where(eq(priorities.projectId, projectId))
    .orderBy(asc(priorities.order))
    .limit(1)

  await tx.insert(tasks).values({
    projectId,
    title: "Fixture",
    statusId,
    priorityId: priority!.id,
  })
}

describe("listStatuses", () => {
  // US-D1.1: statuses are per project and independent of every other project.
  it("returns only the given project's statuses, in order", async () => {
    await withRollback(async (tx) => {
      const a = await createProject({ name: "Alpha" }, tx)
      const b = await createProject({ name: "Beta" }, tx)

      await createStatus({ projectId: b.id, name: "Blocked" }, tx)

      const listed = await listStatuses({ projectId: a.id }, tx)

      assert.deepStrictEqual(
        listed.map((s) => s.name),
        ["To Do", "In Progress", "Done"]
      )
      assert.deepStrictEqual(
        listed.map((s) => s.order),
        [0, 1, 2]
      )
    })
  })
})

describe("createStatus", () => {
  it("appends the new status to the end of the project's list", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const created = await createStatus(
        { projectId: project.id, name: "Blocked" },
        tx
      )

      assert.strictEqual(created.order, 3)
      assert.strictEqual(created.isCompleted, false)

      const listed = await listStatuses({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        listed.map((s) => s.name),
        ["To Do", "In Progress", "Done", "Blocked"]
      )
    })
  })

  it("accepts an explicit completed flag", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const created = await createStatus(
        { projectId: project.id, name: "Shipped", isCompleted: true },
        tx
      )

      assert.strictEqual(created.isCompleted, true)
    })
  })

  it("rejects a blank name and an unknown project", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      await assert.rejects(
        () => createStatus({ projectId: project.id, name: "  " }, tx),
        z.ZodError
      )
      await assert.rejects(
        () => createStatus({ projectId: crypto.randomUUID(), name: "X" }, tx),
        NotFoundError
      )
    })
  })
})

describe("updateStatus", () => {
  it("renames a status without touching its order or flag", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const [first] = await listStatuses({ projectId: project.id }, tx)

      const renamed = await updateStatus(
        { statusId: first!.id, name: "Backlog" },
        tx
      )

      assert.strictEqual(renamed.name, "Backlog")
      assert.strictEqual(renamed.order, 0)
      assert.strictEqual(renamed.isCompleted, false)
    })
  })

  // US-D1.3: toggling the completed flag is a first-class edit.
  it("toggles the completed flag", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const done = listed.find((s) => s.name === "Done")!

      const reopened = await updateStatus(
        { statusId: done.id, isCompleted: false },
        tx
      )
      assert.strictEqual(reopened.isCompleted, false)

      const reclosed = await updateStatus(
        { statusId: done.id, isCompleted: true },
        tx
      )
      assert.strictEqual(reclosed.isCompleted, true)
    })
  })

  // US-D1.2: the defined order is respected everywhere, so a move must leave a
  // dense sequence with no gaps and no duplicates.
  it("moves a status to a new position and renumbers every sibling", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const done = listed.find((s) => s.name === "Done")!

      const moved = await updateStatus({ statusId: done.id, order: 0 }, tx)
      assert.strictEqual(moved.order, 0)

      const reordered = await listStatuses({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        reordered.map((s) => s.name),
        ["Done", "To Do", "In Progress"]
      )
      assert.deepStrictEqual(
        reordered.map((s) => s.order),
        [0, 1, 2]
      )
    })
  })

  it("clamps an out-of-range target to the end of the list", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const todo = listed.find((s) => s.name === "To Do")!

      await updateStatus({ statusId: todo.id, order: 99 }, tx)

      const reordered = await listStatuses({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        reordered.map((s) => s.name),
        ["In Progress", "Done", "To Do"]
      )
    })
  })

  it("renames and reorders in one call", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const done = listed.find((s) => s.name === "Done")!

      const updated = await updateStatus(
        { statusId: done.id, name: "Shipped", order: 0 },
        tx
      )

      assert.strictEqual(updated.name, "Shipped")
      assert.strictEqual(updated.order, 0)
    })
  })

  it("rejects an empty patch, a blank name and an unknown id", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const [first] = await listStatuses({ projectId: project.id }, tx)

      await assert.rejects(
        () => updateStatus({ statusId: first!.id } as never, tx),
        z.ZodError
      )
      await assert.rejects(
        () => updateStatus({ statusId: first!.id, name: " " }, tx),
        z.ZodError
      )
      await assert.rejects(
        () => updateStatus({ statusId: crypto.randomUUID(), name: "X" }, tx),
        NotFoundError
      )
    })
  })
})

describe("deleteStatus", () => {
  // US-D2.1: deleting an unused status succeeds, and closes the order gap.
  it("deletes an unused status and renumbers the survivors densely", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const inProgress = listed.find((s) => s.name === "In Progress")!

      const deleted = await deleteStatus({ statusId: inProgress.id }, tx)
      assert.deepStrictEqual(deleted, {
        id: inProgress.id,
        name: "In Progress",
      })

      const survivors = await listStatuses({ projectId: project.id }, tx)
      assert.deepStrictEqual(
        survivors.map((s) => s.name),
        ["To Do", "Done"]
      )
      assert.deepStrictEqual(
        survivors.map((s) => s.order),
        [0, 1]
      )
    })
  })

  // US-D2.2: blocked, with the reason and the remedy.
  it("blocks deletion of a status a task still uses", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const todo = listed.find((s) => s.name === "To Do")!

      await seedTask(tx, project.id, todo.id)

      await assert.rejects(
        () => deleteStatus({ statusId: todo.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /'To Do' is used by 1 task\./)
          assert.match(error.message, /Move those tasks to another status/)
          return true
        }
      )

      const survivors = await listStatuses({ projectId: project.id }, tx)
      assert.strictEqual(survivors.length, 3)
    })
  })

  // US-D2.3: the last remaining status cannot go, even when unused.
  it("blocks deletion of the last remaining status even when unused", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)

      await deleteStatus({ statusId: listed[1]!.id }, tx)
      await deleteStatus({ statusId: listed[2]!.id }, tx)

      await assert.rejects(
        () => deleteStatus({ statusId: listed[0]!.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /only status in 'Website'/)
          assert.match(error.message, /at least one status/)
          return true
        }
      )
    })
  })

  it("reports last-remaining, not in-use, when both block at once", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const listed = await listStatuses({ projectId: project.id }, tx)
      const todo = listed.find((s) => s.name === "To Do")!

      await deleteStatus({ statusId: listed[1]!.id }, tx)
      await deleteStatus({ statusId: listed[2]!.id }, tx)
      await seedTask(tx, project.id, todo.id)

      // The in-use message says "move those tasks to another status" — advice
      // the user cannot follow when this is the project's only status.
      await assert.rejects(
        () => deleteStatus({ statusId: todo.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /only status/)
          assert.doesNotMatch(error.message, /is used by/)
          return true
        }
      )
    })
  })

  it("leaves other projects' statuses alone", async () => {
    await withRollback(async (tx) => {
      const a = await createProject({ name: "Alpha" }, tx)
      const b = await createProject({ name: "Beta" }, tx)

      const alphaStatuses = await listStatuses({ projectId: a.id }, tx)
      await deleteStatus({ statusId: alphaStatuses[0]!.id }, tx)

      const betaStatuses = await listStatuses({ projectId: b.id }, tx)
      assert.deepStrictEqual(
        betaStatuses.map((s) => [s.name, s.order]),
        [
          ["To Do", 0],
          ["In Progress", 1],
          ["Done", 2],
        ]
      )

      const stillAlpha = await tx
        .select()
        .from(statuses)
        .where(eq(statuses.projectId, a.id))
      assert.strictEqual(stillAlpha.length, 2)
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => deleteStatus({ statusId: crypto.randomUUID() }, tx),
        NotFoundError
      )
    })
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import { listPriorities } from "../../../lib/actions/priorities.ts"
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "../../../lib/actions/projects.ts"
import { listStatuses } from "../../../lib/actions/statuses.ts"
import { createTask } from "../../../lib/actions/tasks.ts"
import type { Database } from "../../../lib/db/connect.ts"
import {
  priorities,
  projects,
  statuses,
  tasks,
} from "../../../lib/db/schema.ts"
import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
} from "../../../lib/domain/defaults.ts"
import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"
import { withRollback } from "../../support/db.ts"

/** Inserts one task directly, so this file does not depend on lib/actions/tasks.ts. */
async function seedTask(tx: Database, projectId: string, title: string) {
  const [status] = await tx
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.order))
    .limit(1)

  const [priority] = await tx
    .select()
    .from(priorities)
    .where(eq(priorities.projectId, projectId))
    .orderBy(asc(priorities.order))
    .limit(1)

  await tx.insert(tasks).values({
    projectId,
    title,
    statusId: status!.id,
    priorityId: priority!.id,
  })
}

describe("createProject", () => {
  // US-C1.2 / product spec §7.4: a new project is seeded so it is immediately
  // usable. The defaults are read back out of the database rather than off the
  // return value, so this proves the lib/domain/defaults.ts linkage rather
  // than echoing what createProject just wrote.
  it("seeds the byte-identical default statuses from lib/domain/defaults.ts", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const seeded = await listStatuses({ projectId: project.id }, tx)

      assert.deepStrictEqual(
        seeded.map((s) => ({ name: s.name, isCompleted: s.isCompleted })),
        DEFAULT_STATUSES.map((s) => ({
          name: s.name,
          isCompleted: s.isCompleted,
        }))
      )
      assert.deepStrictEqual(
        seeded.map((s) => s.order),
        [0, 1, 2]
      )
    })
  })

  it("seeds the byte-identical default priorities, with exactly one default", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const seeded = await listPriorities({ projectId: project.id }, tx)

      assert.deepStrictEqual(
        seeded.map((p) => ({ name: p.name, isDefault: p.isDefault })),
        DEFAULT_PRIORITIES.map((p) => ({
          name: p.name,
          isDefault: p.isDefault,
        }))
      )
      assert.strictEqual(seeded.filter((p) => p.isDefault).length, 1)
    })
  })

  it("trims the name and rejects a blank one", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "  Website  " }, tx)
      assert.strictEqual(project.name, "Website")

      // US-C1.1: a project needs a name; whitespace is not one.
      await assert.rejects(() => createProject({ name: "   " }, tx), z.ZodError)
    })
  })

  // US-C1.3 / US-A1.4: a task can be created in a brand-new project with no
  // additional setup — which is the whole point of seeding it on creation.
  it("leaves the project immediately usable for task creation", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Fresh" }, tx)

      const task = await createTask(
        { projectId: project.id, title: "First thing" },
        tx
      )

      assert.strictEqual(task.project.name, "Fresh")
      assert.strictEqual(task.status.name, "To Do")
      assert.strictEqual(task.priority.name, "Medium")
    })
  })

  it("rejects unknown keys rather than silently dropping them", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => createProject({ name: "Website", id: "smuggled" } as never, tx),
        z.ZodError
      )
    })
  })
})

describe("listProjects", () => {
  it("returns projects oldest first", async () => {
    await withRollback(async (tx) => {
      const first = await createProject({ name: "Alpha" }, tx)
      const second = await createProject({ name: "Beta" }, tx)

      const listed = await listProjects({}, tx)
      const ids = listed.map((p) => p.id)

      assert.ok(ids.indexOf(first.id) < ids.indexOf(second.id))
    })
  })
})

describe("renameProject", () => {
  // US-C2.2: the project's tasks, statuses and priorities are unaffected.
  it("changes only the name", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      await seedTask(tx, project.id, "Fix header")

      const renamed = await renameProject(
        { projectId: project.id, name: "Marketing site" },
        tx
      )
      assert.strictEqual(renamed.name, "Marketing site")
      assert.strictEqual(renamed.id, project.id)

      const remainingTasks = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, project.id))
      assert.strictEqual(remainingTasks.length, 1)

      const remainingStatuses = await tx
        .select()
        .from(statuses)
        .where(eq(statuses.projectId, project.id))
      assert.strictEqual(remainingStatuses.length, 3)

      const remainingPriorities = await tx
        .select()
        .from(priorities)
        .where(eq(priorities.projectId, project.id))
      assert.strictEqual(remainingPriorities.length, 3)
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => renameProject({ projectId: crypto.randomUUID(), name: "X" }, tx),
        NotFoundError
      )
    })
  })

  it("rejects a blank name", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      await assert.rejects(
        () => renameProject({ projectId: project.id, name: "  " }, tx),
        z.ZodError
      )
    })
  })
})

describe("deleteProject", () => {
  // US-C3.1: deleting an empty project succeeds and takes its lists with it.
  it("deletes an empty project and cascades its statuses and priorities", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Scratch" }, tx)

      const deleted = await deleteProject({ projectId: project.id }, tx)
      assert.deepStrictEqual(deleted, { id: project.id, name: "Scratch" })

      const remaining = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, project.id))
      assert.strictEqual(remaining.length, 0)

      const orphanStatuses = await tx
        .select()
        .from(statuses)
        .where(eq(statuses.projectId, project.id))
      assert.strictEqual(orphanStatuses.length, 0)

      const orphanPriorities = await tx
        .select()
        .from(priorities)
        .where(eq(priorities.projectId, project.id))
      assert.strictEqual(orphanPriorities.length, 0)
    })
  })

  // US-C3.2 / C3.3: blocked, and the message states the count and the remedy.
  it("blocks deletion when tasks remain, naming the count", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Design" }, tx)
      await seedTask(tx, project.id, "Sketch nav")
      await seedTask(tx, project.id, "Pick type scale")

      await assert.rejects(
        () => deleteProject({ projectId: project.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /Design/)
          assert.match(error.message, /2 tasks/)
          assert.match(error.message, /Delete or move those tasks first/)
          return true
        }
      )

      const survivors = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, project.id))
      assert.strictEqual(survivors.length, 1)
    })
  })

  it("singularizes the count for one blocking task", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Design" }, tx)
      await seedTask(tx, project.id, "Sketch nav")

      await assert.rejects(
        () => deleteProject({ projectId: project.id }, tx),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /1 task\./)
          return true
        }
      )
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => deleteProject({ projectId: crypto.randomUUID() }, tx),
        NotFoundError
      )
    })
  })
})

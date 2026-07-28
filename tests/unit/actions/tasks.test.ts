import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { listPriorities } from "../../../lib/actions/priorities.ts"
import { createProject } from "../../../lib/actions/projects.ts"
import { listStatuses, updateStatus } from "../../../lib/actions/statuses.ts"
import {
  bulkDeleteTasks,
  bulkUpdateTasks,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "../../../lib/actions/tasks.ts"
import type { Database } from "../../../lib/db/connect.ts"
import { tasks } from "../../../lib/db/schema.ts"
import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"
import { withRollback } from "../../support/db.ts"

/** A project plus its seeded lists, keyed by name for readable assertions. */
async function fixture(tx: Database, name: string) {
  const project = await createProject({ name }, tx)
  const projectStatuses = await listStatuses({ projectId: project.id }, tx)
  const projectPriorities = await listPriorities({ projectId: project.id }, tx)

  const byName = <T extends { name: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.name, row]))

  return {
    project,
    status: byName(projectStatuses),
    priority: byName(projectPriorities),
  }
}

describe("createTask", () => {
  // US-B1.3 / B1.4 / §4.4: the creation defaults, against a brand-new project
  // with no extra setup at all (US-C1.3, US-A1.4).
  it("defaults to the project's first status and default priority", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      assert.strictEqual(task.title, "Fix header")
      assert.strictEqual(task.project.name, "Website")
      assert.strictEqual(task.status.name, "To Do")
      assert.strictEqual(task.status.order, 0)
      assert.strictEqual(task.priority.name, "Medium")
      assert.strictEqual(task.priority.isDefault, true)
      assert.strictEqual(task.description, null)
    })
  })

  it("follows a reordered status list when picking the default status", async () => {
    await withRollback(async (tx) => {
      const { project, status } = await fixture(tx, "Website")

      await updateStatus({ statusId: status.get("Done")!.id, order: 0 }, tx)

      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )
      assert.strictEqual(task.status.name, "Done")
    })
  })

  it("accepts an explicit status and priority from the same project", async () => {
    await withRollback(async (tx) => {
      const { project, status, priority } = await fixture(tx, "Website")

      const task = await createTask(
        {
          projectId: project.id,
          title: "Fix header",
          description: "The logo overlaps the nav.",
          statusId: status.get("In Progress")!.id,
          priorityId: priority.get("High")!.id,
        },
        tx
      )

      assert.strictEqual(task.status.name, "In Progress")
      assert.strictEqual(task.priority.name, "High")
      assert.strictEqual(task.description, "The logo overlaps the nav.")
    })
  })

  // US-B1.5 / product spec §7 rule 2.
  it("rejects a status or priority from another project", async () => {
    await withRollback(async (tx) => {
      const a = await fixture(tx, "Alpha")
      const b = await fixture(tx, "Beta")

      await assert.rejects(
        () =>
          createTask(
            {
              projectId: a.project.id,
              title: "Cross-project",
              statusId: b.status.get("To Do")!.id,
            },
            tx
          ),
        (error: unknown) => {
          assert.ok(error instanceof RuleViolation)
          assert.match(error.message, /belongs to a different project/)
          assert.match(error.message, /'Alpha'/)
          return true
        }
      )

      await assert.rejects(
        () =>
          createTask(
            {
              projectId: a.project.id,
              title: "Cross-project",
              priorityId: b.priority.get("High")!.id,
            },
            tx
          ),
        RuleViolation
      )
    })
  })

  // US-B1.2: a task cannot be created without a title or without a project.
  it("requires a non-empty title and a project", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      await assert.rejects(
        () => createTask({ projectId: project.id, title: "   " }, tx),
        z.ZodError
      )
      await assert.rejects(
        () => createTask({ title: "No project" } as never, tx),
        z.ZodError
      )
      await assert.rejects(
        () => createTask({ projectId: crypto.randomUUID(), title: "X" }, tx),
        NotFoundError
      )
    })
  })

  it("stores a whitespace-only description as null", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)

      const task = await createTask(
        { projectId: project.id, title: "Fix header", description: "   " },
        tx
      )

      assert.strictEqual(task.description, null)
    })
  })
})

describe("getTask", () => {
  // US-B2.5: opening a task shows all of its fields, including the full text.
  it("returns the full description and the related chips", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const long = "line one\n\nline two, at some length, unabridged."

      const created = await createTask(
        { projectId: project.id, title: "Fix header", description: long },
        tx
      )

      const fetched = await getTask({ taskId: created.id }, tx)

      assert.strictEqual(fetched.description, long)
      assert.strictEqual(fetched.project.name, "Website")
      assert.strictEqual(fetched.status.name, "To Do")
      assert.strictEqual(fetched.priority.name, "Medium")
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => getTask({ taskId: crypto.randomUUID() }, tx),
        NotFoundError
      )
    })
  })
})

describe("updateTask", () => {
  it("edits the title", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      const updated = await updateTask(
        { taskId: task.id, title: "Fix the header" },
        tx
      )
      assert.strictEqual(updated.title, "Fix the header")
    })
  })

  // US-B4.2: the title cannot be cleared to empty.
  it("refuses to clear the title", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      await assert.rejects(
        () => updateTask({ taskId: task.id, title: "" }, tx),
        z.ZodError
      )
      await assert.rejects(
        () => updateTask({ taskId: task.id, title: "   " }, tx),
        z.ZodError
      )

      const unchanged = await getTask({ taskId: task.id }, tx)
      assert.strictEqual(unchanged.title, "Fix header")
    })
  })

  it("clears the description on null and preserves it when the key is absent", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const task = await createTask(
        { projectId: project.id, title: "Fix header", description: "Details." },
        tx
      )

      const titleOnly = await updateTask(
        { taskId: task.id, title: "Fix the header" },
        tx
      )
      assert.strictEqual(titleOnly.description, "Details.")

      const cleared = await updateTask(
        { taskId: task.id, description: null },
        tx
      )
      assert.strictEqual(cleared.description, null)
    })
  })

  // US-B5: moving a task's status is the same shared capability as an edit.
  it("moves the task's status", async () => {
    await withRollback(async (tx) => {
      const { project, status } = await fixture(tx, "Website")
      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      const moved = await updateTask(
        { taskId: task.id, statusId: status.get("Done")!.id },
        tx
      )

      assert.strictEqual(moved.status.name, "Done")
      assert.strictEqual(moved.status.isCompleted, true)
    })
  })

  // US-B4.4 / product spec §7 rule 1: a task's project is fixed at creation.
  // The schema has no projectId field at all, so an attempt to smuggle one in
  // is a loud parse failure rather than a silently stripped key.
  it("makes a project change inexpressible", async () => {
    await withRollback(async (tx) => {
      const a = await fixture(tx, "Alpha")
      const b = await fixture(tx, "Beta")

      const task = await createTask(
        { projectId: a.project.id, title: "Stays put" },
        tx
      )

      await assert.rejects(
        () =>
          updateTask({ taskId: task.id, projectId: b.project.id } as never, tx),
        z.ZodError
      )

      const [stored] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, task.id))
      assert.strictEqual(stored?.projectId, a.project.id)
    })
  })

  // US-B4.3: status and priority choices are limited to the task's own project.
  it("rejects a status or priority from another project", async () => {
    await withRollback(async (tx) => {
      const a = await fixture(tx, "Alpha")
      const b = await fixture(tx, "Beta")

      const task = await createTask(
        { projectId: a.project.id, title: "Scoped" },
        tx
      )

      await assert.rejects(
        () =>
          updateTask(
            { taskId: task.id, statusId: b.status.get("Done")!.id },
            tx
          ),
        RuleViolation
      )
      await assert.rejects(
        () =>
          updateTask(
            { taskId: task.id, priorityId: b.priority.get("High")!.id },
            tx
          ),
        RuleViolation
      )

      const unchanged = await getTask({ taskId: task.id }, tx)
      assert.strictEqual(unchanged.status.name, "To Do")
      assert.strictEqual(unchanged.priority.name, "Medium")
    })
  })

  it("rejects an empty patch and an unknown id", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      await assert.rejects(
        () => updateTask({ taskId: task.id } as never, tx),
        z.ZodError
      )
      await assert.rejects(
        () => updateTask({ taskId: crypto.randomUUID(), title: "X" }, tx),
        NotFoundError
      )
    })
  })
})

describe("listTasks", () => {
  /** Three open tasks of ascending priority plus one completed task. */
  async function scenario(tx: Database) {
    const built = await fixture(tx, "Website")
    const { project, status, priority } = built

    const low = await createTask(
      {
        projectId: project.id,
        title: "Low first created",
        priorityId: priority.get("Low")!.id,
      },
      tx
    )
    const highOld = await createTask(
      {
        projectId: project.id,
        title: "High older",
        description: "mentions widgets",
        priorityId: priority.get("High")!.id,
      },
      tx
    )
    const highNew = await createTask(
      {
        projectId: project.id,
        title: "High newer",
        priorityId: priority.get("High")!.id,
      },
      tx
    )
    const done = await createTask(
      {
        projectId: project.id,
        title: "Done widgets",
        statusId: status.get("Done")!.id,
        priorityId: priority.get("High")!.id,
      },
      tx
    )

    return { ...built, low, highOld, highNew, done }
  }

  // US-B2.2 / US-B2.4 / §8.1.
  it("orders by priority desc then creation date asc, with completed last", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const listed = await listTasks(
        { projectId: s.project.id, includeCompleted: true },
        tx
      )

      assert.deepStrictEqual(
        listed.map((t) => t.title),
        ["High older", "High newer", "Low first created", "Done widgets"]
      )
    })
  })

  // Regression: `tasks.created_at` used to default to `now()`, which Postgres
  // evaluates as `transaction_timestamp()` — constant for a whole transaction.
  // Tasks created together therefore tied on the sort key and came back in
  // planner-defined order, which is a parity risk (§5, §6) as well as a source
  // of test flake. The default is `clock_timestamp()` now, so creation order
  // survives even inside one transaction.
  it("keeps creation order for same-priority tasks created in one transaction", async () => {
    await withRollback(async (tx) => {
      const built = await fixture(tx, `Ordering ${crypto.randomUUID()}`)
      const high = built.priority.get("High")!.id

      const titles = ["First", "Second", "Third", "Fourth", "Fifth"]
      for (const title of titles) {
        await createTask({ projectId: built.project.id, title, priorityId: high }, tx)
      }

      const listed = await listTasks({ projectId: built.project.id }, tx)
      assert.deepStrictEqual(listed.map((t) => t.title), titles)

      // The timestamps must actually differ — if they tie, the assertion above
      // only passed by luck of the planner.
      const stamps = listed.map((t) => t.createdAt.getTime())
      assert.strictEqual(
        new Set(stamps).size,
        titles.length,
        "created_at collided inside one transaction — is the default still clock_timestamp()?"
      )
    })
  })

  // US-B2.3: completed tasks are hidden by default.
  it("hides completed tasks unless includeCompleted is true", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const open = await listTasks({ projectId: s.project.id }, tx)
      assert.ok(!open.some((t) => t.title === "Done widgets"))
      assert.strictEqual(open.length, 3)

      const all = await listTasks(
        { projectId: s.project.id, includeCompleted: true },
        tx
      )
      assert.strictEqual(all.length, 4)
    })
  })

  it("lets an explicit statusId filter override the completed toggle", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const doneOnly = await listTasks(
        { projectId: s.project.id, statusId: s.status.get("Done")!.id },
        tx
      )

      assert.deepStrictEqual(
        doneOnly.map((t) => t.title),
        ["Done widgets"]
      )
    })
  })

  it("filters by priority, combinable with the project filter", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const high = await listTasks(
        { projectId: s.project.id, priorityId: s.priority.get("High")!.id },
        tx
      )

      assert.deepStrictEqual(
        high.map((t) => t.title),
        ["High older", "High newer"]
      )
    })
  })

  // US-B3.3: search matches title or description; US-B3.4: it combines with
  // the tag filters and applies within the filtered set.
  it("searches title and description, case-insensitively", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const byDescription = await listTasks(
        { projectId: s.project.id, search: "WIDGETS" },
        tx
      )
      assert.deepStrictEqual(
        byDescription.map((t) => t.title),
        ["High older"]
      )

      const withCompleted = await listTasks(
        { projectId: s.project.id, search: "widgets", includeCompleted: true },
        tx
      )
      assert.deepStrictEqual(
        withCompleted.map((t) => t.title),
        ["High older", "Done widgets"]
      )

      const byTitleAndPriority = await listTasks(
        {
          projectId: s.project.id,
          search: "high",
          priorityId: s.priority.get("High")!.id,
        },
        tx
      )
      assert.deepStrictEqual(
        byTitleAndPriority.map((t) => t.title),
        ["High older", "High newer"]
      )
    })
  })

  it("scopes to one project when asked", async () => {
    await withRollback(async (tx) => {
      const a = await fixture(tx, "Alpha")
      const b = await fixture(tx, "Beta")

      await createTask({ projectId: a.project.id, title: "In Alpha" }, tx)
      await createTask({ projectId: b.project.id, title: "In Beta" }, tx)

      const alphaTasks = await listTasks({ projectId: a.project.id }, tx)
      assert.deepStrictEqual(
        alphaTasks.map((t) => t.title),
        ["In Alpha"]
      )
    })
  })

  it("returns an empty list when nothing matches", async () => {
    await withRollback(async (tx) => {
      const s = await scenario(tx)

      const none = await listTasks(
        { projectId: s.project.id, search: "nothing matches this" },
        tx
      )
      assert.deepStrictEqual(none, [])
    })
  })

  it("rejects an unknown filter key", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => listTasks({ assignee: "nick" } as never, tx),
        z.ZodError
      )
    })
  })
})

describe("deleteTask", () => {
  it("removes the task and reports what went", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const task = await createTask(
        { projectId: project.id, title: "Fix header" },
        tx
      )

      const deleted = await deleteTask({ taskId: task.id }, tx)
      assert.deepStrictEqual(deleted, { id: task.id, title: "Fix header" })

      await assert.rejects(
        () => getTask({ taskId: task.id }, tx),
        NotFoundError
      )
    })
  })

  it("raises NotFoundError for an unknown id", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => deleteTask({ taskId: crypto.randomUUID() }, tx),
        NotFoundError
      )
    })
  })
})

describe("bulkUpdateTasks", () => {
  it("applies one status across several tasks", async () => {
    await withRollback(async (tx) => {
      const { project, status } = await fixture(tx, "Website")

      const one = await createTask({ projectId: project.id, title: "One" }, tx)
      const two = await createTask({ projectId: project.id, title: "Two" }, tx)

      const updated = await bulkUpdateTasks(
        {
          taskIds: [one.id, two.id],
          statusId: status.get("In Progress")!.id,
        },
        tx
      )

      assert.strictEqual(updated.length, 2)
      assert.ok(updated.every((t) => t.status.name === "In Progress"))
    })
  })

  // US-F5.3: on approval all stated changes are applied, on decline nothing
  // changes — so a batch is never partially applied.
  it("writes nothing when any id is missing", async () => {
    await withRollback(async (tx) => {
      const { project, status } = await fixture(tx, "Website")
      const one = await createTask({ projectId: project.id, title: "One" }, tx)
      const ghost = crypto.randomUUID()

      await assert.rejects(
        () =>
          bulkUpdateTasks(
            {
              taskIds: [one.id, ghost],
              statusId: status.get("Done")!.id,
            },
            tx
          ),
        (error: unknown) => {
          assert.ok(error instanceof NotFoundError)
          assert.match(error.message, new RegExp(ghost))
          return true
        }
      )

      const untouched = await getTask({ taskId: one.id }, tx)
      assert.strictEqual(untouched.status.name, "To Do")
    })
  })

  it("refuses one status applied across two projects, writing nothing", async () => {
    await withRollback(async (tx) => {
      const a = await fixture(tx, "Alpha")
      const b = await fixture(tx, "Beta")

      const inA = await createTask(
        { projectId: a.project.id, title: "In Alpha" },
        tx
      )
      const inB = await createTask(
        { projectId: b.project.id, title: "In Beta" },
        tx
      )

      await assert.rejects(
        () =>
          bulkUpdateTasks(
            {
              taskIds: [inA.id, inB.id],
              statusId: a.status.get("Done")!.id,
            },
            tx
          ),
        RuleViolation
      )

      assert.strictEqual(
        (await getTask({ taskId: inA.id }, tx)).status.name,
        "To Do"
      )
      assert.strictEqual(
        (await getTask({ taskId: inB.id }, tx)).status.name,
        "To Do"
      )
    })
  })

  it("rejects an empty batch and a patch with nothing to apply", async () => {
    await withRollback(async (tx) => {
      const { project, status } = await fixture(tx, "Website")
      const one = await createTask({ projectId: project.id, title: "One" }, tx)

      await assert.rejects(
        () =>
          bulkUpdateTasks(
            { taskIds: [], statusId: status.get("Done")!.id },
            tx
          ),
        z.ZodError
      )
      await assert.rejects(
        () => bulkUpdateTasks({ taskIds: [one.id] } as never, tx),
        z.ZodError
      )
    })
  })
})

describe("bulkDeleteTasks", () => {
  it("deletes every task in the batch", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const one = await createTask({ projectId: project.id, title: "One" }, tx)
      const two = await createTask({ projectId: project.id, title: "Two" }, tx)

      const deleted = await bulkDeleteTasks({ taskIds: [one.id, two.id] }, tx)

      assert.deepStrictEqual(deleted.map((t) => t.title).sort(), ["One", "Two"])
      assert.deepStrictEqual(await listTasks({ projectId: project.id }, tx), [])
    })
  })

  it("deletes nothing when any id is missing", async () => {
    await withRollback(async (tx) => {
      const project = await createProject({ name: "Website" }, tx)
      const one = await createTask({ projectId: project.id, title: "One" }, tx)

      await assert.rejects(
        () => bulkDeleteTasks({ taskIds: [one.id, crypto.randomUUID()] }, tx),
        NotFoundError
      )

      const survivors = await listTasks({ projectId: project.id }, tx)
      assert.strictEqual(survivors.length, 1)
    })
  })

  it("rejects an empty batch", async () => {
    await withRollback(async (tx) => {
      await assert.rejects(
        () => bulkDeleteTasks({ taskIds: [] }, tx),
        z.ZodError
      )
    })
  })
})

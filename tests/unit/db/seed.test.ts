import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { eq } from "drizzle-orm"

import { priorities, projects, statuses } from "../../../lib/db/schema.ts"
import { describeSeedState, ensureSeeded } from "../../../lib/db/seed.ts"
import { withEmptyDb } from "../../support/db.ts"

/**
 * `ensureSeeded(database)`'s injectable handle has existed since Phase 0 but
 * was never exercised against an actual transaction on an actually-empty
 * database — the boot-hook-on-a-fresh-install combination. This closes it.
 *
 * The whole suite runs inside one rolled-back transaction, so the table wipe
 * is invisible to every other session and the real test database is left
 * exactly as it was found.
 */
describe("ensureSeeded against an empty database", () => {
  it("seeds the starter project with the documented defaults, exactly once", async () => {
    await withEmptyDb(async (tx) => {
      // US-A1.1: a fresh install ends up with exactly one project.
      const first = await ensureSeeded(tx)
      assert.strictEqual(first.seeded, true)

      const state = await describeSeedState(tx)
      assert.strictEqual(state.project?.name, "Personal")
      assert.strictEqual(state.project?.id, first.projectId)

      // US-A1.2: To Do / In Progress / Done, in order, Done completed.
      assert.deepStrictEqual(
        state.statuses.map((s) => [s.name, s.order, s.isCompleted]),
        [
          ["To Do", 0, false],
          ["In Progress", 1, false],
          ["Done", 2, true],
        ]
      )

      // US-A1.3: Low / Medium / High, in order, Medium the default.
      assert.deepStrictEqual(
        state.priorities.map((p) => [p.name, p.order, p.isDefault]),
        [
          ["Low", 0, false],
          ["Medium", 1, true],
          ["High", 2, false],
        ]
      )

      // US-A1.5: seeding happens exactly once. A second call must be a no-op
      // reporting the same project, not a second starter project.
      const second = await ensureSeeded(tx)
      assert.strictEqual(second.seeded, false)
      assert.strictEqual(second.projectId, first.projectId)

      const allProjects = await tx.select().from(projects)
      assert.strictEqual(allProjects.length, 1)

      const allStatuses = await tx
        .select()
        .from(statuses)
        .where(eq(statuses.projectId, first.projectId))
      assert.strictEqual(allStatuses.length, 3)

      const allPriorities = await tx
        .select()
        .from(priorities)
        .where(eq(priorities.projectId, first.projectId))
      assert.strictEqual(allPriorities.length, 3)
    })
  })

  it("is a no-op when any project already exists, whatever it is named", async () => {
    await withEmptyDb(async (tx) => {
      // Idempotency is keyed on the projects table being empty, never on a
      // name match — a user who renamed or replaced "Personal" must not get
      // the starter data back (US-A1.5).
      const [existing] = await tx
        .insert(projects)
        .values({ name: "Not Personal" })
        .returning({ id: projects.id })

      const result = await ensureSeeded(tx)

      assert.strictEqual(result.seeded, false)
      assert.strictEqual(result.projectId, existing?.id)

      const seededStatuses = await tx.select().from(statuses)
      assert.strictEqual(seededStatuses.length, 0)
    })
  })
})

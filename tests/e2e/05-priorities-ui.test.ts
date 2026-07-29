/**
 * Epic E — per-project priority management (US-E1 … US-E2).
 *
 * As with statuses, `deletePriority` checks last-remaining **before** in-use,
 * and the assertions below follow the code rather than the story's ordering.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { tid, tidPrefix } from "./harness/browser.ts"
import {
  listPriorityRows,
  listTaskRows,
  priorityNamed,
  seededProject,
} from "./harness/db.ts"
import {
  makeMinimalProject,
  makePriority,
  makeProject,
  makeTask,
  projectLists,
} from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("05-priorities-ui")

/**
 * `manage-project-select` renders as soon as the **projects** query resolves,
 * which is not the same moment the priorities panel has rows: that is a separate
 * query, keyed by the selected project. Under a slow database the two can be
 * seconds apart, and every test below clicks a control inside a row — so
 * without the second wait they intermittently fail with "Element not found"
 * on a row the app was still fetching. Observed on a full-suite run; each of
 * these passed on its own.
 *
 * Waiting for the loading state to clear, rather than for a row, covers the
 * empty and error renderings too.
 */
async function openLists(): Promise<void> {
  await suite.open()
  await suite.browser.click(tid("tab-lists"))
  await suite.browser.waitFor(tid("manage-project-select"))
  await suite.browser.waitGone(tid("priorities-panel-loading"))
}

// ---------------------------------------------------------------- US-E1

test("US-E1.1: priorities are managed per project and each project's are independent", async () => {
  const { browser } = suite
  const seeded = await seededProject()
  const other = await makeProject("Website")
  await makePriority(other.id, "Critical")

  await openLists()
  await browser.waitCount(tidPrefix("priority-row-"), 3)
  assert.deepEqual(await browser.texts(tidPrefix("priority-name-")), [
    "Low",
    "Medium",
    "High",
  ])

  await browser.select(tid("manage-project-select"), other.id)
  await browser.waitCount(tidPrefix("priority-row-"), 4)
  assert.deepEqual(await browser.texts(tidPrefix("priority-name-")), [
    "Low",
    "Medium",
    "High",
    "Critical",
  ])

  assert.equal((await listPriorityRows(seeded.id)).length, 3)
})

test("US-E1.2: a priority can be created, renamed and reordered, and reordering re-sorts the task list", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({
    projectId: project.id,
    title: "The low one",
    priorityId: lists.low.id,
  })
  await makeTask({
    projectId: project.id,
    title: "The high one",
    priorityId: lists.high.id,
  })

  await suite.open()
  assert.deepEqual(await browser.texts(tidPrefix("task-title-")), [
    "The high one",
    "The low one",
  ])

  await browser.click(tid("tab-lists"))
  await browser.waitFor(tid("manage-project-select"))

  await browser.fill(tid("priority-create-input"), "Critical")
  await browser.click(tid("priority-create-submit"))
  await browser.waitCount(tidPrefix("priority-row-"), 4)

  const critical = await priorityNamed(project.id, "Critical")
  await browser.click(tid(`priority-rename-${critical.id}`))
  await browser.waitFor(tid(`priority-rename-${critical.id}-input`))
  await browser.fill(tid(`priority-rename-${critical.id}-input`), "Urgent")
  await browser.click(tid(`priority-rename-${critical.id}-submit`))
  await browser.waitTextIn(tid(`priority-name-${critical.id}`), "Urgent")

  // Move Low to the top of urgency: order 0 -> 2 means it outranks High.
  await browser.click(tid(`priority-down-${lists.low.id}`))
  await browser.waitTexts(tidPrefix("priority-name-"), [
    "Medium",
    "Low",
    "High",
    "Urgent",
  ])
  await browser.click(tid(`priority-down-${lists.low.id}`))
  await browser.waitTexts(tidPrefix("priority-name-"), [
    "Medium",
    "High",
    "Low",
    "Urgent",
  ])

  assert.deepEqual(
    (await listPriorityRows(project.id)).map((row) => [row.name, row.order]),
    [
      ["Medium", 0],
      ["High", 1],
      ["Low", 2],
      ["Urgent", 3],
    ]
  )

  // §8.2: the order is respected everywhere, including the task list's sort.
  await browser.click(tid("tab-tasks"))
  await browser.waitTexts(tidPrefix("task-title-"), [
    "The low one",
    "The high one",
  ])
})

test("US-E1.3: exactly one default exists, and a new task takes it", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await openLists()
  assert.equal(
    await browser.visible(tid(`priority-default-badge-${lists.medium.id}`)),
    true
  )

  await browser.click(tid(`priority-set-default-${lists.high.id}`))
  await browser.waitFor(tid(`priority-default-badge-${lists.high.id}`))

  const rows = await listPriorityRows(project.id)
  assert.deepEqual(
    rows.filter((row) => row.isDefault).map((row) => row.name),
    ["High"]
  )
  assert.equal(
    await browser.visible(tid(`priority-set-default-${lists.medium.id}`)),
    true
  )

  // A task created without a priority now takes the new default.
  await browser.click(tid("tab-tasks"))
  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.fill(tid("task-form-title"), "Takes the new default")
  await browser.click(tid("task-form-submit"))
  await browser.waitText("Takes the new default")

  const [task] = await listTaskRows(project.id)
  assert.equal(task?.priorityId, lists.high.id)
})

test("US-E1.4: renaming a priority shows on existing task chips without a reload", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "Some work" })

  await openLists()
  await browser.click(tid(`priority-rename-${lists.medium.id}`))
  await browser.waitFor(tid(`priority-rename-${lists.medium.id}-input`))
  await browser.fill(tid(`priority-rename-${lists.medium.id}-input`), "Normal")
  await browser.click(tid(`priority-rename-${lists.medium.id}-submit`))
  await browser.waitTextIn(tid(`priority-name-${lists.medium.id}`), "Normal")

  await browser.click(tid("tab-tasks"))
  await browser.waitTextIn(tid(`task-priority-chip-${task.id}`), "Normal")
})

// ---------------------------------------------------------------- US-E2

test("US-E2.1: deleting an unused priority succeeds", async () => {
  const { browser } = suite
  const project = await seededProject()
  const extra = await makePriority(project.id, "Critical")

  await openLists()
  await browser.click(tid(`priority-delete-${extra.id}`))
  await browser.waitFor(tid(`delete-priority-${extra.id}-dialog`))
  await browser.click(tid(`delete-priority-${extra.id}-confirm`))
  await browser.waitGone(tid(`priority-row-${extra.id}`))

  assert.deepEqual(
    (await listPriorityRows(project.id)).map((row) => row.name),
    ["Low", "Medium", "High"]
  )
})

test("US-E2.2: deleting a priority that tasks use is blocked, with the reason and the remedy", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({ projectId: project.id, title: "One" })

  await openLists()
  await browser.click(tid(`priority-delete-${lists.medium.id}`))
  await browser.waitFor(tid(`delete-priority-${lists.medium.id}-dialog`))
  await browser.click(tid(`delete-priority-${lists.medium.id}-confirm`))
  await browser.waitFor(tid(`delete-priority-${lists.medium.id}-error`))

  assert.equal(
    await browser.text(tid(`delete-priority-${lists.medium.id}-error`)),
    "Priority 'Medium' is used by 1 task. Move those tasks to another " +
      "priority (or delete them) first, then delete the priority."
  )
  assert.equal((await listPriorityRows(project.id)).length, 3)
})

test("US-E2.3: deleting the project's last remaining priority is blocked even when unused", async () => {
  const { browser } = suite
  const { project, priority } = await makeMinimalProject("Minimal")

  await openLists()
  await browser.select(tid("manage-project-select"), project.id)
  await browser.waitCount(tidPrefix("priority-row-"), 1)

  await browser.click(tid(`priority-delete-${priority.id}`))
  await browser.waitFor(tid(`delete-priority-${priority.id}-dialog`))
  await browser.click(tid(`delete-priority-${priority.id}-confirm`))
  await browser.waitFor(tid(`delete-priority-${priority.id}-error`))

  assert.equal(
    await browser.text(tid(`delete-priority-${priority.id}-error`)),
    "'Low' is the only priority in 'Minimal'. Every project must keep at " +
      "least one priority, so it cannot be deleted. Create another priority " +
      "first."
  )
  assert.equal((await listPriorityRows(project.id)).length, 1)
})

test("US-E2.4: deleting the default reassigns it to the first priority by order", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await openLists()
  await browser.click(tid(`priority-delete-${lists.medium.id}`))
  await browser.waitFor(tid(`delete-priority-${lists.medium.id}-dialog`))
  await browser.click(tid(`delete-priority-${lists.medium.id}-confirm`))
  await browser.waitGone(tid(`priority-row-${lists.medium.id}`))

  const rows = await listPriorityRows(project.id)
  assert.deepEqual(
    rows.map((row) => [row.name, row.order, row.isDefault]),
    [
      ["Low", 0, true],
      ["High", 1, false],
    ]
  )

  await browser.waitFor(tid(`priority-default-badge-${lists.low.id}`))
  assert.equal(
    await browser.visible(tid(`priority-set-default-${lists.high.id}`)),
    true
  )
})

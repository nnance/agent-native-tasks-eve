/**
 * Epic D — per-project status management (US-D1 … US-D2).
 *
 * Note the guard order in `deleteStatus`: last-remaining is checked **before**
 * in-use, deliberately (a project whose only status is in use has nowhere to
 * reassign those tasks to, so the in-use remedy would be a dead end). The
 * assertions below match that order rather than the order the story lists it.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { tid, tidPrefix } from "./harness/browser.ts"
import { listStatusRows, seededProject, statusNamed } from "./harness/db.ts"
import {
  makeMinimalProject,
  makeProject,
  makeStatus,
  makeTask,
  projectLists,
} from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("04-statuses-ui")

/**
 * `manage-project-select` renders as soon as the **projects** query resolves,
 * which is not the same moment the statuses panel has rows: that is a separate
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
  await suite.browser.waitGone(tid("statuses-panel-loading"))
}

// ---------------------------------------------------------------- US-D1

test("US-D1.1: statuses are managed per project and each project's are independent", async () => {
  const { browser } = suite
  const seeded = await seededProject()
  const other = await makeProject("Website")
  await makeStatus(other.id, "Blocked")

  await openLists()
  await browser.waitCount(tidPrefix("status-row-"), 3)
  assert.deepEqual(await browser.texts(tidPrefix("status-name-")), [
    "To Do",
    "In Progress",
    "Done",
  ])

  await browser.select(tid("manage-project-select"), other.id)
  await browser.waitCount(tidPrefix("status-row-"), 4)
  assert.deepEqual(await browser.texts(tidPrefix("status-name-")), [
    "To Do",
    "In Progress",
    "Done",
    "Blocked",
  ])

  // The seeded project is untouched by the other project's extra status.
  assert.equal((await listStatusRows(seeded.id)).length, 3)
})

test("US-D1.2: a status can be created, renamed and reordered, and the order is respected", async () => {
  const { browser } = suite
  const project = await seededProject()
  const task = await makeTask({ projectId: project.id, title: "Some work" })

  await openLists()

  await browser.fill(tid("status-create-input"), "Blocked")
  await browser.click(tid("status-create-submit"))
  await browser.waitCount(tidPrefix("status-row-"), 4)
  assert.equal(
    (await listStatusRows(project.id)).map((row) => row.name).join(","),
    "To Do,In Progress,Done,Blocked"
  )

  const blocked = await statusNamed(project.id, "Blocked")
  await browser.click(tid(`status-rename-${blocked.id}`))
  await browser.waitFor(tid(`status-rename-${blocked.id}-input`))
  await browser.fill(tid(`status-rename-${blocked.id}-input`), "On hold")
  await browser.click(tid(`status-rename-${blocked.id}-submit`))
  await browser.waitTextIn(tid(`status-name-${blocked.id}`), "On hold")

  // Up twice: 3 -> 2 -> 1. Each click needs its own settle point, because a
  // mutation plus invalidation plus refetch is several round trips and
  // `click` returns the moment the event dispatches.
  await browser.click(tid(`status-up-${blocked.id}`))
  await browser.waitTexts(tidPrefix("status-name-"), [
    "To Do",
    "In Progress",
    "On hold",
    "Done",
  ])
  await browser.click(tid(`status-up-${blocked.id}`))
  await browser.waitTexts(tidPrefix("status-name-"), [
    "To Do",
    "On hold",
    "In Progress",
    "Done",
  ])

  assert.deepEqual(
    (await listStatusRows(project.id)).map((row) => [row.name, row.order]),
    [
      ["To Do", 0],
      ["On hold", 1],
      ["In Progress", 2],
      ["Done", 3],
    ]
  )

  // The defined order is respected everywhere statuses appear (§8.2).
  await browser.click(tid("tab-tasks"))
  assert.deepEqual(
    await browser.texts(`${tid(`task-status-select-${task.id}`)} option`),
    ["To Do", "On hold", "In Progress", "Done"]
  )
})

test("US-D1.3: toggling a status's completed flag applies the completed display rules at once", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "In flight" })

  await suite.open()
  assert.equal(await browser.visible(tid(`task-row-${task.id}`)), true)

  await browser.click(tid("tab-lists"))
  await browser.waitFor(tid(`status-completed-${lists.toDo.id}`))
  await browser.click(tid(`status-completed-${lists.toDo.id}`))
  await browser.waitAttr(
    tid(`status-row-${lists.toDo.id}`),
    "data-completed",
    "true"
  )

  const [toDo] = await listStatusRows(project.id)
  assert.equal(toDo?.isCompleted, true)

  await browser.click(tid("tab-tasks"))
  await browser.waitGone(tid(`task-row-${task.id}`))

  await browser.click(tid("show-completed-toggle"))
  await browser.waitFor(tid(`task-row-${task.id}`))
  assert.equal(
    await browser.attr(tid(`task-row-${task.id}`), "data-completed"),
    "true"
  )
})

test("US-D1.4: renaming a status shows on existing task chips without a reload", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "Some work" })

  await openLists()
  await browser.click(tid(`status-rename-${lists.toDo.id}`))
  await browser.waitFor(tid(`status-rename-${lists.toDo.id}-input`))
  await browser.fill(tid(`status-rename-${lists.toDo.id}-input`), "Backlog")
  await browser.click(tid(`status-rename-${lists.toDo.id}-submit`))
  await browser.waitTextIn(tid(`status-name-${lists.toDo.id}`), "Backlog")

  await browser.click(tid("tab-tasks"))
  await browser.waitTextIn(tid(`task-status-chip-${task.id}`), "Backlog")
})

// ---------------------------------------------------------------- US-D2

test("US-D2.1: deleting an unused status succeeds", async () => {
  const { browser } = suite
  const project = await seededProject()
  const extra = await makeStatus(project.id, "Blocked")

  await openLists()
  await browser.click(tid(`status-delete-${extra.id}`))
  await browser.waitFor(tid(`delete-status-${extra.id}-dialog`))
  await browser.click(tid(`delete-status-${extra.id}-confirm`))
  await browser.waitGone(tid(`status-row-${extra.id}`))

  assert.deepEqual(
    (await listStatusRows(project.id)).map((row) => row.name),
    ["To Do", "In Progress", "Done"]
  )
})

test("US-D2.2: deleting a status that tasks use is blocked, with the reason and the remedy", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({ projectId: project.id, title: "One" })
  await makeTask({ projectId: project.id, title: "Two" })

  await openLists()
  await browser.click(tid(`status-delete-${lists.toDo.id}`))
  await browser.waitFor(tid(`delete-status-${lists.toDo.id}-dialog`))
  await browser.click(tid(`delete-status-${lists.toDo.id}-confirm`))
  await browser.waitFor(tid(`delete-status-${lists.toDo.id}-error`))

  assert.equal(
    await browser.text(tid(`delete-status-${lists.toDo.id}-error`)),
    "Status 'To Do' is used by 2 tasks. Move those tasks to another status " +
      "(or delete them) first, then delete the status."
  )
  assert.equal((await listStatusRows(project.id)).length, 3)
})

test("US-D2.3: deleting the project's last remaining status is blocked even when unused", async () => {
  const { browser } = suite
  const { project, status: remaining } = await makeMinimalProject("Minimal")

  await openLists()
  await browser.select(tid("manage-project-select"), project.id)
  await browser.waitCount(tidPrefix("status-row-"), 1)

  await browser.click(tid(`status-delete-${remaining.id}`))
  await browser.waitFor(tid(`delete-status-${remaining.id}-dialog`))
  await browser.click(tid(`delete-status-${remaining.id}-confirm`))
  await browser.waitFor(tid(`delete-status-${remaining.id}-error`))

  assert.equal(
    await browser.text(tid(`delete-status-${remaining.id}-error`)),
    "'To Do' is the only status in 'Minimal'. Every project must keep at " +
      "least one status, so it cannot be deleted. Create another status first."
  )
  assert.equal((await listStatusRows(project.id)).length, 1)
})

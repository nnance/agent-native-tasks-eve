/**
 * Epic C — project management through the direct UI (US-C1 … US-C3).
 *
 * The blocked-delete message is asserted **verbatim**. Product spec §9 and
 * US-C3.3 make that string a deliverable, and US-F3.4 has the agent relay the
 * same one, so a paraphrase in either interface is a real regression.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { tid, tidPrefix } from "./harness/browser.ts"
import {
  countProjects,
  findProjectByName,
  listPriorityRows,
  listStatusRows,
  listTaskRows,
  seededProject,
} from "./harness/db.ts"
import { makeProject, makeTask, projectLists } from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("03-projects-ui")

async function openLists(): Promise<void> {
  await suite.open()
  await suite.browser.click(tid("tab-lists"))
  await suite.browser.waitFor(tid("project-create-input"))
}

// ---------------------------------------------------------------- US-C1

test("US-C1.1/1.2: a new project is seeded with the default statuses and priorities", async () => {
  const { browser } = suite
  await openLists()

  await browser.fill(tid("project-create-input"), "Website")
  await browser.click(tid("project-create-submit"))
  await browser.waitText("Website")

  const project = await findProjectByName("Website")
  assert.ok(project)

  assert.deepEqual(
    (await listStatusRows(project.id)).map((status) => [
      status.name,
      status.order,
      status.isCompleted,
    ]),
    [
      ["To Do", 0, false],
      ["In Progress", 1, false],
      ["Done", 2, true],
    ]
  )

  assert.deepEqual(
    (await listPriorityRows(project.id)).map((priority) => [
      priority.name,
      priority.order,
      priority.isDefault,
    ]),
    [
      ["Low", 0, false],
      ["Medium", 1, true],
      ["High", 2, false],
    ]
  )
})

/**
 * Regression: the create field used to keep its text after a successful
 * create, so a second click on Add submitted the same name again and produced
 * a duplicate project. Asserting the cleared field alone would not catch a
 * re-introduction that clears late, so this also clicks a second time and
 * asserts the project count did not move.
 */
test("US-C1: the create field clears after a successful create, so Add cannot duplicate", async () => {
  const { browser } = suite
  await openLists()

  await browser.fill(tid("project-create-input"), "Website")
  await browser.click(tid("project-create-submit"))
  await browser.waitText("Website")

  assert.equal(
    await browser.value(tid("project-create-input")),
    "",
    "create field kept its text after a successful create"
  )

  const afterFirst = await countProjects()
  await browser.click(tid("project-create-submit"))

  assert.equal(
    await countProjects(),
    afterFirst,
    "clicking Add again re-submitted the previous name"
  )
})

test("US-C1.3: a task can be created in a brand-new project immediately", async () => {
  const { browser } = suite
  await openLists()

  await browser.fill(tid("project-create-input"), "Website")
  await browser.click(tid("project-create-submit"))
  await browser.waitText("Website")

  const project = await findProjectByName("Website")
  assert.ok(project)

  await browser.click(tid("tab-tasks"))
  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.select(tid("task-form-project"), project.id)
  await browser.fill(tid("task-form-title"), "First website task")
  await browser.click(tid("task-form-submit"))
  await browser.waitText("First website task")

  const lists = await projectLists(project.id)
  const [row] = await listTaskRows(project.id)

  assert.ok(row)
  assert.equal(row.statusId, lists.toDo.id)
  assert.equal(row.priorityId, lists.medium.id)
})

// ---------------------------------------------------------------- US-C2

test("US-C2.1/2.2: renaming updates the task chips without a reload and leaves the contents alone", async () => {
  const { browser } = suite
  const project = await seededProject()
  const before = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "Some work" })

  await openLists()
  await browser.click(tid(`project-rename-${project.id}`))
  await browser.waitFor(tid(`project-rename-${project.id}-input`))
  await browser.fill(tid(`project-rename-${project.id}-input`), "Life admin")
  await browser.click(tid(`project-rename-${project.id}-submit`))
  await browser.waitTextIn(tid(`project-name-${project.id}`), "Life admin")

  // No reload between the rename and this assertion.
  await browser.click(tid("tab-tasks"))
  await browser.waitTextIn(tid(`task-project-chip-${task.id}`), "Life admin")

  const after = await projectLists(project.id)
  assert.deepEqual(
    Object.values(after).map((row) => row.id),
    Object.values(before).map((row) => row.id)
  )
  assert.equal((await listTaskRows(project.id)).length, 1)
})

// ---------------------------------------------------------------- US-C3

test("US-C3.1: an empty project deletes after confirmation, taking its lists with it", async () => {
  const { browser } = suite
  const project = await makeProject("Disposable")

  await openLists()
  await browser.click(tid(`project-delete-${project.id}`))
  await browser.waitFor(tid(`delete-project-${project.id}-dialog`))
  await browser.click(tid(`delete-project-${project.id}-confirm`))
  await browser.waitGone(tid(`project-row-${project.id}`))

  assert.equal(await findProjectByName("Disposable"), undefined)
  assert.equal(await countProjects(), 1)
  assert.equal((await listStatusRows(project.id)).length, 0)
  assert.equal((await listPriorityRows(project.id)).length, 0)
})

test("US-C3.2/3.3: deleting a project with tasks is blocked, with the reason and the remedy", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({ projectId: project.id, title: "Open work" })
  await makeTask({
    projectId: project.id,
    title: "Finished work",
    statusId: lists.done.id,
  })

  await openLists()
  await browser.click(tid(`project-delete-${project.id}`))
  await browser.waitFor(tid(`delete-project-${project.id}-dialog`))
  await browser.click(tid(`delete-project-${project.id}-confirm`))
  await browser.waitFor(tid(`delete-project-${project.id}-error`))

  // Verbatim, and counting completed tasks as well as open ones (US-C3.2).
  assert.equal(
    await browser.text(tid(`delete-project-${project.id}-error`)),
    "Project 'Personal' still has 2 tasks. Delete or move those tasks " +
      "first, then delete the project."
  )

  assert.equal(
    await browser.visible(tid(`delete-project-${project.id}-dialog`)),
    true
  )
  assert.equal(await countProjects(), 1)
  assert.equal((await listTaskRows(project.id)).length, 2)
})

test("every project appears in the management list", async () => {
  const { browser } = suite
  await makeProject("Website")
  await makeProject("Errands")

  await openLists()
  await browser.waitCount(tidPrefix("project-row-"), 3)

  assert.deepEqual(await browser.texts(tidPrefix("project-name-")), [
    "Personal",
    "Website",
    "Errands",
  ])
})

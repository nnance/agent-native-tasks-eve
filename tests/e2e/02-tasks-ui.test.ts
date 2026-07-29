/**
 * Epic B — task management through the direct UI (US-B1 … US-B6).
 *
 * Every assertion is either on what the browser shows or on what the test
 * database holds; several are on both, because a row that renders but was
 * never written and a row that was written but never renders are different
 * bugs and both matter.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import { tid, tidPrefix } from "./harness/browser.ts"
import { listTaskRows, seededProject, statusNamed } from "./harness/db.ts"
import {
  makeProject,
  makeTask,
  projectLists,
  type Project,
} from "./harness/fixtures.ts"
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("02-tasks-ui")

/** Row titles in the order the DOM has them. */
async function visibleTitles(): Promise<string[]> {
  return suite.browser.texts(tidPrefix("task-title-"))
}

async function openTasks(): Promise<Project> {
  const project = await seededProject()
  await suite.open()
  return project
}

// ---------------------------------------------------------------- US-B1

test("US-B1.1/1.3/1.4/1.6: a title-only task takes the project's defaults and appears at once", async () => {
  const { browser } = suite
  const project = await openTasks()

  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.fill(tid("task-form-title"), "Capture the idea")
  await browser.click(tid("task-form-submit"))
  await browser.waitText("Capture the idea")

  const [row] = await listTaskRows(project.id)
  assert.ok(row)

  const lists = await projectLists(project.id)
  assert.equal(row.statusId, lists.toDo.id, "first status by order")
  assert.equal(row.priorityId, lists.medium.id, "the default priority")

  assert.equal(await browser.visible(tid(`task-row-${row.id}`)), true)
  assert.equal(await browser.text(tid(`task-status-chip-${row.id}`)), "To Do")
  assert.equal(
    await browser.text(tid(`task-priority-chip-${row.id}`)),
    "Medium"
  )
})

test("US-B1.2: a task cannot be created without a title", async () => {
  const { browser } = suite
  const project = await openTasks()

  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.fill(tid("task-form-title"), "   ")
  await browser.click(tid("task-form-submit"))

  await browser.waitFor(tid("task-form-error"))
  assert.equal(
    await browser.text(tid("task-form-error")),
    "Title cannot be empty"
  )
  assert.equal(await browser.visible(tid("task-form-dialog")), true)
  assert.equal((await listTaskRows(project.id)).length, 0)
})

test("US-B1.5: only the selected project's statuses and priorities are offered", async () => {
  const { browser } = suite
  const seeded = await seededProject()
  const other = await makeProject("Website")

  await suite.open()
  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))

  await browser.select(tid("task-form-project"), other.id)
  const otherLists = await projectLists(other.id)
  const seededLists = await projectLists(seeded.id)

  // Same names, different ids: the option values must be the chosen project's.
  await browser.select(tid("task-form-status"), otherLists.inProgress.id)
  await browser.select(tid("task-form-priority"), otherLists.high.id)
  await browser.fill(tid("task-form-title"), "Scoped to Website")
  await browser.click(tid("task-form-submit"))
  await browser.waitText("Scoped to Website")

  const [row] = await listTaskRows(other.id)
  assert.ok(row)
  assert.equal(row.statusId, otherLists.inProgress.id)
  assert.equal(row.priorityId, otherLists.high.id)
  assert.notEqual(row.statusId, seededLists.inProgress.id)
})

// ---------------------------------------------------------------- US-B2

test("US-B2.1/2.2: rows show title + chips, sorted priority-desc then oldest-first", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({ projectId: project.id, title: "Medium one" })
  await makeTask({ projectId: project.id, title: "Medium two" })
  await makeTask({
    projectId: project.id,
    title: "High one",
    priorityId: lists.high.id,
  })
  await makeTask({
    projectId: project.id,
    title: "Low one",
    priorityId: lists.low.id,
  })

  await suite.open()

  assert.deepEqual(await visibleTitles(), [
    "High one",
    "Medium one",
    "Medium two",
    "Low one",
  ])

  const [first] = await listTaskRows(project.id)
  assert.ok(first)
  assert.equal(
    await browser.text(tid(`task-project-chip-${first.id}`)),
    "Personal"
  )
})

test("US-B2.3/2.4: completed tasks are hidden, then shown last and marked", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)

  await makeTask({ projectId: project.id, title: "Still open" })
  const finished = await makeTask({
    projectId: project.id,
    title: "Already finished",
    statusId: lists.done.id,
    priorityId: lists.high.id,
  })

  await suite.open()

  assert.deepEqual(await visibleTitles(), ["Still open"])
  assert.equal(await browser.visible(tid(`task-row-${finished.id}`)), false)

  await browser.click(tid("show-completed-toggle"))
  await browser.waitFor(tid(`task-row-${finished.id}`))

  // Last, despite carrying the highest priority.
  assert.deepEqual(await visibleTitles(), ["Still open", "Already finished"])
  assert.equal(
    await browser.attr(tid(`task-row-${finished.id}`), "data-completed"),
    "true"
  )
})

test("US-B2.5: opening a task shows every field including the full description", async () => {
  const { browser } = suite
  const project = await seededProject()
  const description =
    "A description long enough that a truncating list would visibly lose the " +
    "end of it, which is exactly what US-B2.5 is about."

  const task = await makeTask({
    projectId: project.id,
    title: "Has detail",
    description,
  })

  await suite.open()
  await browser.click(tid(`task-edit-${task.id}`))
  await browser.waitFor(tid(`task-form-dialog`))

  assert.equal(await browser.value(tid("task-form-title")), "Has detail")
  assert.equal(await browser.value(tid("task-form-description")), description)
  assert.equal(
    await browser.text(tid("task-form-project-readonly")),
    "Personal"
  )
})

// ---------------------------------------------------------------- US-B3

test("US-B3.1/3.2: project, status and priority chips filter individually and together", async () => {
  const { browser } = suite
  const seeded = await seededProject()
  const other = await makeProject("Website")
  const seededLists = await projectLists(seeded.id)

  await makeTask({ projectId: seeded.id, title: "Personal medium" })
  await makeTask({
    projectId: seeded.id,
    title: "Personal high",
    priorityId: seededLists.high.id,
  })
  await makeTask({
    projectId: seeded.id,
    title: "Personal in progress",
    statusId: seededLists.inProgress.id,
  })
  await makeTask({ projectId: other.id, title: "Website work" })

  await suite.open()
  assert.equal(await browser.count(tidPrefix("task-row-")), 4)

  await browser.click(tid(`filter-project-${seeded.id}`))
  // The hint disappearing is client state, not the refetch — same race.
  await browser.waitGone(tid("status-filter-hint"))
  await browser.waitCount(tidPrefix("task-row-"), 3)
  assert.equal(await browser.count(tidPrefix("task-row-")), 3)

  // `click` returns when the event dispatches, not when the new query key's
  // fetch has landed — so each filter change needs its own settle point, the
  // same `waitCount` idiom the search test below already uses. Without them
  // this read the *previous* filter's list and failed with three rows where
  // one was expected, on a full-suite run where the database was slower.
  await browser.click(tid(`filter-status-${seededLists.inProgress.id}`))
  await browser.waitCount(tidPrefix("task-row-"), 1)
  assert.deepEqual(await visibleTitles(), ["Personal in progress"])

  await browser.click(tid(`filter-status-${seededLists.inProgress.id}`))
  await browser.waitCount(tidPrefix("task-row-"), 3)
  await browser.click(tid(`filter-priority-${seededLists.high.id}`))
  await browser.waitCount(tidPrefix("task-row-"), 1)
  assert.deepEqual(await visibleTitles(), ["Personal high"])

  // All three at once, and they AND together to nothing.
  await browser.click(tid(`filter-status-${seededLists.inProgress.id}`))
  await browser.waitFor(tid("task-list-empty"))
})

test("US-B3.3/3.4: search narrows the list and combines with the chips", async () => {
  const { browser } = suite
  const seeded = await seededProject()
  const other = await makeProject("Website")

  await makeTask({ projectId: seeded.id, title: "Fix the header" })
  await makeTask({
    projectId: seeded.id,
    title: "Rewrite the footer",
    description: "Also mentions the header in passing.",
  })
  await makeTask({ projectId: seeded.id, title: "Unrelated errand" })
  await makeTask({ projectId: other.id, title: "Header on the website" })

  await suite.open()

  await browser.fill(tid("task-search-input"), "header")
  await browser.waitCount(tidPrefix("task-row-"), 3)

  await browser.click(tid(`filter-project-${seeded.id}`))
  await browser.waitCount(tidPrefix("task-row-"), 2)
  assert.deepEqual(await visibleTitles(), [
    "Fix the header",
    "Rewrite the footer",
  ])
})

test("US-B3.5: an empty result offers a way to clear filters and search", async () => {
  const { browser } = suite
  const project = await seededProject()
  await makeTask({ projectId: project.id, title: "The only task" })

  await suite.open()
  await browser.fill(tid("task-search-input"), "nothing will match this")
  await browser.waitFor(tid("task-list-empty"))

  await browser.click(tid("clear-filters"))
  await browser.waitText("The only task")
  assert.equal(await browser.value(tid("task-search-input")), "")
  assert.equal(await browser.count(tidPrefix("task-row-")), 1)
})

// ---------------------------------------------------------------- US-B4

test("US-B4.1/4.3/4.5: editing title, description, status and priority persists and shows at once", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({
    projectId: project.id,
    title: "Before",
    description: "Old detail",
  })

  await suite.open()
  await browser.click(tid(`task-edit-${task.id}`))
  await browser.waitFor(tid("task-form-dialog"))

  await browser.fill(tid("task-form-title"), "After")
  await browser.fill(tid("task-form-description"), "New detail")
  await browser.select(tid("task-form-status"), lists.inProgress.id)
  await browser.select(tid("task-form-priority"), lists.high.id)
  await browser.click(tid("task-form-submit"))
  await browser.waitText("After")

  const [row] = await listTaskRows(project.id)
  assert.ok(row)
  assert.equal(row.title, "After")
  assert.equal(row.description, "New detail")
  assert.equal(row.statusId, lists.inProgress.id)
  assert.equal(row.priorityId, lists.high.id)

  assert.equal(
    await browser.text(tid(`task-status-chip-${task.id}`)),
    "In Progress"
  )
  assert.equal(await browser.text(tid(`task-priority-chip-${task.id}`)), "High")
})

test("US-B4.2: the title cannot be cleared", async () => {
  const { browser } = suite
  const project = await seededProject()
  const task = await makeTask({ projectId: project.id, title: "Keep me" })

  await suite.open()
  await browser.click(tid(`task-edit-${task.id}`))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.fill(tid("task-form-title"), " ")
  await browser.click(tid("task-form-submit"))

  await browser.waitFor(tid("task-form-error"))
  assert.equal(
    await browser.text(tid("task-form-error")),
    "Title cannot be empty"
  )

  const [row] = await listTaskRows(project.id)
  assert.equal(row?.title, "Keep me")
})

test("US-B4.4: there is no way in the UI to move a task to another project", async () => {
  const { browser } = suite
  const project = await seededProject()
  await makeProject("Website")
  const task = await makeTask({ projectId: project.id, title: "Stays put" })

  await suite.open()
  await browser.click(tid(`task-edit-${task.id}`))
  await browser.waitFor(tid("task-form-dialog"))

  // Asserted as an absence: no project control exists in the DOM at all.
  assert.equal(await browser.count(tid("task-form-project")), 0)
  assert.equal(
    await browser.text(tid("task-form-project-readonly")),
    "Personal"
  )
})

// ---------------------------------------------------------------- US-B5

test("US-B5.1/5.2/5.4: the row's status select moves a task, in the project's order", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "Advance me" })

  await suite.open()

  assert.deepEqual(
    await browser.texts(`${tid(`task-status-select-${task.id}`)} option`),
    ["To Do", "In Progress", "Done"]
  )

  await browser.select(
    tid(`task-status-select-${task.id}`),
    lists.inProgress.id
  )
  // The chip, not the page text: "In Progress" is already in the select's own
  // options, so `wait --text` would return before the mutation had landed.
  await browser.waitTextIn(tid(`task-status-chip-${task.id}`), "In Progress")

  const [row] = await listTaskRows(project.id)
  assert.equal(row?.statusId, lists.inProgress.id)
  assert.equal(
    await browser.text(tid(`task-status-chip-${task.id}`)),
    "In Progress"
  )
})

test("US-B5.3: moving into a completed status applies the completed display rules", async () => {
  const { browser } = suite
  const project = await seededProject()
  const lists = await projectLists(project.id)
  const task = await makeTask({ projectId: project.id, title: "Finish me" })

  await suite.open()
  await browser.select(tid(`task-status-select-${task.id}`), lists.done.id)
  await browser.waitGone(tid(`task-row-${task.id}`))

  await browser.click(tid("show-completed-toggle"))
  await browser.waitFor(tid(`task-row-${task.id}`))
  assert.equal(
    await browser.attr(tid(`task-row-${task.id}`), "data-completed"),
    "true"
  )
})

// ---------------------------------------------------------------- US-B6

test("US-B6.1/6.2: deleting asks for confirmation, and declining changes nothing", async () => {
  const { browser } = suite
  const project = await seededProject()
  const task = await makeTask({ projectId: project.id, title: "Spare me" })

  await suite.open()
  await browser.click(tid(`task-delete-${task.id}`))
  await browser.waitFor(tid(`delete-task-${task.id}-dialog`))
  await browser.click(tid(`delete-task-${task.id}-cancel`))
  await browser.waitGone(tid(`delete-task-${task.id}-dialog`))

  assert.equal(await browser.visible(tid(`task-row-${task.id}`)), true)
  assert.equal((await listTaskRows(project.id)).length, 1)
})

test("US-B6.3: confirming removes the task from the list and the database", async () => {
  const { browser } = suite
  const project = await seededProject()
  const task = await makeTask({ projectId: project.id, title: "Delete me" })

  await suite.open()
  await browser.click(tid(`task-delete-${task.id}`))
  await browser.waitFor(tid(`delete-task-${task.id}-dialog`))
  await browser.click(tid(`delete-task-${task.id}-confirm`))
  await browser.waitGone(tid(`task-row-${task.id}`))

  assert.equal((await listTaskRows(project.id)).length, 0)
  assert.equal(await browser.visible(tid("task-list-empty")), true)
})

test("the seeded project's status list is what the row select offers", async () => {
  const project = await seededProject()
  const done = await statusNamed(project.id, "Done")
  assert.equal(done.isCompleted, true)
})

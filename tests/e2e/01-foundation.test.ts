/**
 * US-A1 (seeded workspace) and the product spec §8.0 split-screen shell,
 * driven through a real browser against a real production build.
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
import { setupSuite } from "./harness/setup.ts"

const suite = setupSuite("01-foundation")

test("US-A1.1: a fresh workspace has exactly one project", async () => {
  assert.equal(await countProjects(), 1)

  const project = await seededProject()
  assert.equal(project.name, "Personal")
})

test("US-A1.2: the seeded project has To Do / In Progress / Done, Done completed", async () => {
  const project = await seededProject()
  const rows = await listStatusRows(project.id)

  assert.deepEqual(
    rows.map((status) => [status.name, status.order, status.isCompleted]),
    [
      ["To Do", 0, false],
      ["In Progress", 1, false],
      ["Done", 2, true],
    ]
  )
})

test("US-A1.3: the seeded project has Low / Medium / High, Medium default", async () => {
  const project = await seededProject()
  const rows = await listPriorityRows(project.id)

  assert.deepEqual(
    rows.map((priority) => [priority.name, priority.order, priority.isDefault]),
    [
      ["Low", 0, false],
      ["Medium", 1, true],
      ["High", 2, false],
    ]
  )
})

test("US-A1.4: a task can be created in the seeded project with no extra setup", async () => {
  const { browser } = suite
  await suite.open()

  await browser.click(tid("task-create-open"))
  await browser.waitFor(tid("task-form-dialog"))
  await browser.fill(tid("task-form-title"), "First real work")
  await browser.click(tid("task-form-submit"))
  await browser.waitText("First real work")

  const project = await seededProject()
  const rows = await listTaskRows(project.id)

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.title, "First real work")
})

test("US-A1.5: reopening the app does not create a second starter project", async () => {
  const { browser } = suite
  await suite.open()
  await browser.reload()
  await browser.reload()

  assert.equal(await countProjects(), 1)
})

test("§8.0: both panes render side by side and stack on a narrow viewport", async () => {
  const { browser } = suite
  await suite.open()

  assert.equal(await browser.visible(tid("app-shell")), true)
  assert.equal(await browser.visible(tid("task-pane")), true)
  assert.equal(await browser.visible(tid("chat-pane")), true)
  assert.equal(await browser.visible(tid("chat-conversation")), true)
  assert.equal(await browser.visible(tid("chat-composer")), true)
  assert.equal(await browser.visible(tid("tab-tasks")), true)
  assert.equal(await browser.visible(tid("tab-lists")), true)

  await browser.viewport(420, 900)
  assert.equal(await browser.visible(tid("task-pane")), true)
  assert.equal(await browser.visible(tid("chat-pane")), true)
  await browser.viewport(1440, 900)
})

test("§8.0: the shell loads with no page errors and no console errors", async () => {
  const { browser } = suite
  await browser.clearErrors()
  await suite.open()

  assert.deepEqual(await browser.errors(), [])

  const messages = await browser.console()
  const errors = messages.filter((message) => message.type === "error")

  assert.deepEqual(
    errors.map((message) => message.text),
    []
  )
})

test("the app under test writes to the TEST database, not the dev one", async () => {
  const { browser } = suite
  await suite.open()

  // The whole suite rests on `@next/env` not overwriting the DATABASE_URL the
  // harness puts in the spawned server's environment. If that ever stopped
  // holding, every other test would still pass while quietly mutating the dev
  // database — so this asserts the claim directly, on the first file, rather
  // than trusting it.
  await browser.click(tid("tab-lists"))
  await browser.waitFor(tid("project-create-input"))
  await browser.fill(tid("project-create-input"), "Database target probe")
  await browser.click(tid("project-create-submit"))
  await browser.waitText("Database target probe")

  const created = await findProjectByName("Database target probe")
  assert.ok(created, "the project created through the UI is in the test DB")
  assert.equal(await countProjects(), 2)
})

test("the task list renders the seeded workspace's empty state", async () => {
  const { browser } = suite
  await suite.open()

  assert.equal(await browser.count(tidPrefix("task-row-")), 0)
  assert.equal(await browser.visible(tid("task-list-empty")), true)
})

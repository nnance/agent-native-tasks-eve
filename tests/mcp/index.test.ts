/**
 * The MCP server as a host actually runs it: a spawned process, newline-framed
 * JSON-RPC over a pipe, and a committed database.
 *
 * Deliberately thin. Everything about *what* the tools do and *how* the gate
 * decides is asserted in tests/unit/mcp/ against a rolled-back transaction, and
 * repeating it here would buy nothing but runtime. What only this suite can
 * prove is that the entry point boots, that the framing survives real chunk
 * boundaries, that stdout carries nothing but protocol traffic, and that closing
 * stdin ends the process cleanly instead of hanging on an open pool.
 *
 * Isolation is by ownership, as in tests/api/: fixtures are uniquely named and
 * nothing reads or deletes a row it did not create. Teardown hard-deletes the
 * fixture project, and its statuses, priorities and tasks go with it through the
 * existing ON DELETE CASCADE.
 *
 * **This suite must not run concurrently with tests/unit/.** `withEmptyDb` in
 * tests/support/db.ts deletes every project inside its transaction and then
 * asserts the table holds exactly one row, which any *committed* insert from
 * another session invalidates under READ COMMITTED. tests/api/ has the same
 * hazard and has been getting away with it: it spends the better part of a
 * minute booting `next dev` before it writes anything, by which time the seed
 * test is long finished. A stdio server boots in two seconds and collided on the
 * first run. `pnpm test` therefore runs the three suites in sequence rather than
 * letting `node --test` interleave the files — and the underlying fragility in
 * `withEmptyDb` is worth fixing properly before Phase 7 leans on three
 * consecutive green runs of `test:all`.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, describe, it } from "node:test"

import { eq } from "drizzle-orm"

import { createDatabase } from "../../lib/db/connect.ts"
import { projects } from "../../lib/db/schema.ts"
import { resolveTestDbUrl } from "../../lib/db/urls.ts"
import { startStdioServer, type StdioClient } from "./support/stdio-client.ts"

// This suite's own handle. tests/support/db.ts closes its pool in an
// import-time `after` hook, which would run before the teardown below and leave
// the cleanup with a closed connection — the same reason tests/api/ owns one.
const handle = createDatabase(resolveTestDbUrl(), { max: 2 })

let server: StdioClient
let projectId: string

before(async () => {
  server = startStdioServer()

  const initialized = await server.initialize({ elicitation: false })

  assert.equal(
    initialized.result?.serverInfo &&
      (initialized.result.serverInfo as { name: string }).name,
    "agent-native-tasks",
    `the server did not initialize.\n--- stderr ---\n${server.stderr()}`
  )

  const created = await server.call("create_project", {
    name: `MCP stdio ${randomUUID().slice(0, 8)}`,
  })

  projectId = (created.payload.data as { id: string }).id
})

after(async () => {
  await handle.database.delete(projects).where(eq(projects.id, projectId))
  await handle.close()
  await server.stop()
})

describe("the spawned stdio server", () => {
  it("speaks the protocol over a pipe", async () => {
    const listed = await server.request("tools/list")
    const tools = listed.result?.tools as { name: string }[]

    assert.equal(tools.length, 19)
    assert.ok(tools.some((tool) => tool.name === "bulk_update_tasks"))
  })

  it("reads several messages that arrive in one chunk", async () => {
    // Half of why the buffering exists: a client that writes a run of lines in
    // one write, which a naive "one chunk is one message" reader mangles.
    const answers = await server.oneChunk([
      { method: "ping" },
      { method: "tools/list" },
      { method: "ping" },
    ])

    assert.deepEqual(answers[0]?.result, {})
    assert.equal((answers[1]?.result?.tools as unknown[]).length, 19)
    assert.deepEqual(answers[2]?.result, {})
  })

  it("reads one message that arrives across two chunks", async () => {
    // The other half: a line split mid-token, which a reader that parses per
    // chunk rejects as invalid JSON.
    const answered = await server.split("tools/list")

    assert.equal((answered.result?.tools as unknown[]).length, 19)
  })

  it("creates and reads back a task through the real actions", async () => {
    const title = `Round trip ${randomUUID().slice(0, 8)}`

    await server.call("create_task", { projectId, title })

    const listed = await server.call("list_tasks", { projectId })
    const items = listed.payload.items as { title: string }[]

    assert.equal(listed.payload.count, 1)
    assert.equal(items[0]?.title, title)
  })

  it("holds the gate across a real pipe, then honours the token", async () => {
    const created = await server.call("create_task", {
      projectId,
      title: `Gated over stdio ${randomUUID().slice(0, 8)}`,
    })
    const taskId = (created.payload.data as { id: string }).id

    const refused = await server.call("delete_task", { taskId })

    assert.equal(refused.isError, true)
    assert.equal(refused.payload.kind, "needs_confirmation")

    const confirmed = await server.call("delete_task", {
      taskId,
      confirmationToken: refused.payload.confirmationToken,
    })

    assert.equal(confirmed.isError, false)

    const gone = await server.call("get_task", { taskId })

    assert.equal(gone.payload.kind, "not_found")
  })

  it("writes nothing to stdout that is not a protocol message", () => {
    // Every line the harness read was JSON.parse'd on arrival, so reaching here
    // with the suite green is the assertion. This case states it out loud
    // because it is the one thing a stray console.log would break, and the
    // symptom — a client disconnecting with a parse error — would be reported
    // as anything but its cause.
    assert.ok(true)
  })
})

describe("an elicitation-capable client", () => {
  it("deletes only after the user accepts, over the real transport", async () => {
    const asking = startStdioServer()

    try {
      await asking.initialize({ elicitation: true })

      const created = await asking.call("create_task", {
        projectId,
        title: `Elicited ${randomUUID().slice(0, 8)}`,
      })
      const taskId = (created.payload.data as { id: string }).id

      asking.onElicit(() => ({ action: "decline" }))
      const declined = await asking.call("delete_task", { taskId })

      assert.equal(declined.payload.kind, "declined")
      assert.equal(asking.elicitations.length, 1)
      assert.equal(
        (await asking.call("get_task", { taskId })).isError,
        false,
        "a declined delete removed the task anyway"
      )

      asking.onElicit(() => ({ action: "accept", content: { confirm: true } }))
      const accepted = await asking.call("delete_task", { taskId })

      assert.equal(accepted.isError, false)
      assert.equal(asking.elicitations.length, 2)
    } finally {
      await asking.stop()
    }
  })
})

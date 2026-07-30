/**
 * `tools/call` end to end against the real test database: what a caller can do,
 * what it is refused, and what it has to get past first.
 *
 * The server takes an injectable `Database`, so every case here runs inside a
 * transaction that is always rolled back (tests/support/db.ts) — real SQL, real
 * constraints, real rules, no mocks and no cleanup.
 *
 * Three groups of claim, in ascending order of how much they matter:
 *
 * 1. **The results are the internal agent's results.** Same trimming, same
 *    failure kinds, same rule messages relayed verbatim. If these diverge, the
 *    two agents are looking at different products.
 * 2. **A rule cannot be reached from here that cannot be reached from there.**
 *    Notably a task's project: `updateTaskSchema` has no such field, so the
 *    attempt is a schema error through this front door exactly as it is through
 *    the other two.
 * 3. **The gate holds.** No destructive operation runs in one call. With a
 *    client that can be asked, a person answers and a decline means nothing
 *    changed. Without one, the token is single-use and bound to the exact
 *    arguments it was issued for, and tokens do not cross sessions.
 */

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { describe, it } from "node:test"

import type { Database } from "../../../lib/db/client.ts"
import { CONFIRMATION_TOKEN } from "../../../mcp/guard.ts"
import { withRollback } from "../../support/db.ts"
import { createTestMcpClient, type TestMcpClient } from "../../support/mcp.ts"

type Fixture = {
  client: TestMcpClient
  database: Database
  project: { id: string; name: string }
  statuses: { id: string; name: string; isCompleted: boolean }[]
  priorities: { id: string; name: string; isDefault: boolean }[]
  task: (title: string) => Promise<{ id: string; title: string }>
}

/** Data returned by a successful tool call, or a legible failure. */
function data<T>(outcome: {
  isError: boolean
  payload: Record<string, unknown>
}): T {
  assert.equal(
    outcome.isError,
    false,
    `expected success, got ${JSON.stringify(outcome.payload)}`
  )

  return outcome.payload.data as T
}

/**
 * One scenario: a rolled-back transaction, an initialized client, and a fresh
 * project seeded with the standard statuses and priorities.
 */
async function scenario(
  options: { elicitation?: boolean },
  run: (fixture: Fixture) => Promise<void>
): Promise<void> {
  await withRollback(async (database) => {
    const client = createTestMcpClient({ database })
    await client.initialize({ elicitation: options.elicitation ?? false })

    const project = data<{ id: string; name: string }>(
      await client.call("create_project", { name: `MCP ${randomUUID()}` })
    )

    const statuses = (
      await client.call("list_statuses", { projectId: project.id })
    ).payload.items as Fixture["statuses"]
    const priorities = (
      await client.call("list_priorities", { projectId: project.id })
    ).payload.items as Fixture["priorities"]

    await run({
      client,
      database,
      project,
      statuses,
      priorities,
      task: async (title) =>
        data(
          await client.call("create_task", { projectId: project.id, title })
        ),
    })
  })
}

/** The task ids currently in a project, so a test can prove nothing changed. */
async function taskIds(client: TestMcpClient, projectId: string) {
  const listed = await client.call("list_tasks", {
    projectId,
    includeCompleted: true,
  })

  return (listed.payload.items as { id: string }[])
    .map((task) => task.id)
    .sort()
}

describe("results the model reads", () => {
  it("trims every list result to a count and compact rows", async () => {
    await scenario({}, async ({ client, project }) => {
      await client.call("create_task", {
        projectId: project.id,
        title: "Trim me",
        description: "a long description the list must not carry",
      })

      const tasks = await client.call("list_tasks", { projectId: project.id })

      assert.equal(tasks.payload.ok, true)
      assert.equal(tasks.payload.count, 1)
      assert.deepEqual(
        Object.keys((tasks.payload.items as object[])[0]!).sort(),
        ["id", "isCompleted", "priority", "project", "status", "title"]
      )

      for (const name of [
        "list_projects",
        "list_statuses",
        "list_priorities",
      ]) {
        const listed = await client.call(
          name,
          name === "list_projects" ? {} : { projectId: project.id }
        )

        assert.equal(listed.payload.ok, true)
        assert.equal(typeof listed.payload.count, "number")
        assert.ok(Array.isArray(listed.payload.items))
        assert.equal(listed.payload.data, undefined)
      }
    })
  })

  it("returns a task in full from get_task", async () => {
    await scenario({}, async ({ client, task }) => {
      const created = await task("Read me")
      const full = data<{
        description: string | null
        project: { name: string }
      }>(await client.call("get_task", { taskId: created.id }))

      assert.equal(full.description, null)
      assert.equal(typeof full.project.name, "string")
    })
  })

  it("maps malformed arguments to invalid_input", async () => {
    await scenario({}, async ({ client, project }) => {
      const outcome = await client.call("create_task", {
        projectId: project.id,
      })

      assert.equal(outcome.isError, true)
      assert.equal(outcome.payload.kind, "invalid_input")
    })
  })

  it("maps a missing row to not_found", async () => {
    await scenario({}, async ({ client }) => {
      const outcome = await client.call("get_task", { taskId: randomUUID() })

      assert.equal(outcome.payload.kind, "not_found")
    })
  })

  it("relays a blocked rule's own words", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      await task("Blocks the delete")

      const outcome = await client.call("delete_project", {
        projectId: project.id,
      })

      assert.equal(outcome.payload.kind, "blocked")
      assert.match(outcome.payload.message as string, /still has 1 task/)
    })
  })

  it("cannot move a task between projects, because there is no such field", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const created = await task("Stays put")
      const outcome = await client.call("update_task", {
        taskId: created.id,
        projectId: project.id,
      })

      // product spec §7 rule 1, enforced structurally by updateTaskSchema being
      // a strictObject with no projectId — identically through all three doors.
      assert.equal(outcome.payload.kind, "invalid_input")
    })
  })
})

describe("the gate, with a client that can ask the user", () => {
  it("runs a delete once the user accepts", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const created = await task("Doomed")

      const outcome = await client.call("delete_task", { taskId: created.id })

      assert.equal(outcome.isError, false)
      assert.deepEqual(await taskIds(client, project.id), [])
      assert.equal(client.elicitations.length, 1)
    })
  })

  it("names the task, not its id, in what the user is shown", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const created = await task("Fix the header")
      await client.call("delete_task", { taskId: created.id })

      const message = client.elicitations[0]?.message as string

      assert.match(message, /Fix the header/)
      assert.match(message, new RegExp(project.name))
    })
  })

  it("changes nothing when the user declines", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const created = await task("Spared")
      client.onElicit(() => ({ action: "decline" }))

      const outcome = await client.call("delete_task", { taskId: created.id })

      assert.equal(outcome.isError, true)
      assert.equal(outcome.payload.kind, "declined")
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("treats a dismissed prompt as a decline", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const created = await task("Spared again")
      client.onElicit(() => ({ action: "cancel" }))

      assert.equal(
        (await client.call("delete_task", { taskId: created.id })).payload.kind,
        "declined"
      )
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("treats an accepted form that says no as a decline", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const created = await task("Unconfirmed")
      client.onElicit(() => ({ action: "accept", content: { confirm: false } }))

      assert.equal(
        (await client.call("delete_task", { taskId: created.id })).payload.kind,
        "declined"
      )
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("does not ask about a call that could never have run", async () => {
    await scenario({ elicitation: true }, async ({ client }) => {
      const outcome = await client.call("delete_task", { taskId: "not-a-uuid" })

      assert.equal(outcome.payload.kind, "invalid_input")
      assert.deepEqual(client.elicitations, [])
    })
  })

  it("states how many tasks a bulk change touches, and names them", async () => {
    await scenario({ elicitation: true }, async ({ client, project, task }) => {
      const first = await task("Alpha")
      const second = await task("Beta")

      const outcome = await client.call("bulk_delete_tasks", {
        taskIds: [first.id, second.id],
      })

      assert.equal(outcome.isError, false)
      assert.equal(outcome.payload.count, 2)
      assert.deepEqual(await taskIds(client, project.id), [])

      const message = client.elicitations[0]?.message as string

      assert.match(message, /Delete 2 tasks/)
      assert.match(message, /"Alpha" and "Beta"/)
    })
  })
})

describe("the gate, with a client that cannot ask the user", () => {
  it("refuses the first call, describes it, and issues a token", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const created = await task("Needs a second call")

      const outcome = await client.call("delete_task", { taskId: created.id })

      assert.equal(outcome.isError, true)
      assert.equal(outcome.payload.kind, "needs_confirmation")
      assert.equal(typeof outcome.payload[CONFIRMATION_TOKEN], "string")
      assert.match(outcome.payload.message as string, /Needs a second call/)
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("runs the call when the token comes back with it", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const created = await task("Confirmed")
      const refused = await client.call("delete_task", { taskId: created.id })

      const outcome = await client.call("delete_task", {
        taskId: created.id,
        [CONFIRMATION_TOKEN]: refused.payload[CONFIRMATION_TOKEN],
      })

      assert.equal(outcome.isError, false)
      assert.deepEqual(await taskIds(client, project.id), [])
    })
  })

  it("spends a token on one call only", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const first = await task("First")
      const second = await task("Second")
      const refused = await client.call("delete_task", { taskId: first.id })
      const token = refused.payload[CONFIRMATION_TOKEN]

      await client.call("delete_task", {
        taskId: first.id,
        [CONFIRMATION_TOKEN]: token,
      })

      const reused = await client.call("delete_task", {
        taskId: second.id,
        [CONFIRMATION_TOKEN]: token,
      })

      assert.equal(reused.payload.kind, "needs_confirmation")
      assert.deepEqual(await taskIds(client, project.id), [second.id])
    })
  })

  it("binds a token to the exact arguments it was issued for", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const first = await task("Named in the prompt")
      const second = await task("Not named in the prompt")
      const refused = await client.call("bulk_delete_tasks", {
        taskIds: [first.id],
      })

      const widened = await client.call("bulk_delete_tasks", {
        taskIds: [first.id, second.id],
        [CONFIRMATION_TOKEN]: refused.payload[CONFIRMATION_TOKEN],
      })

      assert.equal(widened.payload.kind, "needs_confirmation")
      assert.match(widened.payload.message as string, /different call/)
      assert.deepEqual(
        await taskIds(client, project.id),
        [first.id, second.id].sort()
      )
    })
  })

  it("refuses a token it never issued", async () => {
    await scenario({}, async ({ client, project, task }) => {
      const created = await task("Invented token")

      const outcome = await client.call("delete_task", {
        taskId: created.id,
        [CONFIRMATION_TOKEN]: randomUUID(),
      })

      assert.equal(outcome.payload.kind, "needs_confirmation")
      assert.match(outcome.payload.message as string, /not one this session/)
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("does not let one session redeem another's token", async () => {
    await scenario({}, async ({ client, database, project, task }) => {
      const created = await task("Cross-session")
      const refused = await client.call("delete_task", { taskId: created.id })

      const other = createTestMcpClient({ database })
      await other.initialize({ elicitation: false })

      const outcome = await other.call("delete_task", {
        taskId: created.id,
        [CONFIRMATION_TOKEN]: refused.payload[CONFIRMATION_TOKEN],
      })

      assert.equal(outcome.payload.kind, "needs_confirmation")
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })

  it("refuses outright when the server demands a human answer", async (t) => {
    const previous = process.env.MCP_REQUIRE_ELICITATION
    process.env.MCP_REQUIRE_ELICITATION = "1"
    t.after(() => {
      if (previous === undefined) delete process.env.MCP_REQUIRE_ELICITATION
      else process.env.MCP_REQUIRE_ELICITATION = previous
    })

    await scenario({}, async ({ client, project, task }) => {
      const created = await task("Untouchable")

      const outcome = await client.call("delete_task", { taskId: created.id })

      assert.equal(outcome.payload.kind, "declined")
      assert.equal(outcome.payload[CONFIRMATION_TOKEN], undefined)
      assert.deepEqual(await taskIds(client, project.id), [created.id])
    })
  })
})

describe("the second task edited in a session", () => {
  it("runs the first edit without asking", async () => {
    await scenario(
      { elicitation: true },
      async ({ client, task, statuses }) => {
        const created = await task("Edited once")

        const outcome = await client.call("update_task", {
          taskId: created.id,
          statusId: statuses[1]!.id,
        })

        assert.equal(outcome.isError, false)
        assert.deepEqual(client.elicitations, [])
      }
    )
  })

  it("asks before editing a different task in the same session", async () => {
    await scenario(
      { elicitation: true },
      async ({ client, task, statuses }) => {
        const first = await task("First edit")
        const second = await task("Second edit")

        await client.call("update_task", {
          taskId: first.id,
          statusId: statuses[1]!.id,
        })
        const outcome = await client.call("update_task", {
          taskId: second.id,
          statusId: statuses[1]!.id,
        })

        assert.equal(outcome.isError, false)
        assert.equal(client.elicitations.length, 1)
        assert.match(
          client.elicitations[0]?.message as string,
          /second task in this session/
        )
        assert.match(
          client.elicitations[0]?.message as string,
          /bulk_update_tasks/
        )
      }
    )
  })

  it("does not count a second edit of the same task as a second task", async () => {
    await scenario(
      { elicitation: true },
      async ({ client, task, statuses }) => {
        const created = await task("Edited twice")

        await client.call("update_task", {
          taskId: created.id,
          title: "Renamed",
        })
        await client.call("update_task", {
          taskId: created.id,
          statusId: statuses[1]!.id,
        })

        assert.deepEqual(client.elicitations, [])
      }
    )
  })

  it("changes nothing when the user declines the second edit", async () => {
    await scenario(
      { elicitation: true },
      async ({ client, task, statuses }) => {
        const first = await task("Allowed")
        const second = await task("Refused")

        await client.call("update_task", {
          taskId: first.id,
          statusId: statuses[1]!.id,
        })
        client.onElicit(() => ({ action: "decline" }))

        const outcome = await client.call("update_task", {
          taskId: second.id,
          statusId: statuses[1]!.id,
        })

        assert.equal(outcome.payload.kind, "declined")

        const unchanged = data<{ status: { name: string } }>(
          await client.call("get_task", { taskId: second.id })
        )

        assert.equal(unchanged.status.name, statuses[0]!.name)
      }
    )
  })

  it("starts counting again in a new session", async () => {
    // MCP has no turn, so the session is the scope. A fresh connection is a
    // fresh count — which is the closest this transport comes to EVE's per-turn
    // reset, and is stricter within any one connection.
    await scenario(
      { elicitation: true },
      async ({ database, task, statuses }) => {
        const created = await task("New session")
        const fresh = createTestMcpClient({ database })
        await fresh.initialize({ elicitation: true })

        const outcome = await fresh.call("update_task", {
          taskId: created.id,
          statusId: statuses[1]!.id,
        })

        assert.equal(outcome.isError, false)
        assert.deepEqual(fresh.elicitations, [])
      }
    )
  })
})

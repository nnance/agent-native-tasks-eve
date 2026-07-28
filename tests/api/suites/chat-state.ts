/**
 * GET/PUT /api/chat-state.
 *
 * The suite clears the singleton row in its own `before` so the default-empty
 * read is deterministic no matter what ran first. That is safe precisely
 * because tests/api collapses to one file and node:test runs a file's tests
 * sequentially — nothing else is touching the row concurrently.
 */

import assert from "node:assert/strict"
import { before, describe, it } from "node:test"

import { eq } from "drizzle-orm"

import { CHAT_STATE_ID, chatState } from "../../../lib/db/schema.ts"
import { apiTestDatabase } from "../support/db.ts"
import { apiJson } from "../support/server.ts"

type ChatStateBody = {
  events: unknown[]
  session: Record<string, unknown> | null
  // Response.json runs JSON.stringify, which invokes Date.prototype.toJSON,
  // so a timestamp arrives here as an ISO string rather than a Date.
  updatedAt: string | null
}
type ErrorBody = { error: string; issues?: unknown[] }

export function registerChatStateSuite(): void {
  describe("/api/chat-state", () => {
    before(async () => {
      await apiTestDatabase
        .delete(chatState)
        .where(eq(chatState.id, CHAT_STATE_ID))
    })

    it("reads an empty snapshot before anything is written — never 404", async () => {
      const { status, body } = await apiJson<ChatStateBody>("/api/chat-state")

      assert.equal(status, 200)
      assert.deepStrictEqual(body, {
        events: [],
        session: null,
        updatedAt: null,
      })
    })

    it("round-trips events and session", async () => {
      const events = [
        { type: "user-message", text: "add a task" },
        { type: "tool-call", name: "create_task", input: { title: "Ship" } },
      ]
      const session = { id: "sess_1", cursor: 12 }

      const written = await apiJson<ChatStateBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events, session }),
      })

      assert.equal(written.status, 200)
      assert.deepStrictEqual(written.body.events, events)
      assert.deepStrictEqual(written.body.session, session)
      assert.ok(typeof written.body.updatedAt === "string")

      const read = await apiJson<ChatStateBody>("/api/chat-state")
      assert.equal(read.status, 200)
      assert.deepStrictEqual(read.body.events, events)
      assert.deepStrictEqual(read.body.session, session)
    })

    // Product spec §7.6: last write wins, wholesale — no merge.
    it("overwrites the previous snapshot on a second PUT", async () => {
      await apiJson<ChatStateBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events: [{ n: 1 }, { n: 2 }], session: null }),
      })

      const second = await apiJson<ChatStateBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events: [{ n: 3 }], session: { id: "b" } }),
      })

      assert.equal(second.status, 200)
      assert.deepStrictEqual(second.body.events, [{ n: 3 }])

      const read = await apiJson<ChatStateBody>("/api/chat-state")
      assert.deepStrictEqual(read.body.events, [{ n: 3 }])
      assert.deepStrictEqual(read.body.session, { id: "b" })
    })

    it("rejects a non-array events field", async () => {
      const { status, body } = await apiJson<ErrorBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events: {}, session: null }),
      })

      assert.equal(status, 400)
      assert.equal(body.error, "Invalid request.")
    })

    it("rejects an unknown key", async () => {
      const { status } = await apiJson<ErrorBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events: [], session: null, extra: true }),
      })

      assert.equal(status, 400)
    })

    it("rejects an absent session — absent is not null", async () => {
      const { status } = await apiJson<ErrorBody>("/api/chat-state", {
        method: "PUT",
        body: JSON.stringify({ events: [] }),
      })

      assert.equal(status, 400)
    })
  })
}

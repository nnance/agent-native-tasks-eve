/**
 * Coverage for the conversation-snapshot action pair.
 *
 * `chat_state` is a singleton row guarded by a CHECK constraint, so every test
 * here runs inside `withRollback` — the row is deleted, written and read back
 * entirely inside a transaction that is never committed, which is what lets
 * this file share a database with the API suite's committed writes.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { getChatState, putChatState } from "../../../lib/actions/chat-state.ts"
import type { Database } from "../../../lib/db/connect.ts"
import { CHAT_STATE_ID, chatState } from "../../../lib/db/schema.ts"
import { putChatStateSchema } from "../../../lib/schemas/chat-state.ts"
import { withRollback } from "../../support/db.ts"

/** Clears the singleton inside the caller's transaction. */
async function clearSnapshot(tx: Database) {
  await tx.delete(chatState).where(eq(chatState.id, CHAT_STATE_ID))
}

describe("getChatState", () => {
  // An empty conversation is a legitimate state, not a 404: the very first
  // page load has no row, and every consumer would otherwise need a catch.
  it("reads an absent row as an empty snapshot", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      assert.deepStrictEqual(await getChatState({}, tx), {
        events: [],
        session: null,
        updatedAt: null,
      })
    })
  })

  it("defaults its input, so a caller can pass nothing", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      const snapshot = await getChatState(undefined, tx)

      assert.deepStrictEqual(snapshot.events, [])
    })
  })
})

describe("putChatState", () => {
  it("round-trips events and session through the database", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      const events = [
        { type: "user-message", text: "add a task" },
        { type: "tool-call", name: "create_task" },
      ]
      const session = { id: "sess_1", cursor: 7 }

      const written = await putChatState({ events, session }, tx)

      assert.deepStrictEqual(written.events, events)
      assert.deepStrictEqual(written.session, session)
      assert.ok(written.updatedAt instanceof Date)

      // Read back through a separate query rather than trusting the echo.
      const read = await getChatState({}, tx)
      assert.deepStrictEqual(read.events, events)
      assert.deepStrictEqual(read.session, session)
    })
  })

  it("accepts a null session", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      const written = await putChatState({ events: [], session: null }, tx)

      assert.equal(written.session, null)
      assert.deepStrictEqual((await getChatState({}, tx)).session, null)
    })
  })

  // Product spec §7.6: last write wins, no locking, no merge.
  it("overwrites a previous snapshot wholesale and bumps updatedAt", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      const first = await putChatState(
        { events: [{ n: 1 }, { n: 2 }], session: { id: "a" } },
        tx
      )

      const second = await putChatState(
        { events: [{ n: 3 }], session: null },
        tx
      )

      assert.deepStrictEqual(second.events, [{ n: 3 }])
      assert.equal(second.session, null)
      assert.ok(second.updatedAt !== null && first.updatedAt !== null)
      // Explicit updatedAt in the onConflictDoUpdate set clause: drizzle's
      // $onUpdate does not fire for an upsert, so without it this regresses.
      assert.ok(second.updatedAt!.getTime() >= first.updatedAt!.getTime())

      const [row] = await tx
        .select()
        .from(chatState)
        .where(eq(chatState.id, CHAT_STATE_ID))
      assert.deepStrictEqual(row?.events, [{ n: 3 }])
    })
  })

  it("keeps exactly one row no matter how many writes land", async () => {
    await withRollback(async (tx) => {
      await clearSnapshot(tx)

      await putChatState({ events: [], session: null }, tx)
      await putChatState({ events: [{ n: 1 }], session: null }, tx)
      await putChatState({ events: [{ n: 2 }], session: null }, tx)

      const rows = await tx.select().from(chatState)
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.id, CHAT_STATE_ID)
    })
  })
})

describe("putChatStateSchema", () => {
  it("rejects a non-array events field", () => {
    assert.throws(
      () => putChatStateSchema.parse({ events: {}, session: null }),
      z.ZodError
    )
  })

  it("rejects a missing session field — absent is not null", () => {
    assert.throws(() => putChatStateSchema.parse({ events: [] }), z.ZodError)
  })

  it("rejects an unknown key, like every other schema in lib/schemas/", () => {
    assert.throws(
      () =>
        putChatStateSchema.parse({ events: [], session: null, extra: true }),
      z.ZodError
    )
  })

  // Envelope only: the interior of an EVE event belongs to the agent runtime.
  it("accepts arbitrary event shapes", () => {
    const parsed = putChatStateSchema.parse({
      events: [1, "two", { three: [4] }, null],
      session: { anything: { nested: true } },
    })

    assert.equal(parsed.events.length, 4)
  })
})

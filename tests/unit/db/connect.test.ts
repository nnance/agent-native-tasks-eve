import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { waitForDatabase, type Database } from "../../../lib/db/connect.ts"

/**
 * `waitForDatabase` exists because Neon's free tier scales compute to zero:
 * the first connect after a suspend fails with ETIMEDOUT, and left alone that
 * reads as random test flake. These tests pin the two properties that make it
 * safe rather than a blunt retry — it only swallows *connection* errors, and it
 * still gives up.
 *
 * Deliberately no live database here. The point is the retry policy, and a real
 * connection cannot be made to fail on demand.
 */

/** A database stub whose `execute` fails a set number of times, then succeeds. */
function stubDatabase(failures: Array<{ code?: string } | Error>): {
  database: Database
  calls: () => number
} {
  let call = 0

  const database = {
    execute: async () => {
      const failure = failures[call]
      call += 1

      if (failure) throw failure
      return []
    },
  } as unknown as Database

  return { database, calls: () => call }
}

const timeout = () => Object.assign(new Error("connect ETIMEDOUT"), {
  code: "ETIMEDOUT",
})

describe("waitForDatabase", () => {
  it("returns immediately when the database is already awake", async () => {
    const { database, calls } = stubDatabase([])

    await waitForDatabase(database, { attempts: 5, delayMs: 0 })

    assert.equal(calls(), 1)
  })

  it("retries through a cold start and succeeds once the compute resumes", async () => {
    const { database, calls } = stubDatabase([timeout(), timeout()])

    await waitForDatabase(database, { attempts: 5, delayMs: 0 })

    assert.equal(calls(), 3, "should have retried twice then succeeded")
  })

  it("gives up after the attempt budget rather than hanging forever", async () => {
    const { database, calls } = stubDatabase(
      Array.from({ length: 10 }, () => timeout())
    )

    await assert.rejects(
      () => waitForDatabase(database, { attempts: 3, delayMs: 0 }),
      /ETIMEDOUT/
    )

    assert.equal(calls(), 3, "should stop at the attempt budget")
  })

  it("does not retry a real query error", async () => {
    // The whole risk of a retry helper is that it hides genuine failures.
    // A syntax error or a missing relation must surface on the first attempt.
    const { database, calls } = stubDatabase([
      Object.assign(new Error('relation "tasks" does not exist'), {
        code: "42P01",
      }),
    ])

    await assert.rejects(
      () => waitForDatabase(database, { attempts: 5, delayMs: 0 }),
      /does not exist/
    )

    assert.equal(calls(), 1, "a query error must not be retried")
  })
})

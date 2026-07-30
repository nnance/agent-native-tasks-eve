#!/usr/bin/env node
/**
 * The stdio transport, and the process entry point: `pnpm mcp`.
 *
 * MCP over stdio is newline-delimited JSON — one JSON-RPC message per line, no
 * length prefixes, no framing headers. Two rules follow from that and are the
 * only real hazards in this file:
 *
 * 1. **stdout carries protocol traffic and nothing else.** A stray `console.log`
 *    anywhere in the imported module graph corrupts the stream and the client
 *    disconnects with a parse error. Everything diagnostic goes to stderr,
 *    which the spec reserves for exactly that; `lib/db/connect.ts`'s cold-start
 *    notices already write there, which is why they are safe here.
 * 2. **A chunk is not a line.** stdin arrives in arbitrary pieces, so lines are
 *    buffered until a newline, and `\r\n` is tolerated because a client on
 *    Windows will send it.
 *
 * Why stdio is the only transport (a question plan §2.8 answers in full): it is
 * the one that gives the server a bidirectional channel, which is what makes
 * `elicitation/create` — the real approval gate — possible. A POST-only HTTP
 * transport would have to fall back to the weaker two-call token on every
 * destructive call, and would be the app's only authenticated surface while
 * every route under `app/api/` still has no auth at all, which is a misleading
 * thing to add.
 */

import { closeDb, db } from "../lib/db/client.ts"
import { waitForDatabase } from "../lib/db/connect.ts"
import { createMcpServer } from "./server.ts"

function write(message: object): void {
  // A client that has gone away turns writes into EPIPE. Nothing useful can be
  // reported over a broken pipe, so let the stdin 'end' handler exit cleanly.
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`)
  } catch {
    // Ignored deliberately; see above.
  }
}

const server = createMcpServer({ send: write })

/**
 * Messages are handled concurrently, and this is load-bearing rather than an
 * optimisation.
 *
 * `receive` does not resolve until the request is *answered*, and a `tools/call`
 * behind an approval is not answered until the user replies — which arrives as a
 * later inbound message. Serialising the feed therefore deadlocks: the answer
 * queues behind the call that is waiting for it, forever. (Written down because
 * the first version of this file did exactly that, and the symptom was a suite
 * that hung with no output rather than anything resembling its cause.)
 *
 * The protocol permits concurrent requests and imposes no ordering, so nothing
 * is given up. In-flight work is tracked only so that shutdown can drain it.
 */
const inFlight = new Set<Promise<void>>()

function dispatch(line: string): void {
  const handled = server
    .receive(line)
    .catch((error: unknown) => {
      process.stderr.write(
        `mcp: failed to handle a message: ${
          error instanceof Error ? error.stack : String(error)
        }\n`
      )
    })
    .finally(() => {
      inFlight.delete(handled)
    })

  inFlight.add(handled)
}

let buffer = ""

process.stdin.setEncoding("utf8")

process.stdin.on("data", (chunk: string) => {
  buffer += chunk

  let newline = buffer.indexOf("\n")

  while (newline !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "")
    buffer = buffer.slice(newline + 1)

    if (line.trim() !== "") dispatch(line)

    newline = buffer.indexOf("\n")
  }
})

process.stdin.on("end", () => {
  // Drain whatever was in flight, release the pool, and go. Without the close
  // the pooled connections keep the event loop alive and the process hangs.
  //
  // A call still parked on an unanswered approval cannot be drained — the client
  // has gone, so no answer is coming — so the wait is bounded and the pool is
  // released either way.
  const drained = Promise.allSettled([...inFlight])
  const deadline = new Promise((resolve) => setTimeout(resolve, 2_000).unref())

  void Promise.race([drained, deadline]).finally(async () => {
    await closeDb()
    process.exit(0)
  })
})

// Neon's free tier suspends idle compute, and the first connect after a suspend
// can fail outright (see lib/db/connect.ts). Waking the database before the
// first tool call turns a mystifying `tools/call` failure into a few seconds of
// startup, and stderr is where a client shows this to its operator.
void waitForDatabase(db).catch((error: unknown) => {
  process.stderr.write(
    `mcp: the database is not reachable: ${
      error instanceof Error ? error.message : String(error)
    }\n`
  )
})

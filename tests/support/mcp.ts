/**
 * An in-process MCP client, for driving `mcp/server.ts` from a unit test.
 *
 * The server is transport-agnostic — it takes a `send` sink and a `receive`
 * feed — so a test can be the other end of the wire without a child process,
 * a socket, or a mock of anything. `tests/mcp/` covers the real stdio framing
 * and the real entry point; everything else is cheaper and clearer here.
 *
 * Two details make it work:
 *
 * - **`receive` resolves when the request is answered**, so `request()` can
 *   simply await it and read the reply out of the outbox.
 * - **A server→client request (an elicitation) is answered on a microtask**,
 *   not synchronously inside `send`. The `tools/call` that raised it is still
 *   suspended at that moment; answering re-enters `receive`, and doing that
 *   from a microtask keeps the two nestings from sharing a stack frame.
 */

import type { Database } from "../../lib/db/client.ts"
import type { ElicitResult } from "../../mcp/guard.ts"
import { createMcpServer, LATEST_PROTOCOL_VERSION } from "../../mcp/server.ts"

export type JsonRpcMessage = {
  jsonrpc: "2.0"
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

/** A `tools/call` result, unwrapped into the payload the model would read. */
export type ToolCallOutcome = {
  isError: boolean
  payload: Record<string, unknown>
  /** The raw MCP result, for assertions about the envelope itself. */
  result: Record<string, unknown>
}

/** How the test answers `elicitation/create`. Defaults to accepting. */
export type ElicitHandler = (
  params: Record<string, unknown>
) => ElicitResult | Promise<ElicitResult>

export type TestMcpClient = {
  initialize: (options?: {
    elicitation?: boolean
    protocolVersion?: string
  }) => Promise<JsonRpcMessage>
  request: (
    method: string,
    params?: Record<string, unknown>
  ) => Promise<JsonRpcMessage>
  notify: (method: string, params?: Record<string, unknown>) => Promise<void>
  /** Feeds a raw line in and returns everything the server said in response. */
  sendRaw: (raw: string) => Promise<JsonRpcMessage[]>
  call: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<ToolCallOutcome>
  /** Answers the next elicitations with `handler`. */
  onElicit: (handler: ElicitHandler) => void
  /** Every `elicitation/create` params object the server has sent, in order. */
  elicitations: Record<string, unknown>[]
}

export function createTestMcpClient(
  options: { database?: Database; sessionId?: string } = {}
): TestMcpClient {
  const outbox: JsonRpcMessage[] = []
  const elicitations: Record<string, unknown>[] = []
  const waiting = new Map<string | number, (message: JsonRpcMessage) => void>()

  let elicitHandler: ElicitHandler = () => ({
    action: "accept",
    content: { confirm: true },
  })

  const server = createMcpServer({
    database: options.database,
    sessionId: options.sessionId,
    send: (message) => {
      const envelope = message as JsonRpcMessage
      outbox.push(envelope)

      if (envelope.method !== undefined && envelope.id !== undefined) {
        if (envelope.method === "elicitation/create") {
          elicitations.push(envelope.params ?? {})
        }

        void Promise.resolve().then(async () => {
          const answer = await elicitHandler(envelope.params ?? {})

          await server.receive(
            JSON.stringify({ jsonrpc: "2.0", id: envelope.id, result: answer })
          )
        })

        return
      }

      const settle =
        envelope.id === undefined || envelope.id === null
          ? undefined
          : waiting.get(envelope.id)

      if (settle && envelope.id !== undefined && envelope.id !== null) {
        waiting.delete(envelope.id)
        settle(envelope)
      }
    },
  })

  let nextId = 0

  async function sendRaw(raw: string): Promise<JsonRpcMessage[]> {
    const before = outbox.length
    await server.receive(raw)
    return outbox.slice(before)
  }

  async function request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<JsonRpcMessage> {
    nextId += 1
    const id = nextId
    const answered = new Promise<JsonRpcMessage>((resolve) => {
      waiting.set(id, resolve)
    })

    await server.receive(JSON.stringify({ jsonrpc: "2.0", id, method, params }))

    return answered
  }

  async function notify(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    await server.receive(JSON.stringify({ jsonrpc: "2.0", method, params }))
  }

  return {
    elicitations,
    onElicit: (handler) => {
      elicitHandler = handler
    },
    sendRaw,
    request,
    notify,
    initialize: async ({
      elicitation = false,
      protocolVersion = LATEST_PROTOCOL_VERSION,
    } = {}) => {
      const answered = await request("initialize", {
        protocolVersion,
        capabilities: elicitation ? { elicitation: {} } : {},
        clientInfo: { name: "tests/support/mcp", version: "0" },
      })

      await notify("notifications/initialized")

      return answered
    },
    call: async (name, args = {}) => {
      const answered = await request("tools/call", { name, arguments: args })
      const result = answered.result

      if (!result) {
        throw new Error(
          `tools/call ${name} did not return a result: ${JSON.stringify(answered)}`
        )
      }

      const content = result.content as { type: string; text: string }[]

      return {
        isError: result.isError === true,
        payload: JSON.parse(content[0]!.text) as Record<string, unknown>,
        result,
      }
    },
  }
}

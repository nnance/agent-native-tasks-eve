/**
 * The MCP protocol core: JSON-RPC 2.0 in, JSON-RPC 2.0 out, transport-agnostic.
 *
 * Hand-authored rather than taken from `@modelcontextprotocol/sdk`, which is a
 * deliberate application of the implementation plan's §1.1 dependency policy
 * and is recorded there with its reasoning. The short version: the SDK brings
 * `express`, `hono`, `cors`, `ajv`, `jose`, `eventsource` and
 * `zod-to-json-schema` into a Next app to give us a JSON-RPC dispatcher, and
 * zod 4 already generates the JSON Schema the protocol wants
 * (`z.toJSONSchema`), so what the SDK would actually be doing for us is this
 * file — which is smaller than the argument for adding it.
 *
 * What it implements, against protocol revision 2025-11-25:
 *
 * | direction | method                  | notes                              |
 * | --------- | ----------------------- | ---------------------------------- |
 * | in        | `initialize`            | version negotiation + capabilities |
 * | in        | `ping`                  | empty result                       |
 * | in        | `tools/list`            | the §2.4 inventory, JSON Schema'd  |
 * | in        | `tools/call`            | gate, then one shared action       |
 * | in        | `notifications/*`       | accepted and ignored               |
 * | out       | `elicitation/create`    | the approval gate (`mcp/guard.ts`) |
 *
 * Deliberately absent: resources, prompts, completions, logging, tasks,
 * pagination and JSON-RPC batching. The first five would be capability the EVE
 * agent does not have, which is the half of "no more and no less" that is easy
 * to get wrong; pagination is unnecessary because list results are trimmed, not
 * paged, exactly as they are for the internal agent; batching was removed from
 * the protocol in 2025-06-18.
 *
 * Errors follow the protocol's split, which happens to match `lib/api/respond`:
 * anything the *tool* produced — invalid input, a missing row, a refused rule,
 * a declined confirmation — comes back as a result with `isError: true` so the
 * model can read it and correct itself; only failures to *find* or *frame* a
 * call are JSON-RPC errors. An unexpected throw is rethrown as `-32603`, the
 * same choice `respond()` makes in answering 500 rather than dressing a defect
 * up as a considered answer.
 */

import { readFileSync } from "node:fs"

import { z } from "zod"

import type { Database } from "../lib/db/client.ts"
import {
  CONFIRMATION_TOKEN,
  createGateSession,
  gate,
  tokenPathAvailable,
  type Elicit,
  type GateSession,
} from "./guard.ts"
import { INVENTORY, TOOLS_BY_NAME, type McpToolEntry } from "./inventory.ts"

/** The newest revision this server speaks. */
export const LATEST_PROTOCOL_VERSION = "2025-11-25"

/**
 * Revisions we will negotiate down to, newest first. Dates sort lexically, so
 * comparing them as strings is exact rather than clever.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const

/** `elicitation/create` was introduced in this revision. */
const ELICITATION_SINCE = "2025-06-18"

const repoRoot = new URL("../", import.meta.url)

/** Named for the app, not for the transport: one server, three front doors. */
export const SERVER_INFO = {
  name: "agent-native-tasks",
  title: "Agent-Native Task Manager",
  version: JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"))
    .version as string,
}

/**
 * The `instructions` a host may fold into its system prompt. The sibling of
 * `agent/instructions.md`, and the same house rules; see the file itself for
 * where and why the two differ.
 */
export const INSTRUCTIONS = readFileSync(
  new URL("./instructions.md", import.meta.url),
  "utf8"
).trim()

/**
 * The one field an elicitation asks for. The protocol restricts
 * `requestedSchema` to flat primitives, which is enough: the question is always
 * "do this, yes or no", with the detail carried in `message`.
 */
const CONFIRM_SCHEMA = {
  type: "object",
  properties: {
    confirm: {
      type: "boolean",
      title: "Confirm",
      description: "Yes — make this change.",
    },
  },
  required: ["confirm"],
} as const

type JsonRpcId = string | number

/** JSON-RPC error codes, with the two MCP adds to the reserved set. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/**
 * `z.toJSONSchema` output, cached per tool. `$schema` is dropped: the protocol
 * already fixes the dialect at 2020-12, and an unused key in every tool
 * description is nineteen wasted lines of the model's context.
 */
const schemaCache = new Map<string, Record<string, unknown>>()

function jsonSchemaFor(entry: McpToolEntry): Record<string, unknown> {
  const cached = schemaCache.get(entry.name)
  if (cached) return cached

  const schema = z.toJSONSchema(entry.schema, { io: "input" }) as Record<
    string,
    unknown
  >

  delete schema.$schema

  schemaCache.set(entry.name, schema)
  return schema
}

/**
 * What a client is told it may pass.
 *
 * For a client that can be asked a question, this is the shared `lib/schemas`
 * object and nothing else — the same contract the API route parses and the EVE
 * tool advertises. For a client that cannot, the gated tools gain one optional
 * transport field, `confirmationToken`, because the two-call fallback has to be
 * expressible for the caller to use it. The domain contract is untouched either
 * way: `mcp/server.ts` strips the field before the schema ever sees it, so no
 * action is reachable with an argument the other two interfaces lack.
 */
function advertisedSchema(
  entry: McpToolEntry,
  session: GateSession
): Record<string, unknown> {
  const schema = jsonSchemaFor(entry)

  if (entry.gate === "none" || !tokenPathAvailable(session)) return schema

  const properties = {
    ...((schema.properties as Record<string, unknown>) ?? {}),
    [CONFIRMATION_TOKEN]: {
      type: "string",
      description:
        "The token from this tool's previous needs_confirmation result. " +
        "Include it only after the user has agreed to the change described " +
        "there; it is single-use and bound to these exact arguments.",
    },
  }

  return { ...schema, properties }
}

export type McpServer = {
  /** Feeds one inbound message in, as a JSON string or an already-parsed value. */
  receive: (raw: string | object) => Promise<void>
  /** The gate state for this connection, exposed for tests and diagnostics. */
  session: GateSession
}

export function createMcpServer(options: {
  send: (message: object) => void
  database?: Database
  sessionId?: string
}): McpServer {
  const { send, database } = options
  const session = createGateSession(options.sessionId)

  let handshakeComplete = false
  let negotiatedVersion: string = LATEST_PROTOCOL_VERSION

  /** Outbound request bookkeeping. String ids cannot collide with a client's. */
  let outboundCount = 0
  const pending = new Map<
    JsonRpcId,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >()

  function reply(id: JsonRpcId, result: object): void {
    send({ jsonrpc: "2.0", id, result })
  }

  function fail(id: JsonRpcId | null, code: number, message: string): void {
    // A malformed message with no usable id still gets an answer, per JSON-RPC.
    send({ jsonrpc: "2.0", id, error: { code, message } })
  }

  /** Sends a request to the client and resolves with its result. */
  function request(method: string, params: object): Promise<unknown> {
    outboundCount += 1
    const id = `server-${outboundCount}`

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      send({ jsonrpc: "2.0", id, method, params })
    })
  }

  /**
   * Asks the user, through the client, to confirm one change.
   *
   * Any failure — a client that declared the capability and then answered with
   * an error, a malformed result — is read as `cancel`. The gate fails closed:
   * nothing runs unless a person said yes.
   */
  const elicit: Elicit = async (message) => {
    try {
      const result = (await request("elicitation/create", {
        message,
        requestedSchema: CONFIRM_SCHEMA,
      })) as { action?: unknown; content?: unknown }

      const action = result.action

      if (action === "accept" || action === "decline" || action === "cancel") {
        return {
          action,
          content:
            typeof result.content === "object" && result.content !== null
              ? (result.content as Record<string, unknown>)
              : undefined,
        }
      }

      return { action: "cancel" }
    } catch {
      return { action: "cancel" }
    }
  }

  function handleInitialize(
    id: JsonRpcId,
    params: Record<string, unknown>
  ): void {
    const requested = params.protocolVersion
    negotiatedVersion =
      typeof requested === "string" &&
      (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION

    const capabilities = (params.capabilities ?? {}) as Record<string, unknown>

    session.canElicit =
      capabilities.elicitation !== undefined &&
      capabilities.elicitation !== null &&
      negotiatedVersion >= ELICITATION_SINCE

    handshakeComplete = true

    reply(id, {
      protocolVersion: negotiatedVersion,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    })
  }

  function handleToolsList(id: JsonRpcId): void {
    reply(id, {
      tools: INVENTORY.map((entry) => ({
        name: entry.name,
        description: entry.description,
        inputSchema: advertisedSchema(entry, session),
        annotations: entry.annotations,
      })),
    })
  }

  /** One tool result, in the shape a model reads. */
  function toolResult(payload: unknown): object {
    const ok = (payload as { ok?: unknown }).ok === true

    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: !ok,
    }
  }

  async function handleToolsCall(
    id: JsonRpcId,
    params: Record<string, unknown>
  ): Promise<void> {
    const name = params.name
    const entry = typeof name === "string" ? TOOLS_BY_NAME.get(name) : undefined

    if (!entry) {
      fail(id, INVALID_PARAMS, `Unknown tool: ${String(name)}.`)
      return
    }

    const rawArguments = params.arguments

    if (
      rawArguments !== undefined &&
      (typeof rawArguments !== "object" ||
        rawArguments === null ||
        Array.isArray(rawArguments))
    ) {
      fail(id, INVALID_PARAMS, "`arguments` must be a JSON object.")
      return
    }

    const { [CONFIRMATION_TOKEN]: rawToken, ...args } =
      (rawArguments as Record<string, unknown>) ?? {}
    const token = typeof rawToken === "string" ? rawToken : undefined

    // The schema is consulted here only to decide whether asking a person to
    // confirm is even meaningful. A call that cannot pass its own schema goes
    // straight to the action, which produces the same `invalid_input` result
    // the other two interfaces produce, without troubling anyone about a change
    // that was never going to happen.
    const parsed = entry.schema.safeParse(args)

    if (parsed.success) {
      const outcome = await gate({
        entry,
        input: parsed.data,
        token,
        session,
        elicit,
        database,
      })

      if (!outcome.proceed) {
        reply(id, toolResult(outcome.refusal))
        return
      }
    }

    reply(id, toolResult(await entry.call(args, database)))
  }

  async function handleRequest(
    id: JsonRpcId,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (method === "initialize") {
      handleInitialize(id, params)
      return
    }

    if (method === "ping") {
      reply(id, {})
      return
    }

    if (!handshakeComplete) {
      fail(
        id,
        INVALID_REQUEST,
        `Received ${method} before initialize. Send initialize first.`
      )
      return
    }

    if (method === "tools/list") {
      handleToolsList(id)
      return
    }

    if (method === "tools/call") {
      await handleToolsCall(id, params)
      return
    }

    fail(id, METHOD_NOT_FOUND, `Method not found: ${method}.`)
  }

  async function receive(raw: string | object): Promise<void> {
    let message: unknown = raw

    if (typeof raw === "string") {
      try {
        message = JSON.parse(raw)
      } catch {
        fail(null, PARSE_ERROR, "Parse error: the message was not valid JSON.")
        return
      }
    }

    if (Array.isArray(message)) {
      fail(
        null,
        INVALID_REQUEST,
        "JSON-RPC batches are not supported; send one message per line."
      )
      return
    }

    if (message === null || typeof message !== "object") {
      fail(null, INVALID_REQUEST, "A message must be a JSON object.")
      return
    }

    const { id, method, result, error } = message as {
      id?: unknown
      method?: unknown
      result?: unknown
      error?: unknown
    }

    // A response to one of our own requests — today, only an elicitation.
    if (method === undefined) {
      const waiting =
        typeof id === "string" || typeof id === "number"
          ? pending.get(id)
          : undefined

      if (!waiting || typeof id !== "string") return

      pending.delete(id)

      if (error !== undefined) {
        waiting.reject(
          new Error(
            `The client answered with an error: ${JSON.stringify(error)}.`
          )
        )
        return
      }

      waiting.resolve(result)
      return
    }

    if (typeof method !== "string") {
      fail(
        typeof id === "string" || typeof id === "number" ? id : null,
        INVALID_REQUEST,
        "`method` must be a string."
      )
      return
    }

    const params =
      typeof (message as { params?: unknown }).params === "object" &&
      (message as { params?: unknown }).params !== null
        ? (message as { params: Record<string, unknown> }).params
        : {}

    // A notification. Nothing we accept requires an answer, and the protocol
    // requires unknown ones to be ignored rather than answered.
    if (id === undefined || id === null) return

    if (typeof id !== "string" && typeof id !== "number") {
      fail(null, INVALID_REQUEST, "`id` must be a string or a number.")
      return
    }

    try {
      await handleRequest(id, method, params)
    } catch (cause) {
      // A genuine defect — every expected failure was mapped by runAction long
      // before here. Reported, not swallowed, and not disguised as a refusal.
      fail(
        id,
        INTERNAL_ERROR,
        cause instanceof Error ? cause.message : String(cause)
      )
    }
  }

  return { receive, session }
}

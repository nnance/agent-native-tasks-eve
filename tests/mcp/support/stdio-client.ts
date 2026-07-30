/**
 * A real MCP client for the real server process.
 *
 * `tests/unit/mcp/` drives `createMcpServer` in-process, which covers the
 * protocol and the gate but never the two things that only exist out here: the
 * newline framing in `mcp/stdio.ts`, and the entry point a host actually spawns.
 * A chunk is not a line, stdout must carry nothing but JSON-RPC, and both are
 * easy to break and impossible to notice in-process.
 *
 * DATABASE_URL is passed in the child's environment, never on the command line,
 * so no credential reaches a process listing — the same discipline
 * tests/api/support/server.ts follows, for the same reason.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

import { resolveTestDbUrl } from "../../../lib/db/urls.ts"

const serverPath = fileURLToPath(
  new URL("../../../mcp/stdio.ts", import.meta.url)
)

type Envelope = {
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

export type ElicitAnswer = {
  action: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}

export type StdioClient = {
  initialize: (options?: { elicitation?: boolean }) => Promise<Envelope>
  request: (
    method: string,
    params?: Record<string, unknown>
  ) => Promise<Envelope>
  /** Sends several requests in a single write, forcing them into one chunk. */
  oneChunk: (
    requests: { method: string; params?: Record<string, unknown> }[]
  ) => Promise<Envelope[]>
  /** Sends one request in two writes, splitting it mid-line. */
  split: (method: string, params?: Record<string, unknown>) => Promise<Envelope>
  call: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ isError: boolean; payload: Record<string, unknown> }>
  onElicit: (handler: (params: Record<string, unknown>) => ElicitAnswer) => void
  elicitations: Record<string, unknown>[]
  /** Whatever the child wrote to stderr, for diagnosing a failed boot. */
  stderr: () => string
  stop: () => Promise<void>
}

export function startStdioServer(): StdioClient {
  const child: ChildProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      DATABASE_URL: resolveTestDbUrl(),
      // Left unset deliberately: the fallback path is what a plain client sees.
      MCP_REQUIRE_ELICITATION: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  })

  const waiting = new Map<string | number, (message: Envelope) => void>()
  const elicitations: Record<string, unknown>[] = []
  let errorOutput = ""
  let buffer = ""
  let nextId = 0

  let elicitHandler = (): ElicitAnswer => ({
    action: "accept",
    content: { confirm: true },
  })

  function write(message: object): void {
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  }

  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    errorOutput = (errorOutput + chunk).slice(-20_000)
  })

  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk

    let newline = buffer.indexOf("\n")

    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf("\n")

      if (line.trim() === "") continue

      // Anything unparseable here is the failure this suite exists to catch:
      // something wrote to stdout that was not a protocol message.
      const message = JSON.parse(line) as Envelope

      if (message.method === "elicitation/create") {
        elicitations.push(message.params ?? {})
        write({ jsonrpc: "2.0", id: message.id, result: elicitHandler() })
        continue
      }

      const settle =
        message.id === undefined || message.id === null
          ? undefined
          : waiting.get(message.id)

      if (settle && message.id !== undefined && message.id !== null) {
        waiting.delete(message.id)
        settle(message)
      }
    }
  })

  /** Allocates an id and the promise for its answer, without writing yet. */
  function prepare(
    method: string,
    params: Record<string, unknown> = {}
  ): { line: string; answered: Promise<Envelope> } {
    nextId += 1
    const id = nextId
    const answered = new Promise<Envelope>((resolve) => {
      waiting.set(id, resolve)
    })

    return {
      line: `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      answered,
    }
  }

  async function request(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Envelope> {
    const { line, answered } = prepare(method, params)

    child.stdin?.write(line)

    return answered
  }

  return {
    elicitations,
    stderr: () => errorOutput,
    onElicit: (handler) => {
      elicitHandler = () => handler({})
    },
    oneChunk: async (requests) => {
      const prepared = requests.map((entry) =>
        prepare(entry.method, entry.params)
      )

      child.stdin?.write(prepared.map((entry) => entry.line).join(""))

      return Promise.all(prepared.map((entry) => entry.answered))
    },
    split: async (method, params) => {
      const { line, answered } = prepare(method, params)
      const at = Math.floor(line.length / 2)

      child.stdin?.write(line.slice(0, at))
      // A tick, so the child really does see two separate 'data' events.
      await new Promise((resolve) => setTimeout(resolve, 10))
      child.stdin?.write(line.slice(at))

      return answered
    },
    request,
    initialize: async ({ elicitation = false } = {}) => {
      const answered = await request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: elicitation ? { elicitation: {} } : {},
        clientInfo: { name: "tests/mcp", version: "0" },
      })

      write({ jsonrpc: "2.0", method: "notifications/initialized" })

      return answered
    },
    call: async (name, args = {}) => {
      const answered = await request("tools/call", { name, arguments: args })
      const result = answered.result

      if (!result) {
        throw new Error(
          `tools/call ${name} failed: ${JSON.stringify(answered)}\n` +
            `--- server stderr ---\n${errorOutput}`
        )
      }

      const content = result.content as { text: string }[]

      return {
        isError: result.isError === true,
        payload: JSON.parse(content[0]!.text) as Record<string, unknown>,
      }
    },
    stop: async () => {
      if (child.exitCode !== null) return

      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve())
      })

      // Closing stdin is the documented shutdown for a stdio server; the child
      // drains, releases its pool, and exits 0.
      child.stdin?.end()

      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)

      await exited
      clearTimeout(timeout)
    },
  }
}

/**
 * The protocol half of the MCP server: the handshake, what `tools/list`
 * advertises, and the line between "the tool refused" and "the request was
 * malformed".
 *
 * No database is touched — nothing here executes a tool — which is what keeps
 * the protocol assertions independent of the domain ones in call.test.ts.
 *
 * The `tools/list` cases carry the most weight. They are where the parity
 * contract of plan §2.1 becomes visible on the wire: a client that can be asked
 * a question is served the shared `lib/schemas` object and nothing else, and a
 * client that cannot is served the same thing plus exactly one optional
 * transport field on exactly the gate-able tools.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { z } from "zod"

import { CONFIRMATION_TOKEN } from "../../../mcp/guard.ts"
import { INVENTORY } from "../../../mcp/inventory.ts"
import { LATEST_PROTOCOL_VERSION, SERVER_INFO } from "../../../mcp/server.ts"
import { createTestMcpClient } from "../../support/mcp.ts"

/**
 * What the shared schema object looks like as JSON Schema, derived here rather
 * than imported from the server so the two are genuinely compared.
 */
function sharedSchema(schema: z.ZodType) {
  const expected = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >

  // The protocol fixes the dialect at 2020-12; the server drops the key.
  delete expected.$schema

  return expected
}

type AdvertisedTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean>
}

async function listTools(options: {
  elicitation?: boolean
  protocolVersion?: string
}): Promise<AdvertisedTool[]> {
  const client = createTestMcpClient()
  await client.initialize(options)
  const answered = await client.request("tools/list")

  return answered.result?.tools as AdvertisedTool[]
}

describe("initialize", () => {
  it("negotiates the version the client asked for when we speak it", async () => {
    const client = createTestMcpClient()
    const answered = await client.initialize({ protocolVersion: "2025-06-18" })

    assert.equal(answered.result?.protocolVersion, "2025-06-18")
  })

  it("answers with our latest when the client asks for one we do not speak", async () => {
    // Per the spec the client then decides whether it can live with that.
    const client = createTestMcpClient()
    const answered = await client.initialize({ protocolVersion: "1999-01-01" })

    assert.equal(answered.result?.protocolVersion, LATEST_PROTOCOL_VERSION)
  })

  it("declares tools, and nothing it does not implement", async () => {
    const client = createTestMcpClient()
    const answered = await client.initialize()

    assert.deepEqual(answered.result?.capabilities, { tools: {} })
    assert.deepEqual(answered.result?.serverInfo, SERVER_INFO)
  })

  it("ships instructions for the host's system prompt", async () => {
    const client = createTestMcpClient()
    const answered = await client.initialize()
    const instructions = answered.result?.instructions

    assert.equal(typeof instructions, "string")
    assert.ok((instructions as string).includes("needs_confirmation"))
  })

  it("answers ping before the handshake, but nothing else", async () => {
    const client = createTestMcpClient()

    assert.deepEqual((await client.request("ping")).result, {})

    const tooEarly = await client.request("tools/list")

    assert.equal(tooEarly.error?.code, -32600)
    assert.match(tooEarly.error?.message ?? "", /before initialize/)
  })
})

describe("tools/list", () => {
  it("advertises every capability, with its annotations", async () => {
    const tools = await listTools({ elicitation: true })

    assert.deepEqual(
      tools.map((tool) => tool.name),
      INVENTORY.map((entry) => entry.name)
    )

    for (const tool of tools) {
      const entry = INVENTORY.find((candidate) => candidate.name === tool.name)

      assert.deepEqual(tool.annotations, entry?.annotations)
      assert.equal(tool.description, entry?.description)
    }
  })

  it("serves the shared schema verbatim to a client that can be asked", async () => {
    const tools = await listTools({ elicitation: true })

    for (const tool of tools) {
      const entry = INVENTORY.find((candidate) => candidate.name === tool.name)!

      assert.deepEqual(
        tool.inputSchema,
        sharedSchema(entry.schema),
        `${tool.name} does not advertise its shared schema unchanged.`
      )
    }
  })

  it("adds confirmationToken only to gate-able tools, only when it is usable", async () => {
    const tools = await listTools({ elicitation: false })

    const withToken = tools
      .filter((tool) =>
        Object.hasOwn(
          tool.inputSchema.properties as Record<string, unknown>,
          CONFIRMATION_TOKEN
        )
      )
      .map((tool) => tool.name)

    assert.deepEqual(
      withToken.sort(),
      INVENTORY.filter((entry) => entry.gate !== "none")
        .map((entry) => entry.name)
        .sort()
    )

    // Everything else about the schema is untouched, including the strictness
    // that makes an unknown key a loud error rather than a silent strip.
    for (const tool of tools) {
      const entry = INVENTORY.find((candidate) => candidate.name === tool.name)!
      const properties = {
        ...(tool.inputSchema.properties as Record<string, unknown>),
      }

      delete properties[CONFIRMATION_TOKEN]

      assert.deepEqual(
        { ...tool.inputSchema, properties },
        sharedSchema(entry.schema)
      )
    }
  })

  it("does not offer the token when the server demands a human answer", async (t) => {
    // MCP_REQUIRE_ELICITATION makes the fallback unreachable, so advertising a
    // field no call could ever redeem would be a lie to the model.
    const previous = process.env.MCP_REQUIRE_ELICITATION
    process.env.MCP_REQUIRE_ELICITATION = "1"
    t.after(() => {
      if (previous === undefined) delete process.env.MCP_REQUIRE_ELICITATION
      else process.env.MCP_REQUIRE_ELICITATION = previous
    })

    const tools = await listTools({ elicitation: false })

    for (const tool of tools) {
      assert.ok(
        !Object.hasOwn(
          tool.inputSchema.properties as Record<string, unknown>,
          CONFIRMATION_TOKEN
        ),
        `${tool.name} advertised a token that can never be redeemed.`
      )
    }
  })

  it("treats a pre-elicitation protocol version as unable to be asked", async () => {
    // A client claiming the capability on a revision that did not have it gets
    // the fallback rather than a request it cannot answer.
    const tools = await listTools({
      elicitation: true,
      protocolVersion: "2025-03-26",
    })
    const deleteTask = tools.find((tool) => tool.name === "delete_task")!

    assert.ok(
      Object.hasOwn(
        deleteTask.inputSchema.properties as Record<string, unknown>,
        CONFIRMATION_TOKEN
      )
    )
  })
})

describe("malformed traffic", () => {
  it("answers a parse error with -32700 and a null id", async () => {
    const client = createTestMcpClient()
    const [answered] = await client.sendRaw("{ not json")

    assert.equal(answered?.id, null)
    assert.equal(answered?.error?.code, -32700)
  })

  it("refuses a JSON-RPC batch", async () => {
    const client = createTestMcpClient()
    const [answered] = await client.sendRaw('[{"jsonrpc":"2.0","id":1}]')

    assert.equal(answered?.error?.code, -32600)
    assert.match(answered?.error?.message ?? "", /batch/)
  })

  it("answers an unknown method with -32601", async () => {
    const client = createTestMcpClient()
    await client.initialize()

    assert.equal((await client.request("resources/list")).error?.code, -32601)
  })

  it("answers an unknown tool with -32602, not a tool error", async () => {
    // "errors in finding the tool" are protocol errors; only errors the tool
    // itself produced belong in a result the model can read.
    const client = createTestMcpClient()
    await client.initialize()

    const answered = await client.request("tools/call", {
      name: "delete_everything",
      arguments: {},
    })

    assert.equal(answered.error?.code, -32602)
    assert.match(answered.error?.message ?? "", /Unknown tool/)
  })

  it("rejects non-object arguments", async () => {
    const client = createTestMcpClient()
    await client.initialize()

    const answered = await client.request("tools/call", {
      name: "list_projects",
      arguments: ["nope"] as unknown as Record<string, unknown>,
    })

    assert.equal(answered.error?.code, -32602)
  })

  it("says nothing at all in reply to a notification", async () => {
    const client = createTestMcpClient()
    await client.initialize()

    assert.deepEqual(
      await client.sendRaw(
        '{"jsonrpc":"2.0","method":"notifications/whatever"}'
      ),
      []
    )
  })
})

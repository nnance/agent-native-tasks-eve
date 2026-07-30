# The MCP server

A third front door onto the shared action layer, alongside the REST routes under
`app/api/` and the EVE tools under `agent/tools/`. It gives an **external** agent
— one running in someone else's host — the same nineteen capabilities the
internal agent has, and no others.

```
                        lib/actions/*  ← every product rule lives here
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   app/api/*            agent/tools/*            mcp/*
   (the UI)             (EVE, in-app)       (an external agent)
```

Read `../docs/implementation-plan.md` §2.8 for where this sits in the
architecture, and `../docs/decisions/mcp-server-decisions.md` for why each
design question was answered the way it was.

## Running it

```bash
pnpm mcp          # speaks MCP over stdin/stdout
```

It needs `DATABASE_URL`. `lib/env.ts` loads `.env.local` from the working
directory when the variable is not already set, so **a host must be given a
`cwd`** or be handed the variable directly.

Wiring it into a host that reads `mcpServers` config:

```json
{
  "mcpServers": {
    "tasks": {
      "command": "pnpm",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/agent-native-tasks-eve"
    }
  }
}
```

Nothing but JSON-RPC may be written to stdout. Diagnostics go to stderr, which
is where a host shows them to its operator.

## What it serves

The nineteen tools of product spec §5, under the same names the internal agent
uses, with the **same `lib/schemas` objects** as their input schemas — rendered
to JSON Schema by zod's own `z.toJSONSchema`, so there is no second definition of
any shape to drift.

`initialize` returns `instructions` (see `instructions.md`), the sibling of
`agent/instructions.md`: the same house rules, adapted to a caller who has no
chat pane.

List results are trimmed exactly as they are for the internal agent — a count
plus compact rows, via the shared `lib/compact.ts` — and `get_task` is the escape
hatch for a task's full text.

## Approval: what parity does and does not mean

This is the one place where the interfaces genuinely differ, so it is written
down rather than implied.

**Identical across all three front doors:** the capability set, the input
schemas, every rule in product spec §7, the error vocabulary, list ordering and
trimming. No destructive operation is reachable in a single call from any of
them.

**Not identical: who confirms, and whether a person does at all.**

| | internal agent (EVE) | external agent (MCP) |
|---|---|---|
| Mechanism | `always()` → durable `input.requested` pause | `elicitation/create`, else a confirmation token |
| Who answers | the person who owns the data, in the chat pane | whoever is driving the MCP client |
| Survives a restart | yes — the pause is durable | no — the session dies with the pipe |
| Can the caller self-approve? | never | **on the token path, yes** |

The token path is the honest weak spot. It buys two round trips with a
plain-language statement of the consequences in between — which a host that shows
tool traffic to a person surfaces, and a headless one does not. A caller with no
human attached can satisfy it alone. No amount of server-side code closes that,
because the server has no channel to a human that the client did not give it.

If you need the stronger promise, set **`MCP_REQUIRE_ELICITATION=1`**: gated
tools then refuse outright for any client that cannot ask a person, instead of
degrading to the token.

Three further limits, stated rather than discovered:

- **`annotations.destructiveHint` is advisory.** Most hosts prompt before running
  a tool and use these hints to decide how loudly. None of that is enforced here.
- **`update_task` is gated per session, not per turn.** Product spec §6 calls a
  change to more than one task a bulk change; EVE counts within a turn, and MCP
  has no turn, so the session is the scope. That is *stricter* than EVE inside one
  connection (a long session accumulates) and resets on reconnect. `bulk_update_tasks`
  remains the right tool for a multi-task change — one confirmation, atomic.
- **Gate state is in memory.** Tokens and the edit count live in the process, so a
  restart forgets them. It fails open only in the sense that a *second* task edit
  runs free again; nothing that requires confirmation ever runs without one.

## Deliberately not implemented

Resources, prompts, completions, logging, sampling, tasks, pagination, and
JSON-RPC batching. The first six would be capability the internal agent does not
have, which is the half of "no more and no less" that is easy to get wrong.
Pagination is unnecessary because list results are trimmed rather than paged, the
same choice the internal agent lives with. Batching was removed from the protocol
in revision 2025-06-18.

There is **no HTTP transport**, and that is a decision rather than an omission:
`elicitation/create` needs a channel back to the client, which a POST-only
Streamable HTTP endpoint does not have, so every destructive call on it would
degrade to the token — on the surface most exposed to the internet. It would also
be the only authenticated route in an app whose entire `app/api/` tree has no
auth at all, which invites exactly the wrong conclusion about the rest.

## Tests

| Suite | What only it can prove |
|---|---|
| `tests/unit/mcp/inventory.test.ts` | parity with `agent/tools/`, derived by import |
| `tests/unit/mcp/server.test.ts` | the handshake, what `tools/list` advertises, malformed traffic |
| `tests/unit/mcp/call.test.ts` | results, rule relaying, and the gate, against a rolled-back transaction |
| `tests/mcp/index.test.ts` | the spawned process: framing, a clean stdout, real commits |

```bash
pnpm test:mcp     # the spawned-process suite
pnpm test         # unit, then api, then mcp — in sequence, see tests/mcp/index.test.ts
```

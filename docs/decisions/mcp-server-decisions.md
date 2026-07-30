# MCP server — decisions

**Built after Phase 6, outside the numbered phase plan.** Recorded in the same
form as `phase-N-decisions.md` because the reasoning matters more than the code:
this is a third interface over the shared action layer (plan §2.8), and the
interesting part is what could *not* be mirrored from the other two.

---

## 1. Approval semantics — the crux

### The premise needed correcting first

The brief said MCP has no equivalent of EVE's server-side pause primitive. It
does: **`elicitation/create`**, a request the *server* sends to the client
mid-tool-call, which blocks until the client answers `accept` / `decline` /
`cancel`. Verified against `@modelcontextprotocol/sdk@1.29.0`'s `types.ts`
(revision 2025-11-25) rather than recollection — form mode carries
`{ message, requestedSchema }` where `requestedSchema` is restricted to flat
primitives, and the answer carries `{ action, content? }`.

It is **optional for clients**, declared as `capabilities.elicitation` during
`initialize`. So it can be the primary guard but not the only one.

### What was decided

A layered gate, in `mcp/guard.ts`:

1. **Elicitation when the client can be asked.** The tool sends a read-back
   description of the change — "Delete the task "Fix header" in "Website"", "Delete
   3 tasks: "A", "B" and "C"" — and runs only on `accept` with `confirm: true`.
   Decline, dismiss, a `confirm: false`, a malformed answer, or a client that
   declared the capability and then errored all resolve to *declined*: the gate
   fails closed.
2. **A single-use confirmation token when it cannot.** The first call is refused
   non-fatally with `kind: "needs_confirmation"`, the same description, and a
   token bound by SHA-256 fingerprint to the exact arguments. A second call
   carrying it executes. Tokens are per-session, expire in ten minutes, and are
   spent whether or not they matched.
3. **`annotations.destructiveHint`** on all six destructive tools, for hosts that
   prompt on their own initiative.
4. **`MCP_REQUIRE_ELICITATION=1`** refuses gated tools outright for a client that
   cannot ask a person, rather than degrading to the token.

### What parity does and does not mean

Identical: capability set, input schemas (the same objects), every product spec
§7 rule, the error vocabulary, ordering, list trimming. No destructive operation
is reachable in one call from any interface.

Not identical: **whether a human is actually in the loop.** With elicitation,
yes — a person accepts or declines and a decline means nothing changed, exactly
as in the chat pane. With the token, the server enforces *sequencing*: two round
trips with a plain-language statement of the consequences in between. A host that
shows tool traffic to a person surfaces that; a headless caller can satisfy it
alone.

That gap does not close with more server-side code, because the server has no
channel to a human the client did not give it. The response is to state it where
an operator reads it (`mcp/README.md`) and to offer the strict mode for anyone
who wants the stronger promise. The alternative — refusing by default — was
considered and rejected: it makes the server read-and-create-only in most
scripted clients, which is a large cost for a guarantee the strict flag already
provides to whoever actually needs it.

### Two smaller decisions inside this one

- **The gate runs after the schema parses, not before.** A call that cannot pass
  its own schema goes straight to the action and comes back `invalid_input`,
  so nobody is asked to confirm a change that was never going to happen.
- **The confirmation describes the change, not the arguments.** EVE's approval
  card renders raw input next to the model's own prose, and `instructions.md`
  makes the model name the affected items first. An elicitation message is the
  only thing the human sees, so `mcp/preview.ts` reads the affected rows back —
  through the existing read actions only, never new SQL — and degrades to the
  ids if any read fails. A prompt whose entire content is a list of UUIDs is not
  a confirmation of anything.

---

## 2. Transport: stdio only

Elicitation needs a channel from server to client. stdio has one; a POST-only
Streamable HTTP endpoint does not, and the full HTTP transport that would
(`Mcp-Session-Id`, an SSE response stream, correlating a pending server request
against a later inbound POST) is a substantial amount of hand-authored machinery
whose payoff is a *weaker* gate on the surface most exposed.

HTTP would also be the only authenticated route in an app whose entire
`app/api/` tree has no auth at all (see `agent/channels/eve.ts` on why that is
survivable today: Vercel Deployment Protection, not application code). Adding one
authenticated endpoint invites the conclusion that the rest are protected too.

Consequence accepted: the server is local-only. A remote deployment is a separate
piece of work that should start by giving `app/api/` auth, not by bolting it onto
one route.

## 3. Auth: none, because there is no HTTP surface

A stdio server inherits the trust of whoever spawned it, which is the same trust
boundary `pnpm dev` has today.

## 4. List trimming: yes, identically

Parity means the external model reads what the internal one reads. The projection
functions and the `{ ok, count, items }` wrapper moved to `lib/compact.ts` so
there is one definition; `agent/lib/list-output.ts` wraps it in EVE's
`toModelOutput` contract and `mcp/server.ts` puts the same value in a content
block. `get_task` is the escape hatch for full text on both sides.

MCP has no "channel" half to send full rows to, so the trimmed value is the whole
result rather than a projection of a richer one. That is a difference in what
*else* exists, not in what the model sees.

---

## 5. Dependency policy: no MCP SDK

Recorded in plan §1.1 with the full argument. In short: v1.29.0 would bring
`express`, `hono`, `cors`, `ajv`, `jose`, `eventsource` and `zod-to-json-schema`
into a Next app to provide a five-method JSON-RPC dispatcher, and the one thing
it would generate for us — JSON Schema from zod — zod 4 does natively via
`z.toJSONSchema()`, on the *same schema objects* the other two interfaces use.
The SDK is still the reference: it is present transitively and its `types.ts` was
read as the authority on the protocol shapes.

---

## 6. Supporting decisions

**`update_task`'s gate is scoped to the session.** `agent/lib/bulk-edit-gate.ts`
counts distinct tasks within an EVE *turn*; MCP has no turn. Of the two honest
options — the session (stricter: a long connection accumulates, so the second
distinct task edited is gated even if the requests are hours apart) and a timing
heuristic (closer to EVE's behaviour, but an untestable guess that a slow client
trips) — the session was chosen because it errs closed. The counting itself moved
to `lib/edit-gate.ts` so the policy is not written twice.

**The model-facing helpers moved to `lib/`.** `runAction`, the compact
projections and the edit-gate counter were in `agent/lib/`. The MCP interface
needs all three verbatim, and importing them from `agent/lib/` would have made
the dependency graph claim the MCP server sits downstream of the EVE agent. They
moved on the precedent `lib/serialized.ts` set in Phase 4. `agent/lib/` keeps
what is genuinely EVE-shaped: `list-output.ts` and the `ApprovalContext` adapter
in `bulk-edit-gate.ts`.

**Not implemented, deliberately:** resources, prompts, completions, logging,
sampling, tasks, pagination, JSON-RPC batching. The first six would be capability
the internal agent does not have — the half of "no more and no less" that is easy
to get wrong. Pagination is unnecessary because results are trimmed, not paged.
Batching left the protocol in revision 2025-06-18.

---

## 7. Verification

| Suite | What only it can prove | Count |
|---|---|---|
| `tests/unit/mcp/inventory.test.ts` | parity with `agent/tools/`, every expectation derived by import | 78 |
| `tests/unit/mcp/server.test.ts` | handshake, negotiation, what `tools/list` advertises, malformed traffic | 16 |
| `tests/unit/mcp/call.test.ts` | results, rule relaying, and every gate path, against a rolled-back transaction | 25 |
| `tests/mcp/index.test.ts` | the spawned process: framing across chunk boundaries, a clean stdout, real commits | 7 |

`pnpm test` — 414 unit, 77 api, 7 mcp, all passing. `pnpm typecheck` and
`pnpm lint` clean.

The parity test is the one that matters. It imports `agent/tools/*`, and asserts
the MCP inventory against it: the same nineteen names, the **same schema objects
by identity**, the same approval column (calling each EVE policy to find out what
it is), and destructive annotations on everything EVE gates. Adding a capability
to one interface and not the other fails a test.

### Two defects found while building

1. **A deadlock in the first `mcp/stdio.ts`.** Inbound messages were serialised
   through a promise chain, on the reasoning that `receive` returns once a
   request is dispatched. It does not — it resolves when the request is
   *answered*, and a `tools/call` parked on an approval is not answered until the
   user's reply arrives as a later inbound message, which was queued behind it.
   The symptom was a suite that hung with no output. Messages are now handled
   concurrently, which the protocol permits, and in-flight work is tracked only
   so shutdown can drain it. Caught by `tests/mcp/`, invisible to the in-process
   tests.
2. **A latent race in `withEmptyDb`** (tests/support/db.ts), which deletes every
   project inside its transaction and then asserts the table holds one row — a
   claim any concurrently committed insert falsifies under READ COMMITTED.
   tests/api/ has the same exposure and survives only because it boots `next dev`
   for a minute before writing. `pnpm test` now runs the suites in sequence. **The
   underlying fragility is not fixed**, and Phase 7's exit gate (three
   consecutive green `test:all` runs) is the reason to fix it properly.

### Not covered

- **No eval.** The gate's *prose* — whether an external model actually relays a
  `needs_confirmation` description to its user instead of confirming on their
  behalf — is exactly the kind of behaviour `evals/` exists for, and is untested.
  It needs a driven external agent, not just a server. Related: the bulk-edit gate
  still has no eval either (see `docs/RESUME.md` §3.3).
- **No real host.** Verified against a hand-written client, not against Claude
  Code or Claude Desktop. The framing, handshake and elicitation flow are
  spec-conformant and exercised end to end over a real pipe, but "works in a
  named host" is an untested claim.
- **`preview.ts`'s 1+N read** for `delete_status` / `delete_priority`, whose
  schemas carry no `projectId` — it walks the project list to name the entity.
  Correct and cheap at this scale, on an interactive path, and the alternative
  was a lookup-by-id the action layer chose not to expose.

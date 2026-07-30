/**
 * The counting half of product spec §6's bulk rule for *edits*, shared by both
 * agent-facing interfaces.
 *
 * §6 defines a bulk change as "a single request that would modify or delete
 * more than one task" and requires confirmation before one runs. A tool that
 * edits one task by id cannot see that rule on its own — someone has to count
 * distinct tasks within a bounded scope. This module is that counter and
 * nothing else: it holds no product rule, no approval vocabulary, and no idea
 * what a "turn" is. Each interface supplies the scope it can actually observe
 * and translates the answer into its own gate:
 *
 * - `agent/lib/bulk-edit-gate.ts` scopes it to an EVE **turn** and answers in
 *   AI SDK approval statuses. That file carries the full safety argument.
 * - `mcp/guard.ts` scopes it to an MCP **session**, because MCP has no turn at
 *   all, and answers with its own elicit-or-token gate.
 *
 * Both share the two properties the argument rests on, which is the reason this
 * is one module rather than two:
 *
 * - **Identity, not arithmetic.** The set holds task ids, so two calls that
 *   both edit the same task are one task modified and both run free — a title
 *   edit followed by a status change on one task is not "bulk".
 * - **Replay-safe.** Asking again about an id already recorded returns the same
 *   answer, so a call that is judged twice is not counted twice.
 *
 * The state is in memory and process-scoped. It fails open across a restart —
 * never closed for a genuinely single-task edit — which is the right direction
 * for a mechanism whose failure mode is either an unnecessary prompt or a
 * missing one on a *second* task the caller was told to batch instead.
 */

/**
 * How many scopes keep a record. A scope's set is dead the moment its turn or
 * session ends and nothing tells us when that is, so the map is bounded and
 * evicts in insertion order. Far more than the handful any one process has in
 * flight, small enough that the memory is noise.
 */
const TRACKED_SCOPES = 64

/** scope key → the ids that scope has already edited without a gate. */
const editedByScope = new Map<string, Set<string>>()

/** Records `id` against `key`, evicting the oldest scope when the map is full. */
function remember(key: string, id: string): void {
  editedByScope.set(key, new Set([id]))

  while (editedByScope.size > TRACKED_SCOPES) {
    const oldest = editedByScope.keys().next()

    if (oldest.done === true) break

    editedByScope.delete(oldest.value)
  }
}

/**
 * Whether editing `id` is still the *first* task this scope has edited, and so
 * runs without a prompt. `false` means a second, different task — a bulk change
 * by §6's definition — and the caller must gate it.
 *
 * A gated id is deliberately **not** recorded: an approved edit stays approved
 * for the call the user answered, and a *declined* one must not become free
 * just because the caller tried it again.
 */
export function isFirstEditInScope(key: string, id: string): boolean {
  const edited = editedByScope.get(key)

  if (edited === undefined) {
    remember(key, id)
    return true
  }

  return edited.has(id)
}

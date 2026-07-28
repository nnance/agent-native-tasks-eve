/**
 * Dense renumbering for the ordered per-project lists (statuses, priorities).
 *
 * Product spec §4.2/§4.3 give both a project-scoped `order`, and US-D1.2 /
 * US-E1.2 require the defined order to be respected everywhere. Reordering is
 * expressed as "move this item to 0-based position N" rather than "submit the
 * whole reordered array", because implementation plan §1 fixes the tool grain
 * at a consolidated `update_*` per entity — and because move-to-position is
 * the shape a model can actually emit from "move Done to the front".
 *
 * Kept pure and DB-free, alongside lib/domain/defaults.ts, so the index
 * arithmetic is unit-testable on its own and the actions only have to write
 * back the rows whose order actually changed.
 */

export type Orderable = { id: string; order: number }
export type OrderAssignment = { id: string; order: number }

/**
 * Sorts by (order asc, id asc) and renumbers densely to 0..n-1.
 *
 * The secondary `id` key keeps the result deterministic even if the stored
 * orders ever collide — a tie must not resolve differently on two reads.
 */
export function renumber<T extends Orderable>(
  siblings: readonly T[]
): OrderAssignment[] {
  return [...siblings]
    .sort(
      (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((sibling, index) => ({ id: sibling.id, order: index }))
}

/**
 * Moves `movedId` to 0-based position `targetOrder` among its siblings and
 * renumbers the whole list densely. `targetOrder` is clamped to [0, n-1], so
 * "move it to the end" can be expressed with any sufficiently large number.
 *
 * Throws a plain Error when `movedId` is absent: every caller has already
 * loaded the row and proven it exists, so that is a programmer error rather
 * than a RuleViolation the user could act on.
 */
export function reindexAfterMove<T extends Orderable>(
  siblings: readonly T[],
  movedId: string,
  targetOrder: number
): OrderAssignment[] {
  const ordered = renumber(siblings)
  const from = ordered.findIndex((sibling) => sibling.id === movedId)

  if (from === -1) {
    throw new Error(`reindexAfterMove: ${movedId} is not among its siblings.`)
  }

  const to = Math.min(Math.max(targetOrder, 0), ordered.length - 1)

  const [moved] = ordered.splice(from, 1)
  if (moved) ordered.splice(to, 0, moved)

  return ordered.map((sibling, index) => ({ id: sibling.id, order: index }))
}

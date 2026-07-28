/**
 * The single source of truth for what a new project looks like on day one.
 *
 * Product spec §4.1/§4.3 requires the seeded "Personal" project (US-A1) and
 * every project created later (US-C1.2) to get byte-identical defaults, so
 * this list must exist in exactly one place. Consumed by lib/db/seed.ts today
 * and by the createProject action in Phase 1.
 *
 * Deliberately dependency-free so it stays trivially unit-testable.
 */

export const SEED_PROJECT_NAME = "Personal"

export type DefaultStatus = { name: string; isCompleted: boolean }
export type DefaultPriority = { name: string; isDefault: boolean }

/** Order is the array index (0-based). */
export const DEFAULT_STATUSES: readonly DefaultStatus[] = [
  { name: "To Do", isCompleted: false },
  { name: "In Progress", isCompleted: false },
  { name: "Done", isCompleted: true },
]

/** Order is the array index (0-based). Exactly one entry is the default. */
export const DEFAULT_PRIORITIES: readonly DefaultPriority[] = [
  { name: "Low", isDefault: false },
  { name: "Medium", isDefault: true },
  { name: "High", isDefault: false },
]

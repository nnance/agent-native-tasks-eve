/**
 * Query keys and the task-filter → URL translation.
 *
 * The key shapes are implementation plan §2.6's, literally: `["tasks", filters]`,
 * `["projects"]`, `["statuses", projectId]`, `["priorities", projectId]`. They
 * are fixed so a Phase 6 `onEvent` handler can invalidate by prefix without
 * knowing which filters any pane happens to be showing.
 */

/**
 * Filters in **schema** spelling (`projectId`, `search`, …), not URL spelling.
 * The UI thinks in the shared contract's names; `taskSearchParams` does the
 * one translation, in one place.
 */
export type TaskFilters = {
  projectId?: string
  statusId?: string
  priorityId?: string
  search?: string
  includeCompleted?: boolean
}

/**
 * Drops empty and false-y entries so `{}`, `{ search: "" }` and
 * `{ includeCompleted: false }` all collapse onto one cache slot. Without this
 * the same list would be fetched and cached several times over, and the key
 * would change on every keystroke that ends back at empty.
 */
export function normalizeTaskFilters(filters: TaskFilters): TaskFilters {
  const normalized: TaskFilters = {}

  if (filters.projectId) normalized.projectId = filters.projectId
  if (filters.statusId) normalized.statusId = filters.statusId
  if (filters.priorityId) normalized.priorityId = filters.priorityId

  const search = filters.search?.trim()
  if (search) normalized.search = search

  if (filters.includeCompleted === true) normalized.includeCompleted = true

  return normalized
}

/**
 * Builds the query string `GET /api/tasks` actually reads.
 *
 * The URL deliberately spells the filters `project`, `status`, `priority`, `q`
 * — `app/api/tasks/route.ts` owns that translation for input, and this is its
 * outbound half. Getting it wrong would silently return an unfiltered list
 * rather than erroring, so it is worth stating once and importing everywhere.
 * An empty value is never emitted: the route treats `?q=` as "not provided",
 * but omitting it altogether is unambiguous.
 */
export function taskSearchParams(filters: TaskFilters): string {
  const normalized = normalizeTaskFilters(filters)
  const params = new URLSearchParams()

  if (normalized.projectId) params.set("project", normalized.projectId)
  if (normalized.statusId) params.set("status", normalized.statusId)
  if (normalized.priorityId) params.set("priority", normalized.priorityId)
  if (normalized.search) params.set("q", normalized.search)
  if (normalized.includeCompleted) params.set("includeCompleted", "true")

  const query = params.toString()

  return query === "" ? "" : `?${query}`
}

/**
 * `.all` is the coarse prefix every mutation invalidates; `.list()` is the
 * exact key a query subscribes with. Both exist so no call site ever writes a
 * key array inline.
 */
export const queryKeys = {
  tasks: {
    all: ["tasks"] as const,
    list: (filters: TaskFilters) =>
      ["tasks", normalizeTaskFilters(filters)] as const,
  },
  projects: {
    all: ["projects"] as const,
    list: () => ["projects"] as const,
  },
  statuses: {
    all: ["statuses"] as const,
    list: (projectId: string) => ["statuses", projectId] as const,
  },
  priorities: {
    all: ["priorities"] as const,
    list: (projectId: string) => ["priorities", projectId] as const,
  },
}

"use client"

import { useState } from "react"

import { TaskList } from "@/components/tasks/task-list"
import {
  EMPTY_TASK_FILTERS,
  hasActiveFilters,
  TaskFilterBar,
  type TaskFilterState,
} from "@/components/tasks/task-filter-bar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useTasks } from "@/lib/queries"

/**
 * The Tasks tab: the filter bar, the create button and the list (§8.1).
 *
 * Filter state lives here rather than in the URL. No acceptance criterion
 * asks for a shareable or bookmarkable filtered view, and keeping it local
 * avoids `useSearchParams` on a page that renders no server data.
 *
 * Only `search` is debounced, and only on the way into the query — the input
 * itself stays fully controlled, so typing never feels laggy while the list
 * settles once.
 */
export function TasksTab() {
  const [filters, setFilters] = useState<TaskFilterState>(EMPTY_TASK_FILTERS)
  const debouncedSearch = useDebouncedValue(filters.search, 250)

  const query = useTasks({
    projectId: filters.projectId ?? undefined,
    statusId: filters.statusId ?? undefined,
    priorityId: filters.priorityId ?? undefined,
    search: debouncedSearch,
    includeCompleted: filters.includeCompleted,
  })

  const filtered = hasActiveFilters(filters)

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <TaskFilterBar value={filters} onChange={setFilters} />
      <TaskList
        query={query}
        hasActiveFilters={filtered}
        onClearFilters={() => setFilters(EMPTY_TASK_FILTERS)}
      />
    </div>
  )
}

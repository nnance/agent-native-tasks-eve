"use client"

import { useState } from "react"

import { TaskList } from "@/components/tasks/task-list"
import {
  EMPTY_TASK_FILTERS,
  hasActiveFilters,
  TaskFilterBar,
  type TaskFilterState,
} from "@/components/tasks/task-filter-bar"
import {
  TaskFormDialog,
  type TaskFormMode,
} from "@/components/tasks/task-form-dialog"
import { Button } from "@/components/ui/button"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useTasks } from "@/lib/queries"

/**
 * The Tasks tab: the filter bar, the create button, the list and the form
 * dialog (product spec §8.1).
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
  const [formMode, setFormMode] = useState<TaskFormMode | null>(null)
  const debouncedSearch = useDebouncedValue(filters.search, 250)

  const query = useTasks({
    projectId: filters.projectId ?? undefined,
    statusId: filters.statusId ?? undefined,
    priorityId: filters.priorityId ?? undefined,
    search: debouncedSearch,
    includeCompleted: filters.includeCompleted,
  })

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <TaskFilterBar value={filters} onChange={setFilters} />

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="task-create-open"
          // The active project filter pre-selects the project, which is almost
          // always the one the user means.
          onClick={() =>
            setFormMode({ kind: "create", projectId: filters.projectId })
          }
        >
          New task
        </Button>
      </div>

      <TaskList
        query={query}
        hasActiveFilters={hasActiveFilters(filters)}
        onClearFilters={() => setFilters(EMPTY_TASK_FILTERS)}
        onEdit={(task) => setFormMode({ kind: "edit", task })}
      />

      <TaskFormDialog mode={formMode} onClose={() => setFormMode(null)} />
    </div>
  )
}

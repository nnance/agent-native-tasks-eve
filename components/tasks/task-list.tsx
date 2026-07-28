"use client"

import type { UseQueryResult } from "@tanstack/react-query"

import { QueryState } from "@/components/shared/query-state"
import { TaskRow } from "@/components/tasks/task-row"
import { Button } from "@/components/ui/button"
import type { ApiError, TaskDto } from "@/lib/queries"

/**
 * The task list of product spec §8.1.
 *
 * A `<ul>` of rows rather than a table: the left pane is half the viewport,
 * and a table row carrying a title, three chips, a select and two buttons
 * would need its own horizontal scroll container. A list wraps.
 *
 * The list never sorts or filters. `listTasks` applies the canonical §8.1
 * ordering (completed statuses last, then priority descending, then oldest
 * first) server-side precisely so the UI and the agent cannot disagree about
 * order; re-sorting here would reintroduce exactly that divergence.
 */
export function TaskList({
  query,
  hasActiveFilters,
  onClearFilters,
}: {
  query: UseQueryResult<TaskDto[], ApiError>
  hasActiveFilters: boolean
  onClearFilters: () => void
}) {
  const tasks = query.data ?? []

  return (
    <QueryState
      id="task-list"
      status={query.status}
      error={query.error}
      isEmpty={tasks.length === 0}
      emptyTitle={hasActiveFilters ? "No matching tasks" : "No tasks yet"}
      emptyDescription={
        hasActiveFilters
          ? "Nothing matches the current filters and search."
          : "Create a task to get started."
      }
      emptyAction={
        // US-B3.5: an empty result must offer a way back out of it.
        hasActiveFilters ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="clear-filters"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
        ) : undefined
      }
    >
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </QueryState>
  )
}

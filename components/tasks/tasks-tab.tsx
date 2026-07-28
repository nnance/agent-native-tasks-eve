"use client"

import { TaskList } from "@/components/tasks/task-list"
import { useTasks } from "@/lib/queries"

/**
 * The Tasks tab: filters plus the list (product spec §8.1).
 */
export function TasksTab() {
  const query = useTasks({})

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <TaskList query={query} hasActiveFilters={false} />
    </div>
  )
}

"use client"

import { Badge } from "@/components/ui/badge"
import type { TaskDto } from "@/lib/queries"

/**
 * Project / status / priority as tags, per product spec §8.1.
 *
 * Purely presentational, and fed straight from `TaskDto` — `listTasks`
 * denormalises the related names and flags onto every row, so a chip never
 * needs its own lookup and a rename shows up the moment the task query
 * refetches (US-C2.1, US-D1.4, US-E1.4).
 */

export function ProjectChip({ task }: { task: TaskDto }) {
  return (
    <Badge variant="outline" data-testid={`task-project-chip-${task.id}`}>
      {task.project.name}
    </Badge>
  )
}

export function StatusChip({ task }: { task: TaskDto }) {
  return (
    <Badge
      variant={task.status.isCompleted ? "secondary" : "outline"}
      data-testid={`task-status-chip-${task.id}`}
    >
      {task.status.name}
    </Badge>
  )
}

export function PriorityChip({ task }: { task: TaskDto }) {
  return (
    <Badge variant="secondary" data-testid={`task-priority-chip-${task.id}`}>
      {task.priority.name}
    </Badge>
  )
}

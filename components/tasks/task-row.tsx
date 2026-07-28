"use client"

import {
  PriorityChip,
  ProjectChip,
  StatusChip,
} from "@/components/tasks/entity-chips"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"
import type { TaskDto } from "@/lib/queries"

/**
 * One task in the list.
 *
 * `data-completed` mirrors `status.isCompleted` so the "visually distinct"
 * requirement of US-B2.4 is assertable as an attribute rather than as a
 * colour, and the muted + struck-through treatment hangs off the same fact.
 */
export function TaskRow({
  task,
  onEdit,
}: {
  task: TaskDto
  onEdit: (task: TaskDto) => void
}) {
  const completed = task.status.isCompleted

  return (
    <Item
      render={<li />}
      variant="outline"
      data-testid={`task-row-${task.id}`}
      data-completed={completed}
      className={cn("items-start", completed && "bg-muted/40")}
    >
      <ItemContent>
        <ItemTitle
          data-testid={`task-title-${task.id}`}
          className={cn(
            "text-sm font-medium",
            completed && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </ItemTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <ProjectChip task={task} />
          <StatusChip task={task} />
          <PriorityChip task={task} />
        </div>
      </ItemContent>
      <ItemActions className="flex-wrap justify-end gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid={`task-edit-${task.id}`}
          onClick={() => onEdit(task)}
        >
          Edit
        </Button>
      </ItemActions>
    </Item>
  )
}

"use client"

import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import {
  PriorityChip,
  ProjectChip,
  StatusChip,
} from "@/components/tasks/entity-chips"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useDeleteTask, useStatuses, useUpdateTask } from "@/lib/queries"
import type { TaskDto } from "@/lib/queries"
import { cn } from "@/lib/utils"

/**
 * One task in the list.
 *
 * `data-completed` mirrors `status.isCompleted` so the "visually distinct"
 * requirement of US-B2.4 is assertable as an attribute rather than as a
 * colour, and the muted + struck-through treatment hangs off the same fact.
 *
 * The row calls `useStatuses(task.project.id)` itself rather than being handed
 * a map from the parent. TanStack dedupes by key, so K distinct projects cost
 * K requests regardless of row count — and it keeps the quick status move
 * available in the unfiltered "all projects" view, which US-B5.1 does not
 * make conditional on a project filter.
 */
export function TaskRow({
  task,
  onEdit,
}: {
  task: TaskDto
  onEdit: (task: TaskDto) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const statuses = useStatuses(task.project.id)
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

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
        {/* The quick status move of US-B5: one action from the list, options
            in the project's defined order, no form to open. */}
        <NativeSelect
          size="sm"
          aria-label={`Status for ${task.title}`}
          data-testid={`task-status-select-${task.id}`}
          value={task.status.id}
          disabled={updateTask.isPending}
          onChange={(event) =>
            updateTask.mutate({
              taskId: task.id,
              statusId: event.target.value,
            })
          }
        >
          {(statuses.data ?? [task.status]).map((status) => (
            <NativeSelectOption key={status.id} value={status.id}>
              {status.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid={`task-edit-${task.id}`}
          onClick={() => onEdit(task)}
        >
          Edit
        </Button>

        <Button
          type="button"
          size="xs"
          variant="destructive"
          data-testid={`task-delete-${task.id}`}
          onClick={() => {
            deleteTask.reset()
            setConfirming(true)
          }}
        >
          Delete
        </Button>
      </ItemActions>

      <ConfirmDeleteDialog
        id={`delete-task-${task.id}`}
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this task?"
        description={`'${task.title}' will be removed permanently.`}
        error={deleteTask.error?.message ?? null}
        pending={deleteTask.isPending}
        onConfirm={() =>
          deleteTask.mutate(
            { taskId: task.id },
            { onSuccess: () => setConfirming(false) }
          )
        }
      />
    </Item>
  )
}

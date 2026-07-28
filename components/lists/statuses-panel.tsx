"use client"

import { useId, useState } from "react"

import { ReorderButtons } from "@/components/lists/reorder-buttons"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { InlineNameForm } from "@/components/shared/inline-name-form"
import { QueryState } from "@/components/shared/query-state"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import {
  useCreateStatus,
  useDeleteStatus,
  useStatuses,
  useUpdateStatus,
  type StatusDto,
} from "@/lib/queries"

/**
 * A project's statuses: create, rename, reorder, toggle completed, delete
 * (product spec §8.2, US-D1–D2).
 *
 * Always scoped to one project — statuses are per-project entities, so there
 * is no meaningful project-less view of them (US-D1.1).
 */
export function StatusesPanel({ projectId }: { projectId: string | null }) {
  const createCompletedId = useId()
  const [createCompleted, setCreateCompleted] = useState(false)

  const statuses = useStatuses(projectId)
  const createStatus = useCreateStatus()

  const rows = statuses.data ?? []

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-sm font-medium">Statuses</h2>

      <div className="flex flex-col gap-2">
        <InlineNameForm
          idPrefix="status-create"
          submitLabel="Add status"
          placeholder="New status name"
          pending={createStatus.isPending}
          error={createStatus.error?.message ?? null}
          onSubmit={(name) => {
            if (!projectId) return undefined
            return createStatus.mutateAsync(
              { projectId, name, isCompleted: createCompleted },
              { onSuccess: () => setCreateCompleted(false) }
            )
          }}
          resetOnSuccess
        />
        <Label
          htmlFor={createCompletedId}
          className="w-fit gap-2 text-xs font-normal text-muted-foreground"
        >
          <Checkbox
            id={createCompletedId}
            data-testid="status-create-completed"
            checked={createCompleted}
            onCheckedChange={setCreateCompleted}
          />
          Counts as completed
        </Label>
      </div>

      <QueryState
        id="statuses-panel"
        status={projectId ? statuses.status : "success"}
        error={statuses.error}
        isEmpty={rows.length === 0}
        emptyTitle="No statuses"
        emptyDescription={
          projectId
            ? "Add one above."
            : "Select a project to manage its statuses."
        }
      >
        <ul className="flex flex-col gap-2">
          {rows.map((status, index) => (
            <StatusRow
              key={status.id}
              status={status}
              index={index}
              count={rows.length}
            />
          ))}
        </ul>
      </QueryState>
    </section>
  )
}

function StatusRow({
  status,
  index,
  count,
}: {
  status: StatusDto
  index: number
  count: number
}) {
  const completedId = useId()
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()

  return (
    <Item
      render={<li />}
      variant="outline"
      size="sm"
      data-testid={`status-row-${status.id}`}
      data-completed={status.isCompleted}
      className="items-center"
    >
      <ItemContent>
        {renaming ? (
          <InlineNameForm
            idPrefix={`status-rename-${status.id}`}
            initialValue={status.name}
            submitLabel="Save"
            pending={updateStatus.isPending}
            error={updateStatus.error?.message ?? null}
            onSubmit={(name) =>
              updateStatus.mutate(
                { projectId: status.projectId, statusId: status.id, name },
                { onSuccess: () => setRenaming(false) }
              )
            }
            onCancel={() => {
              updateStatus.reset()
              setRenaming(false)
            }}
          />
        ) : (
          <ItemTitle data-testid={`status-name-${status.id}`}>
            {status.name}
          </ItemTitle>
        )}
      </ItemContent>

      {renaming ? null : (
        <ItemActions className="flex-wrap gap-1.5">
          <Label
            htmlFor={completedId}
            className="gap-1.5 text-xs font-normal text-muted-foreground"
          >
            <Checkbox
              id={completedId}
              data-testid={`status-completed-${status.id}`}
              checked={status.isCompleted}
              disabled={updateStatus.isPending}
              onCheckedChange={(checked) =>
                updateStatus.mutate({
                  projectId: status.projectId,
                  statusId: status.id,
                  isCompleted: checked,
                })
              }
            />
            Completed
          </Label>

          <ReorderButtons
            idPrefix="status"
            id={status.id}
            index={index}
            count={count}
            pending={updateStatus.isPending}
            onMove={(order) =>
              updateStatus.mutate({
                projectId: status.projectId,
                statusId: status.id,
                order,
              })
            }
          />

          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid={`status-rename-${status.id}`}
            onClick={() => {
              updateStatus.reset()
              setRenaming(true)
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            data-testid={`status-delete-${status.id}`}
            onClick={() => {
              deleteStatus.reset()
              setConfirming(true)
            }}
          >
            Delete
          </Button>
        </ItemActions>
      )}

      <ConfirmDeleteDialog
        id={`delete-status-${status.id}`}
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this status?"
        description={`'${status.name}' will be removed from this project.`}
        error={deleteStatus.error?.message ?? null}
        pending={deleteStatus.isPending}
        onConfirm={() =>
          deleteStatus.mutate(
            { projectId: status.projectId, statusId: status.id },
            { onSuccess: () => setConfirming(false) }
          )
        }
      />
    </Item>
  )
}

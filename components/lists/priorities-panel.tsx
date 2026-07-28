"use client"

import { useState } from "react"

import { ReorderButtons } from "@/components/lists/reorder-buttons"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { InlineNameForm } from "@/components/shared/inline-name-form"
import { QueryState } from "@/components/shared/query-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import {
  useCreatePriority,
  useDeletePriority,
  usePriorities,
  useUpdatePriority,
  type PriorityDto,
} from "@/lib/queries"

/**
 * A project's priorities: create, rename, reorder, set default, delete
 * (product spec §8.2, US-E1–E2).
 *
 * Order runs Low → High: ascending `order` is ascending urgency, which is what
 * §4.3 describes and what the task list's `desc(priorities.order)` relies on.
 * So "Move up" here means "less urgent", and the list reads bottom-up as most
 * important — the same direction the seeded Low/Medium/High already sets.
 */
export function PrioritiesPanel({ projectId }: { projectId: string | null }) {
  const priorities = usePriorities(projectId)
  const createPriority = useCreatePriority()

  const rows = priorities.data ?? []

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-sm font-medium">Priorities</h2>

      <InlineNameForm
        idPrefix="priority-create"
        submitLabel="Add priority"
        placeholder="New priority name"
        pending={createPriority.isPending}
        error={createPriority.error?.message ?? null}
        onSubmit={(name) => {
          if (!projectId) return
          createPriority.mutate({ projectId, name })
        }}
      />

      <QueryState
        id="priorities-panel"
        status={projectId ? priorities.status : "success"}
        error={priorities.error}
        isEmpty={rows.length === 0}
        emptyTitle="No priorities"
        emptyDescription={
          projectId
            ? "Add one above."
            : "Select a project to manage its priorities."
        }
      >
        <ul className="flex flex-col gap-2">
          {rows.map((priority, index) => (
            <PriorityRow
              key={priority.id}
              priority={priority}
              index={index}
              count={rows.length}
            />
          ))}
        </ul>
      </QueryState>
    </section>
  )
}

function PriorityRow({
  priority,
  index,
  count,
}: {
  priority: PriorityDto
  index: number
  count: number
}) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const updatePriority = useUpdatePriority()
  const deletePriority = useDeletePriority()

  return (
    <Item
      render={<li />}
      variant="outline"
      size="sm"
      data-testid={`priority-row-${priority.id}`}
      data-default={priority.isDefault}
      className="items-center"
    >
      <ItemContent>
        {renaming ? (
          <InlineNameForm
            idPrefix={`priority-rename-${priority.id}`}
            initialValue={priority.name}
            submitLabel="Save"
            pending={updatePriority.isPending}
            error={updatePriority.error?.message ?? null}
            onSubmit={(name) =>
              updatePriority.mutate(
                {
                  projectId: priority.projectId,
                  priorityId: priority.id,
                  name,
                },
                { onSuccess: () => setRenaming(false) }
              )
            }
            onCancel={() => {
              updatePriority.reset()
              setRenaming(false)
            }}
          />
        ) : (
          <ItemTitle data-testid={`priority-name-${priority.id}`}>
            {priority.name}
          </ItemTitle>
        )}
      </ItemContent>

      {renaming ? null : (
        <ItemActions className="flex-wrap gap-1.5">
          {/* A button that becomes a badge, never a two-way toggle:
              `updatePrioritySchema.isDefault` is z.literal(true) precisely
              because a default can be reassigned but never cleared. A checkbox
              would advertise an affordance the API cannot express. */}
          {priority.isDefault ? (
            <Badge
              variant="secondary"
              data-testid={`priority-default-badge-${priority.id}`}
            >
              Default
            </Badge>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid={`priority-set-default-${priority.id}`}
              disabled={updatePriority.isPending}
              onClick={() =>
                updatePriority.mutate({
                  projectId: priority.projectId,
                  priorityId: priority.id,
                  isDefault: true,
                })
              }
            >
              Set default
            </Button>
          )}

          <ReorderButtons
            idPrefix="priority"
            id={priority.id}
            index={index}
            count={count}
            pending={updatePriority.isPending}
            onMove={(order) =>
              updatePriority.mutate({
                projectId: priority.projectId,
                priorityId: priority.id,
                order,
              })
            }
          />

          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid={`priority-rename-${priority.id}`}
            onClick={() => {
              updatePriority.reset()
              setRenaming(true)
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            data-testid={`priority-delete-${priority.id}`}
            onClick={() => {
              deletePriority.reset()
              setConfirming(true)
            }}
          >
            Delete
          </Button>
        </ItemActions>
      )}

      <ConfirmDeleteDialog
        id={`delete-priority-${priority.id}`}
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this priority?"
        description={`'${priority.name}' will be removed from this project.`}
        error={deletePriority.error?.message ?? null}
        pending={deletePriority.isPending}
        onConfirm={() =>
          deletePriority.mutate(
            { projectId: priority.projectId, priorityId: priority.id },
            { onSuccess: () => setConfirming(false) }
          )
        }
      />
    </Item>
  )
}

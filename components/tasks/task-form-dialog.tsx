"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import {
  useCreateTask,
  usePriorities,
  useProjects,
  useStatuses,
  useUpdateTask,
  type TaskDto,
} from "@/lib/queries"
import { createTaskSchema, updateTaskSchema } from "@/lib/schemas"

/**
 * Create is "which project?"; edit is "this task, whose project is fixed".
 * Modelling them as one union rather than two booleans means the edit branch
 * cannot be reached without a task.
 */
export type TaskFormMode =
  { kind: "create"; projectId: string | null } | { kind: "edit"; task: TaskDto }

/**
 * The create/edit task form of product spec §8.1.
 *
 * Hand-rolled controlled inputs validated on submit with `.safeParse` against
 * the **real** `lib/schemas` objects, not shadcn's `Form` — that wraps
 * react-hook-form, which is not on the §1.1 allowed dependency list and is not
 * framework-scale infrastructure a form set this small cannot do without.
 * Reusing the actual schema objects also means client and server can never
 * disagree about shape.
 *
 * The dialog is a thin shell around `TaskForm`, which is mounted fresh under a
 * mode-derived `key`. Seeding the fields is therefore initial `useState`
 * rather than an effect that writes state back after render — the same result
 * with no cascading render and no stale-form-on-reopen edge.
 */
export function TaskFormDialog({
  mode,
  onClose,
}: {
  mode: TaskFormMode | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent data-testid="task-form-dialog" className="sm:max-w-lg">
        {mode ? (
          <TaskForm
            key={
              mode.kind === "edit"
                ? `edit-${mode.task.id}`
                : `create-${mode.projectId ?? "any"}`
            }
            mode={mode}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TaskForm({
  mode,
  onClose,
}: {
  mode: TaskFormMode
  onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const projectSelectId = useId()
  const statusFieldId = useId()
  const priorityFieldId = useId()

  const editing = mode.kind === "edit" ? mode.task : null

  const [title, setTitle] = useState(editing?.title ?? "")
  const [description, setDescription] = useState(editing?.description ?? "")
  /** `null` means "the user has not picked one yet"; see `projectValue`. */
  const [projectChoice, setProjectChoice] = useState<string | null>(
    mode.kind === "edit" ? mode.task.project.id : mode.projectId
  )
  const [statusValue, setStatusValue] = useState(editing?.status.id ?? "")
  const [priorityValue, setPriorityValue] = useState(editing?.priority.id ?? "")
  const [clientError, setClientError] = useState<string | null>(null)

  const projects = useProjects()
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()

  const projectOptions = projects.data ?? []
  // Derived during render, not stored: falling back to the first project keeps
  // the form submittable the moment the project list arrives, with no effect
  // writing state back into the tree.
  const projectValue = projectChoice ?? projectOptions[0]?.id ?? ""

  const scopeProjectId = editing ? editing.project.id : projectValue || null
  const statuses = useStatuses(scopeProjectId)
  const priorities = usePriorities(scopeProjectId)

  const pending = createTask.isPending || updateTask.isPending
  const serverError = createTask.error ?? updateTask.error
  const errorMessage = clientError ?? serverError?.message ?? null

  const submit = () => {
    setClientError(null)

    if (editing) {
      // The full field set on every submit. `updateTaskSchema`'s "at least one
      // field" refine is trivially satisfied, the client stays simple, and
      // there is no meaningful payload cost at this scale.
      const parsed = updateTaskSchema.safeParse({
        taskId: editing.id,
        title,
        // Blank clears it: `descriptionSchema.nullable().optional()` draws the
        // three-way distinction precisely so a description can be removed.
        description: description.trim() === "" ? null : description,
        statusId: statusValue,
        priorityId: priorityValue,
      })

      if (!parsed.success) {
        setClientError(parsed.error.issues[0]?.message ?? "Invalid task.")
        return
      }

      updateTask.mutate(parsed.data, { onSuccess: onClose })
      return
    }

    // Omitted keys are the point: leaving "Project default" selected drops
    // statusId/priorityId entirely so the server assigns the project's first
    // status and default priority (US-B1.3, US-B1.4). Sending an id the client
    // guessed would make that server behaviour untestable through the UI.
    const input: Record<string, unknown> = { projectId: projectValue, title }
    if (description.trim() !== "") input.description = description
    if (statusValue !== "") input.statusId = statusValue
    if (priorityValue !== "") input.priorityId = priorityValue

    const parsed = createTaskSchema.safeParse(input)

    if (!parsed.success) {
      setClientError(parsed.error.issues[0]?.message ?? "Invalid task.")
      return
    }

    createTask.mutate(parsed.data, { onSuccess: onClose })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "A task stays in the project it was created in."
            : "Only a title and a project are required."}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field>
          <FieldLabel htmlFor={titleId}>Title</FieldLabel>
          <Input
            id={titleId}
            data-testid="task-form-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
          <Textarea
            id={descriptionId}
            data-testid="task-form-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Optional detail"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={projectSelectId}>Project</FieldLabel>
          {editing ? (
            // Plain text, and no form control anywhere in the DOM. A disabled
            // <select> would imply the field could be enabled under some
            // condition; updateTaskSchema has no projectId, so immutability is
            // structural (§7 rule 1) and US-B4.4 is assertable as an absence.
            <p
              data-testid="task-form-project-readonly"
              className="text-sm text-muted-foreground"
            >
              {editing.project.name}
            </p>
          ) : (
            <NativeSelect
              id={projectSelectId}
              data-testid="task-form-project"
              className="w-full"
              value={projectValue}
              onChange={(event) => {
                setProjectChoice(event.target.value)
                // The old ids belong to the project just left.
                setStatusValue("")
                setPriorityValue("")
              }}
            >
              {projectOptions.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={statusFieldId}>Status</FieldLabel>
            <NativeSelect
              id={statusFieldId}
              data-testid="task-form-status"
              className="w-full"
              value={statusValue}
              onChange={(event) => setStatusValue(event.target.value)}
            >
              {editing ? null : (
                <NativeSelectOption value="">
                  Project default
                </NativeSelectOption>
              )}
              {(statuses.data ?? []).map((status) => (
                <NativeSelectOption key={status.id} value={status.id}>
                  {status.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor={priorityFieldId}>Priority</FieldLabel>
            <NativeSelect
              id={priorityFieldId}
              data-testid="task-form-priority"
              className="w-full"
              value={priorityValue}
              onChange={(event) => setPriorityValue(event.target.value)}
            >
              {editing ? null : (
                <NativeSelectOption value="">
                  Project default
                </NativeSelectOption>
              )}
              {(priorities.data ?? []).map((priority) => (
                <NativeSelectOption key={priority.id} value={priority.id}>
                  {priority.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {errorMessage ? (
          // The server's message verbatim (product spec §9), and a persistent
          // element rather than a toast so it can actually be asserted.
          <FieldError data-testid="task-form-error">{errorMessage}</FieldError>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="task-form-cancel"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            data-testid="task-form-submit"
            disabled={pending}
          >
            {editing ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

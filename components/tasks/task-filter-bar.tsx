"use client"

import { useId } from "react"

import { FilterChip } from "@/components/tasks/filter-chip"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePriorities, useProjects, useStatuses } from "@/lib/queries"

/**
 * What the user has narrowed the list to. Lives in `tasks-tab.tsx`; this
 * component is controlled.
 */
export type TaskFilterState = {
  projectId: string | null
  statusId: string | null
  priorityId: string | null
  search: string
  includeCompleted: boolean
}

export const EMPTY_TASK_FILTERS: TaskFilterState = {
  projectId: null,
  statusId: null,
  priorityId: null,
  search: "",
  includeCompleted: false,
}

export function hasActiveFilters(value: TaskFilterState): boolean {
  return (
    value.projectId !== null ||
    value.statusId !== null ||
    value.priorityId !== null ||
    value.search.trim() !== ""
  )
}

/**
 * The tag filters, text search and show-completed toggle of product spec §8.1.
 *
 * Status and priority chips only appear once a project is chosen, and they are
 * scoped to it. That is not a simplification — statuses and priorities are
 * per-project entities and `listTasksSchema` takes a single specific id, so a
 * global chip row would show two differently-scoped "To Do" chips from two
 * projects with no way to tell them apart, and would need an N-project fan-out
 * fetch to build. The spec's own example is project-first. When no project is
 * selected the hint says so rather than leaving a silent gap.
 */
export function TaskFilterBar({
  value,
  onChange,
}: {
  value: TaskFilterState
  onChange: (next: TaskFilterState) => void
}) {
  const searchId = useId()
  const completedId = useId()

  const projects = useProjects()
  const statuses = useStatuses(value.projectId)
  const priorities = usePriorities(value.projectId)

  /**
   * Changing the project clears the status and priority filters: those are ids
   * belonging to the previous project, so carrying them over would produce a
   * combination that can never match anything.
   */
  const selectProject = (projectId: string) => {
    onChange({
      ...value,
      projectId: value.projectId === projectId ? null : projectId,
      statusId: null,
      priorityId: null,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Project
        </span>
        <div className="flex flex-wrap gap-1.5">
          {(projects.data ?? []).map((project) => (
            <FilterChip
              key={project.id}
              testId={`filter-project-${project.id}`}
              label={project.name}
              active={value.projectId === project.id}
              onToggle={() => selectProject(project.id)}
            />
          ))}
        </div>
      </div>

      {value.projectId === null ? (
        <p
          data-testid="status-filter-hint"
          className="text-xs text-muted-foreground"
        >
          Select a project to filter by status or priority.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Status
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(statuses.data ?? []).map((status) => (
                <FilterChip
                  key={status.id}
                  testId={`filter-status-${status.id}`}
                  label={status.name}
                  active={value.statusId === status.id}
                  onToggle={() =>
                    onChange({
                      ...value,
                      statusId: value.statusId === status.id ? null : status.id,
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Priority
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(priorities.data ?? []).map((priority) => (
                <FilterChip
                  key={priority.id}
                  testId={`filter-priority-${priority.id}`}
                  label={priority.name}
                  active={value.priorityId === priority.id}
                  onToggle={() =>
                    onChange({
                      ...value,
                      priorityId:
                        value.priorityId === priority.id ? null : priority.id,
                    })
                  }
                />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={searchId} className="text-xs text-muted-foreground">
          Search tasks
        </Label>
        <Input
          id={searchId}
          type="search"
          data-testid="task-search-input"
          placeholder="Search titles and descriptions"
          value={value.search}
          onChange={(event) =>
            onChange({ ...value, search: event.target.value })
          }
        />
      </div>

      <Label htmlFor={completedId} className="w-fit gap-2 text-sm font-normal">
        <Checkbox
          id={completedId}
          data-testid="show-completed-toggle"
          checked={value.includeCompleted}
          onCheckedChange={(checked) =>
            onChange({ ...value, includeCompleted: checked })
          }
        />
        Show completed
      </Label>
    </div>
  )
}

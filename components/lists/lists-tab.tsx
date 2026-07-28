"use client"

import { useId, useState } from "react"

import { PrioritiesPanel } from "@/components/lists/priorities-panel"
import { ProjectsPanel } from "@/components/lists/projects-panel"
import { StatusesPanel } from "@/components/lists/statuses-panel"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { useProjects } from "@/lib/queries"

/**
 * The Manage lists tab (product spec §8.2).
 *
 * Projects first, then the per-project surfaces behind a project picker,
 * because statuses and priorities are per-project entities and managing them
 * is always done in the context of a selected project (§8.2, US-D1.1,
 * US-E1.1).
 *
 * The managed project is independent of the Tasks tab's project *filter*.
 * They mean different things: "no project filter" is a useful task view, while
 * "no project to manage" is not a state statuses and priorities can be in. One
 * shared value would force one of the two into a wrong default.
 */
export function ListsTab() {
  const selectId = useId()
  const [choice, setChoice] = useState<string | null>(null)

  const projects = useProjects()
  const options = projects.data ?? []

  // Derived, not stored, so the first project is managed as soon as the list
  // arrives and a deleted project falls back to the new first one — both
  // without an effect writing state back after render.
  const managedId =
    choice && options.some((project) => project.id === choice)
      ? choice
      : (options[0]?.id ?? null)

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <ProjectsPanel />

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={selectId} className="text-xs text-muted-foreground">
          Managing lists for
        </Label>
        <NativeSelect
          id={selectId}
          data-testid="manage-project-select"
          className="w-full"
          value={managedId ?? ""}
          disabled={options.length === 0}
          onChange={(event) => setChoice(event.target.value)}
        >
          {options.map((project) => (
            <NativeSelectOption key={project.id} value={project.id}>
              {project.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <StatusesPanel projectId={managedId} />

      <PrioritiesPanel projectId={managedId} />
    </div>
  )
}

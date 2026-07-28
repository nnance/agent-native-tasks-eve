"use client"

import { useState } from "react"

import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { InlineNameForm } from "@/components/shared/inline-name-form"
import { QueryState } from "@/components/shared/query-state"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useRenameProject,
  type ProjectDto,
} from "@/lib/queries"

/** Projects: create, rename, delete (product spec §8.2, US-C1–C3). */
export function ProjectsPanel() {
  const projects = useProjects()
  const createProject = useCreateProject()

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-sm font-medium">Projects</h2>

      <InlineNameForm
        idPrefix="project-create"
        submitLabel="Add project"
        placeholder="New project name"
        pending={createProject.isPending}
        error={createProject.error?.message ?? null}
        onSubmit={(name) => createProject.mutate({ name })}
      />

      <QueryState
        id="projects-panel"
        status={projects.status}
        error={projects.error}
        isEmpty={(projects.data ?? []).length === 0}
        emptyTitle="No projects"
        emptyDescription="Create one above to get started."
      >
        <ul className="flex flex-col gap-2">
          {(projects.data ?? []).map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      </QueryState>
    </section>
  )
}

function ProjectRow({ project }: { project: ProjectDto }) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const renameProject = useRenameProject()
  const deleteProject = useDeleteProject()

  return (
    <Item
      render={<li />}
      variant="outline"
      size="sm"
      data-testid={`project-row-${project.id}`}
      className="items-center"
    >
      <ItemContent>
        {renaming ? (
          <InlineNameForm
            idPrefix={`project-rename-${project.id}`}
            initialValue={project.name}
            submitLabel="Save"
            pending={renameProject.isPending}
            error={renameProject.error?.message ?? null}
            onSubmit={(name) =>
              renameProject.mutate(
                { projectId: project.id, name },
                { onSuccess: () => setRenaming(false) }
              )
            }
            onCancel={() => {
              renameProject.reset()
              setRenaming(false)
            }}
          />
        ) : (
          <ItemTitle data-testid={`project-name-${project.id}`}>
            {project.name}
          </ItemTitle>
        )}
      </ItemContent>

      {renaming ? null : (
        <ItemActions className="gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid={`project-rename-${project.id}`}
            onClick={() => {
              renameProject.reset()
              setRenaming(true)
            }}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            data-testid={`project-delete-${project.id}`}
            onClick={() => {
              deleteProject.reset()
              setConfirming(true)
            }}
          >
            Delete
          </Button>
        </ItemActions>
      )}

      <ConfirmDeleteDialog
        id={`delete-project-${project.id}`}
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this project?"
        description={`'${project.name}' and its statuses and priorities will be removed.`}
        error={deleteProject.error?.message ?? null}
        pending={deleteProject.isPending}
        onConfirm={() =>
          deleteProject.mutate(
            { projectId: project.id },
            { onSuccess: () => setConfirming(false) }
          )
        }
      />
    </Item>
  )
}

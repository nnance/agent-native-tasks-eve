"use client"

import { ProjectsPanel } from "@/components/lists/projects-panel"

/**
 * The Manage lists tab (product spec §8.2).
 *
 * Projects first, then the per-project surfaces. Statuses and priorities are
 * always managed in the context of a selected project, which is why they sit
 * under a project picker rather than beside the project list.
 */
export function ListsTab() {
  return (
    <div className="flex min-h-0 flex-col gap-6">
      <ProjectsPanel />
    </div>
  )
}

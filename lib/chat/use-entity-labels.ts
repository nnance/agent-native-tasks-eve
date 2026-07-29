"use client"

/**
 * Resolving the raw ids in a tool call to names the user recognises.
 *
 * Every gated tool's input carries only ids — `taskId`, `taskIds[]`,
 * `projectId`, `statusId`, `priorityId`. An approval card that renders
 * `Delete “7f3a1c…”` satisfies nothing; US-F5.2 asks it to say *which tasks*.
 * This hook is the bridge, and it is deliberately built on the cache the left
 * pane already warms, so the agent's approval card can never show a name the
 * task list disagrees with.
 *
 * It lives here rather than in `lib/queries/`, whose own doc comment fixes
 * that directory at one file per API resource. This is cross-resource by
 * nature.
 *
 * Two tiers, because two requests already cover almost everything:
 *
 * - **Tier 1, always.** `useProjects()` + `useTasks({ includeCompleted: true })`.
 *   `TaskDto` denormalises the project, status and priority *names* onto every
 *   row, so those two queries name every task plus every list currently in use.
 * - **Tier 2, only when tier 1 left a status or priority ref unresolved.** In
 *   practice that is only `delete_status` / `delete_priority`, whose schemas
 *   carry no owning `projectId` and whose targets are by definition unused. It
 *   fans out over every project's statuses and priorities, reusing
 *   `queryKeys.statuses.list(id)` / `queryKeys.priorities.list(id)` and the
 *   same URLs `useStatuses` / `usePriorities` use, so it warms and invalidates
 *   in lockstep with the Lists panel instead of building a private cache.
 *
 * Resolution is **progressive enhancement, never a gate**: Approve and Deny are
 * live whether or not a name has landed, and an unresolved id degrades to a
 * short id rather than to a fabricated name.
 */

import { useMemo, useState } from "react"
import { useQueries } from "@tanstack/react-query"
import type { EveMessage } from "eve/react"

import { apiFetch } from "@/lib/queries/http"
import { queryKeys } from "@/lib/queries/keys"
import { useProjects } from "@/lib/queries/projects"
import { useTasks } from "@/lib/queries/tasks"
import type { PriorityDto, StatusDto } from "@/lib/queries/types"
import {
  extractEntityRefs,
  type EntityLabels,
  type EntityRef,
} from "@/lib/chat/describe-tool-call"

/**
 * Every entity id referenced by any tool call in the transcript.
 *
 * The whole transcript, not just the latest message: a card that scrolled out
 * of view is still rendered, and US-F6.4 makes the historical action entries
 * part of the conversation rather than a transient effect.
 */
export function collectToolCallRefs(
  messages: readonly EveMessage[]
): readonly EntityRef[] {
  const refs: EntityRef[] = []
  const seen = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "dynamic-tool") continue

      for (const ref of extractEntityRefs(part.toolName, part.input)) {
        const key = `${ref.kind}:${ref.id}`
        if (seen.has(key)) continue
        seen.add(key)
        refs.push(ref)
      }
    }
  }

  return refs
}

export function useEntityLabels(refs: readonly EntityRef[]): EntityLabels {
  /**
   * Names, once resolved, stay resolved.
   *
   * The two tiers below only ever see rows that **currently exist**, and the
   * chat pane invalidates those queries at every turn boundary — so the moment
   * the agent deletes something, every name it had disappears from the caches
   * and the transcript rewrites its own history into short ids. That hits the
   * one entry the user most needs to be able to read afterwards: the settled
   * `delete_task` row for the delete they just approved, which would flip from
   * "Deleted Archive the old logo files" to "Deleted 7f3a1c2b" in front of
   * them. A transcript is a record of what happened; it does not get to forget.
   *
   * So this is a monotone cache: an id that has ever had a name keeps it, and
   * a fresh name always wins over a remembered one (a rename still lands).
   * Nothing ever fabricates a name — an id that was never resolved is still
   * absent, and `describeToolCall` still degrades it to a short id.
   *
   * State rather than a ref, because this *is* rendered — and the merge below
   * returns the state object itself whenever nothing changed, so the identity
   * consumers see is stable in the steady state.
   */
  const [remembered, setRemembered] = useState<Record<string, string>>({})

  const projects = useProjects()
  const tasks = useTasks({ includeCompleted: true })

  const tier1 = useMemo<EntityLabels>(() => {
    const labels: Record<string, string> = {}

    for (const project of projects.data ?? []) {
      labels[project.id] = project.name
    }

    for (const task of tasks.data ?? []) {
      labels[task.id] = task.title
      labels[task.project.id] = task.project.name
      labels[task.status.id] = task.status.name
      labels[task.priority.id] = task.priority.name
    }

    return labels
  }, [projects.data, tasks.data])

  // Only a status or priority can survive tier 1 unresolved, and only when no
  // task uses it. A missing *task* id means the task is genuinely gone (the
  // agent just deleted it, or hallucinated it) and no extra request would help.
  const needsListFanOut = useMemo(
    () =>
      refs.some(
        (ref) =>
          (ref.kind === "status" || ref.kind === "priority") &&
          tier1[ref.id] === undefined
      ),
    [refs, tier1]
  )

  const projectIds = useMemo(
    () => (projects.data ?? []).map((project) => project.id),
    [projects.data]
  )

  const listQueries = useQueries({
    queries: needsListFanOut
      ? projectIds.flatMap((projectId) => [
          {
            queryKey: queryKeys.statuses.list(projectId),
            queryFn: () =>
              apiFetch<StatusDto[]>(`/api/projects/${projectId}/statuses`),
          },
          {
            queryKey: queryKeys.priorities.list(projectId),
            queryFn: () =>
              apiFetch<PriorityDto[]>(`/api/projects/${projectId}/priorities`),
          },
        ])
      : [],
  })

  // Deliberately not memoized. `useQueries` hands back a fresh array on every
  // render, so any memo over it would need a hand-rolled signature key that
  // costs more than the merge it guards — this is a spread over a few dozen
  // rows, consumed only by pure `describeToolCall` calls.
  const listRows = listQueries.flatMap(
    (query) => (query.data as { id: string; name: string }[] | undefined) ?? []
  )

  const merged: Record<string, string> = { ...remembered, ...tier1 }

  for (const row of listRows) merged[row.id] = row.name

  // Identical content collapses back to the state object, so `labels` only
  // changes identity when a label actually changed.
  const labels = sameLabels(remembered, merged) ? remembered : merged

  // React's own "adjusting state while rendering" pattern, not an effect: the
  // new map is already in hand and returned this render, and the setState only
  // parks it for the next one. Guarded by the comparison above, so it cannot
  // loop.
  if (labels !== remembered) setRemembered(labels)

  return labels
}

function sameLabels(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = Object.keys(b)

  if (keys.length !== Object.keys(a).length) return false

  return keys.every((key) => a[key] === b[key])
}

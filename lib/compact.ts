/**
 * The compact row projections the model sees from the six array-returning
 * tools (implementation plan §2.4), and the shape they are wrapped in.
 *
 * Hoisted out of `agent/lib/` when the MCP interface landed (§2.8): trimming is
 * a promise made to a *model*, and both agent-facing interfaces make it, so
 * both must make it identically or the two agents are reading different data.
 * `agent/lib/list-output.ts` wraps `compactPayload` in EVE's `toModelOutput`
 * contract; `mcp/server.ts` puts the same value in an MCP content block.
 *
 * One pure function per entity, typed against the **serialized** shapes
 * because they run downstream of `runAction`, which has already rewritten
 * every `Date` to an ISO string.
 *
 * `id` is kept on every row without exception: the model needs ids to call
 * `update_task`, `delete_task` and the `bulk_*` tools, and an approval prompt
 * that renders the tool input can only be precise if the ids the model passed
 * were real (US-F5.2). What is dropped is what a list does not need —
 * `description`, `createdAt`, `updatedAt`, `projectId`. `get_task` returns the
 * full record for when the model actually needs a task's text.
 */

import type { TaskView } from "./actions/tasks.ts"
import type { Priority, Project, Status } from "./db/schema.ts"
import type { Serialized } from "./serialized.ts"
import type { ToolFailure, ToolResult } from "./tool-result.ts"

/** A trimmed list result: how many there were, and the rows themselves. */
export type CompactList<R> = { ok: true; count: number; items: R[] }

/**
 * Trims a successful array result down to a count plus compact rows.
 *
 * Failures pass through untouched: they are already small, and `kind` plus
 * `message` are precisely what the model has to relay to the user.
 */
export function compactPayload<T, R>(
  output: ToolResult<T[]>,
  toRow: (row: T) => R
): CompactList<R> | ToolFailure {
  return output.ok
    ? { ok: true, count: output.data.length, items: output.data.map(toRow) }
    : output
}

/** A task row, with the joined names flattened and the long text dropped. */
export function compactTask(task: Serialized<TaskView>) {
  return {
    id: task.id,
    title: task.title,
    project: task.project.name,
    status: task.status.name,
    priority: task.priority.name,
    isCompleted: task.status.isCompleted,
  }
}

export function compactProject(project: Serialized<Project>) {
  return { id: project.id, name: project.name }
}

export function compactStatus(status: Serialized<Status>) {
  return {
    id: status.id,
    name: status.name,
    order: status.order,
    isCompleted: status.isCompleted,
  }
}

export function compactPriority(priority: Serialized<Priority>) {
  return {
    id: priority.id,
    name: priority.name,
    order: priority.order,
    isDefault: priority.isDefault,
  }
}

/**
 * `bulkDeleteTasks` returns only the identity of what it removed, which is
 * already compact — the projection is identity, kept so every array-returning
 * tool goes through the same `compactList` shape.
 */
export function compactDeletedTask(task: { id: string; title: string }) {
  return task
}

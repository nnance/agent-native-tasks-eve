/**
 * The compact row projections the model sees from the six array-returning
 * tools (implementation plan §2.4).
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

import type { TaskView } from "../../lib/actions/tasks.ts"
import type { Priority, Project, Status } from "../../lib/db/schema.ts"
import type { Serialized } from "../../lib/serialized.ts"

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

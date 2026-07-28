/**
 * The wire shapes, derived from the action-layer types rather than restated.
 *
 * `Response.json` runs the value through `JSON.stringify`, which turns every
 * `Date` into an ISO string. Reusing `TaskView` / `Project` / `Status` /
 * `Priority` verbatim on the client would therefore be a lie about
 * `createdAt`; restating the shapes by hand would be a second source of truth.
 * `Serialized<T>` is the narrow fix: one recursive mapped type that rewrites
 * `Date` to `string` and leaves everything else alone.
 *
 * Every import here is `import type`, which `isolatedModules` guarantees is
 * erased at compile time — so there is no runtime edge from client code into
 * `lib/actions` or `lib/db`.
 */

import type { TaskView } from "@/lib/actions/tasks"
import type { Priority, Project, Status } from "@/lib/db/schema"

export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T

export type TaskDto = Serialized<TaskView>
export type ProjectDto = Serialized<Project>
export type StatusDto = Serialized<Status>
export type PriorityDto = Serialized<Priority>

/** What every delete endpoint returns: the identity of what was removed. */
export type DeletedRef = { id: string; name: string }
export type DeletedTaskRef = { id: string; title: string }

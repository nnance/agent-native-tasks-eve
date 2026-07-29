/**
 * The wire shapes, derived from the action-layer types rather than restated.
 *
 * `Response.json` runs the value through `JSON.stringify`, which turns every
 * `Date` into an ISO string. Reusing `TaskView` / `Project` / `Status` /
 * `Priority` verbatim on the client would therefore be a lie about
 * `createdAt`; restating the shapes by hand would be a second source of truth.
 * `Serialized<T>` is the narrow fix: one recursive mapped type that rewrites
 * `Date` to `string` and leaves everything else alone. It now lives in
 * `lib/serialized.ts` — Phase 4's EVE tools have the same obligation at the
 * tool boundary and cannot import this module, which resolves through the
 * `@/` alias — and is re-exported here so every existing importer is unchanged.
 *
 * Every import here is `import type`, which `isolatedModules` guarantees is
 * erased at compile time — so there is no runtime edge from client code into
 * `lib/actions` or `lib/db`.
 */

import type { TaskView } from "@/lib/actions/tasks"
import type { Priority, Project, Status } from "@/lib/db/schema"
import type { Serialized } from "@/lib/serialized"

export type { Serialized }

export type TaskDto = Serialized<TaskView>
export type ProjectDto = Serialized<Project>
export type StatusDto = Serialized<Status>
export type PriorityDto = Serialized<Priority>

/** What every delete endpoint returns: the identity of what was removed. */
export type DeletedRef = { id: string; name: string }
export type DeletedTaskRef = { id: string; title: string }

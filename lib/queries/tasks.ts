"use client"

/**
 * Task reads and writes, over `app/api/tasks`.
 *
 * Every mutation invalidates `["tasks"]` and nothing narrower. A surgical
 * "only this filter set" invalidation would be wrong: the filters a pane holds
 * are not knowable from a mutation's variables, and `TaskView` denormalises
 * the project/status/priority names and flags onto every row.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"

import type {
  CreateTaskInput,
  DeleteTaskInput,
  UpdateTaskInput,
} from "@/lib/schemas"

import { ApiError, apiFetch, jsonBody } from "./http"
import { queryKeys, taskSearchParams, type TaskFilters } from "./keys"
import type { DeletedTaskRef, TaskDto } from "./types"

/**
 * The task list, ordered and filtered entirely server-side (§8.1 ordering is
 * canonical in lib/actions/tasks.ts — the UI never re-sorts).
 *
 * `keepPreviousData` matters for more than polish: without it the list would
 * drop to `task-list-loading` on every filter change and every debounced
 * keystroke, which both flickers and destroys the loading/empty/error
 * distinction §2.7 requires the E2E suite to be able to make.
 */
export function useTasks(
  filters: TaskFilters
): UseQueryResult<TaskDto[], ApiError> {
  return useQuery<TaskDto[], ApiError>({
    queryKey: queryKeys.tasks.list(filters),
    queryFn: () =>
      apiFetch<TaskDto[]>(`/api/tasks${taskSearchParams(filters)}`),
    placeholderData: keepPreviousData,
  })
}

export function useCreateTask(): UseMutationResult<
  TaskDto,
  ApiError,
  CreateTaskInput
> {
  const client = useQueryClient()

  return useMutation<TaskDto, ApiError, CreateTaskInput>({
    mutationFn: (input) =>
      apiFetch<TaskDto>("/api/tasks", { method: "POST", ...jsonBody(input) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

/** `taskId` addresses the row and stays in the URL; the rest is the body. */
export function useUpdateTask(): UseMutationResult<
  TaskDto,
  ApiError,
  UpdateTaskInput
> {
  const client = useQueryClient()

  return useMutation<TaskDto, ApiError, UpdateTaskInput>({
    mutationFn: ({ taskId, ...patch }) =>
      apiFetch<TaskDto>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        ...jsonBody(patch),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

export function useDeleteTask(): UseMutationResult<
  DeletedTaskRef,
  ApiError,
  DeleteTaskInput
> {
  const client = useQueryClient()

  return useMutation<DeletedTaskRef, ApiError, DeleteTaskInput>({
    mutationFn: ({ taskId }) =>
      apiFetch<DeletedTaskRef>(`/api/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

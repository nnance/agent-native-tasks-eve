"use client"

/**
 * Status reads and writes, over `app/api/projects/[projectId]/statuses`.
 *
 * Every status mutation invalidates `["tasks"]` as well as `["statuses"]`, and
 * that is not belt-and-braces. `TaskView` denormalises `status.name`,
 * `status.order` and `status.isCompleted` onto every row, and the server's
 * canonical ordering keys off `statuses.isCompleted` — so a rename changes the
 * chips (US-D1.4), a completed-toggle changes which tasks are even visible
 * (US-D1.3), and a reorder can change the sort.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"

import type { CreateStatusInput, UpdateStatusInput } from "@/lib/schemas"

import { ApiError, apiFetch, jsonBody } from "./http"
import { queryKeys } from "./keys"
import type { DeletedRef, StatusDto } from "./types"

/** The URL segment carries the project, so mutations need it alongside. */
export type StatusMutationInput = UpdateStatusInput & { projectId: string }
export type DeleteStatusInput = { projectId: string; statusId: string }

export function useStatuses(
  projectId: string | null | undefined
): UseQueryResult<StatusDto[], ApiError> {
  return useQuery<StatusDto[], ApiError>({
    queryKey: queryKeys.statuses.list(projectId ?? ""),
    queryFn: () => apiFetch<StatusDto[]>(`/api/projects/${projectId}/statuses`),
    enabled: Boolean(projectId),
  })
}

function useStatusInvalidation() {
  const client = useQueryClient()

  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.statuses.all })
    void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
  }
}

export function useCreateStatus(): UseMutationResult<
  StatusDto,
  ApiError,
  CreateStatusInput
> {
  const invalidate = useStatusInvalidation()

  return useMutation<StatusDto, ApiError, CreateStatusInput>({
    mutationFn: ({ projectId, ...body }) =>
      apiFetch<StatusDto>(`/api/projects/${projectId}/statuses`, {
        method: "POST",
        ...jsonBody(body),
      }),
    onSuccess: invalidate,
  })
}

export function useUpdateStatus(): UseMutationResult<
  StatusDto,
  ApiError,
  StatusMutationInput
> {
  const invalidate = useStatusInvalidation()

  return useMutation<StatusDto, ApiError, StatusMutationInput>({
    mutationFn: ({ projectId, statusId, ...patch }) =>
      apiFetch<StatusDto>(`/api/projects/${projectId}/statuses/${statusId}`, {
        method: "PATCH",
        ...jsonBody(patch),
      }),
    onSuccess: invalidate,
  })
}

export function useDeleteStatus(): UseMutationResult<
  DeletedRef,
  ApiError,
  DeleteStatusInput
> {
  const invalidate = useStatusInvalidation()

  return useMutation<DeletedRef, ApiError, DeleteStatusInput>({
    mutationFn: ({ projectId, statusId }) =>
      apiFetch<DeletedRef>(`/api/projects/${projectId}/statuses/${statusId}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  })
}

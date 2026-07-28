"use client"

/**
 * Priority reads and writes, over `app/api/projects/[projectId]/priorities`.
 *
 * Structurally identical to `./statuses.ts`, and invalidates `["tasks"]` for
 * the same reason: `TaskView` carries `priority.{name,order,isDefault}` on
 * every row and the canonical ordering is `desc(priorities.order)`, so a
 * rename changes chips (US-E1.4), a reorder re-sorts the list (US-E1.2), and
 * deleting the default rewrites another priority's `isDefault` (US-E2.4).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"

import type { CreatePriorityInput, UpdatePriorityInput } from "@/lib/schemas"

import { ApiError, apiFetch, jsonBody } from "./http"
import { queryKeys } from "./keys"
import type { DeletedRef, PriorityDto } from "./types"

export type PriorityMutationInput = UpdatePriorityInput & { projectId: string }
export type DeletePriorityInput = { projectId: string; priorityId: string }

export function usePriorities(
  projectId: string | null | undefined
): UseQueryResult<PriorityDto[], ApiError> {
  return useQuery<PriorityDto[], ApiError>({
    queryKey: queryKeys.priorities.list(projectId ?? ""),
    queryFn: () =>
      apiFetch<PriorityDto[]>(`/api/projects/${projectId}/priorities`),
    enabled: Boolean(projectId),
  })
}

function usePriorityInvalidation() {
  const client = useQueryClient()

  return () => {
    void client.invalidateQueries({ queryKey: queryKeys.priorities.all })
    void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
  }
}

export function useCreatePriority(): UseMutationResult<
  PriorityDto,
  ApiError,
  CreatePriorityInput
> {
  const invalidate = usePriorityInvalidation()

  return useMutation<PriorityDto, ApiError, CreatePriorityInput>({
    mutationFn: ({ projectId, ...body }) =>
      apiFetch<PriorityDto>(`/api/projects/${projectId}/priorities`, {
        method: "POST",
        ...jsonBody(body),
      }),
    onSuccess: invalidate,
  })
}

export function useUpdatePriority(): UseMutationResult<
  PriorityDto,
  ApiError,
  PriorityMutationInput
> {
  const invalidate = usePriorityInvalidation()

  return useMutation<PriorityDto, ApiError, PriorityMutationInput>({
    mutationFn: ({ projectId, priorityId, ...patch }) =>
      apiFetch<PriorityDto>(
        `/api/projects/${projectId}/priorities/${priorityId}`,
        { method: "PATCH", ...jsonBody(patch) }
      ),
    onSuccess: invalidate,
  })
}

export function useDeletePriority(): UseMutationResult<
  DeletedRef,
  ApiError,
  DeletePriorityInput
> {
  const invalidate = usePriorityInvalidation()

  return useMutation<DeletedRef, ApiError, DeletePriorityInput>({
    mutationFn: ({ projectId, priorityId }) =>
      apiFetch<DeletedRef>(
        `/api/projects/${projectId}/priorities/${priorityId}`,
        { method: "DELETE" }
      ),
    onSuccess: invalidate,
  })
}

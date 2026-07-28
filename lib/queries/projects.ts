"use client"

/**
 * Project reads and writes, over `app/api/projects`.
 *
 * Invalidation is deliberately broad, because `TaskView` carries
 * `project.name` on every row: a rename must show on every task chip without a
 * reload (US-C2.1). A delete additionally takes the project's statuses and
 * priorities with it through the schema's ON DELETE CASCADE, so their caches
 * are stale too.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query"

import type {
  CreateProjectInput,
  DeleteProjectInput,
  RenameProjectInput,
} from "@/lib/schemas"

import { ApiError, apiFetch, jsonBody } from "./http"
import { queryKeys } from "./keys"
import type { DeletedRef, ProjectDto } from "./types"

export function useProjects(): UseQueryResult<ProjectDto[], ApiError> {
  return useQuery<ProjectDto[], ApiError>({
    queryKey: queryKeys.projects.list(),
    queryFn: () => apiFetch<ProjectDto[]>("/api/projects"),
  })
}

export function useCreateProject(): UseMutationResult<
  ProjectDto,
  ApiError,
  CreateProjectInput
> {
  const client = useQueryClient()

  return useMutation<ProjectDto, ApiError, CreateProjectInput>({
    mutationFn: (input) =>
      apiFetch<ProjectDto>("/api/projects", {
        method: "POST",
        ...jsonBody(input),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.projects.all })
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

export function useRenameProject(): UseMutationResult<
  ProjectDto,
  ApiError,
  RenameProjectInput
> {
  const client = useQueryClient()

  return useMutation<ProjectDto, ApiError, RenameProjectInput>({
    mutationFn: ({ projectId, ...patch }) =>
      apiFetch<ProjectDto>(`/api/projects/${projectId}`, {
        method: "PATCH",
        ...jsonBody(patch),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.projects.all })
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}

export function useDeleteProject(): UseMutationResult<
  DeletedRef,
  ApiError,
  DeleteProjectInput
> {
  const client = useQueryClient()

  return useMutation<DeletedRef, ApiError, DeleteProjectInput>({
    mutationFn: ({ projectId }) =>
      apiFetch<DeletedRef>(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.projects.all })
      void client.invalidateQueries({ queryKey: queryKeys.tasks.all })
      void client.invalidateQueries({ queryKey: queryKeys.statuses.all })
      void client.invalidateQueries({ queryKey: queryKeys.priorities.all })
    },
  })
}

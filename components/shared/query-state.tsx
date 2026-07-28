"use client"

import type { ReactNode } from "react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { ApiError } from "@/lib/queries"

/**
 * The loading / error / empty / content fork, in one place.
 *
 * Implementation plan §2.7 requires deterministic loading, empty and error
 * states with their own testids so the E2E suite can tell "still loading" from
 * "genuinely empty" — a distinction that is impossible to assert if every
 * surface improvises its own. Exactly one branch renders, and the testids are
 * derived from a single `id` prefix so the suite can predict them.
 *
 * The error branch prints `error.message` **verbatim**: it is the server's
 * `RuleViolation` / `NotFoundError` string, which product spec §9 makes a
 * product deliverable. `role="alert"` so it is announced rather than silently
 * swapped in.
 */
export function QueryState({
  id,
  status,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  id: string
  status: "pending" | "error" | "success"
  error: ApiError | null
  isEmpty: boolean
  emptyTitle: string
  emptyDescription?: string
  emptyAction?: ReactNode
  children: ReactNode
}) {
  if (status === "pending") {
    return (
      <div
        data-testid={`${id}-loading`}
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
      >
        <Spinner />
        Loading…
      </div>
    )
  }

  if (status === "error") {
    return (
      <div
        data-testid={`${id}-error`}
        role="alert"
        className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {error?.message ?? "Something went wrong."}
      </div>
    )
  }

  if (isEmpty) {
    return (
      <Empty data-testid={`${id}-empty`} className="border p-8">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          {emptyDescription ? (
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          ) : null}
        </EmptyHeader>
        {emptyAction}
      </Empty>
    )
  }

  return <>{children}</>
}

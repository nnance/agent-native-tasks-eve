"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * The confirmation guard every destructive action goes through (§9 "Safety",
 * US-B6.1, US-C3.1).
 *
 * There is no pre-check for whether the delete is allowed, and there should
 * not be. No can-delete endpoint exists, and `listProjects` / `listStatuses` /
 * `listPriorities` return no task counts, so any client-side pre-check would
 * be a bespoke query producing a guess. Instead the dialog fires the request
 * on confirm and, on a 409, renders the server's `RuleViolation` message
 * **verbatim** and stays open — which is exactly §7.3's "clearly stopped,
 * told the reason and what I can do about it".
 *
 * `AlertDialog` rather than `Dialog`: this is a decision the user must make,
 * not a surface they can dismiss by clicking away.
 */
export function ConfirmDeleteDialog({
  id,
  open,
  onOpenChange,
  title,
  description,
  error,
  pending,
  onConfirm,
}: {
  /** testid prefix, e.g. `delete-task-<id>` */
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  error: string | null
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid={`${id}-dialog`}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p
            data-testid={`${id}-error`}
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`${id}-cancel`}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid={`${id}-confirm`}
            disabled={pending}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

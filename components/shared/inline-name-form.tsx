"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { nameSchema } from "@/lib/schemas"

/**
 * The create-or-rename control shared by every list-management panel.
 *
 * Validated with `nameSchema.safeParse` — the same object the route and the
 * (Phase 4) tool parse — rather than an inline `value.trim() !== ""`, so the
 * client can never disagree with the server about what a valid name is.
 *
 * The server's message is rendered verbatim in the same slot as the local
 * validation message, so a caller has one place to look and the E2E suite has
 * one testid to assert.
 *
 * `resetOnSuccess` is for the *create* forms. Without it the field keeps its
 * text after a successful create, so a second click on Add silently creates a
 * duplicate. Rename forms do not need it — the parent unmounts the form on
 * success — which is why this is opt-in rather than the default.
 */
export function InlineNameForm({
  idPrefix,
  initialValue = "",
  submitLabel,
  placeholder,
  pending,
  error,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
}: {
  /** testid prefix, e.g. `project-create` or `project-rename-<id>` */
  idPrefix: string
  initialValue?: string
  submitLabel: string
  placeholder?: string
  pending: boolean
  error: string | null
  /**
   * Return a promise (e.g. TanStack's `mutateAsync`) to opt into
   * `resetOnSuccess`; a rejected promise leaves the text in place so the user
   * can retry without retyping.
   */
  onSubmit: (name: string) => void | Promise<unknown>
  onCancel?: () => void
  resetOnSuccess?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  const [localError, setLocalError] = useState<string | null>(null)

  const message = localError ?? error

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()

        const parsed = nameSchema.safeParse(value)

        if (!parsed.success) {
          setLocalError(parsed.error.issues[0]?.message ?? "Invalid name.")
          return
        }

        setLocalError(null)

        const result = onSubmit(parsed.data)

        if (resetOnSuccess && result instanceof Promise) {
          // Clear only once the write has actually landed. The rejection path
          // is deliberately swallowed: the parent already renders the failure
          // through `error`, and keeping the text lets the user retry.
          result.then(
            () => setValue(""),
            () => {}
          )
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          data-testid={`${idPrefix}-input`}
          aria-label={submitLabel}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          data-testid={`${idPrefix}-submit`}
          disabled={pending}
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid={`${idPrefix}-cancel`}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      {message ? (
        <FieldError data-testid={`${idPrefix}-error`}>{message}</FieldError>
      ) : null}
    </form>
  )
}

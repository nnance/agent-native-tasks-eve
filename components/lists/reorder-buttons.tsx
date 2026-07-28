"use client"

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Move a row up or down within its project's ordered list.
 *
 * Up/down buttons rather than drag-and-drop. The API already models `order` as
 * a 0-based target position with server-side renumbering, which up/down
 * implements completely; drag-and-drop would need a runtime dependency §1.1
 * rejects plus real keyboard-accessibility work, for lists that are typically
 * three to six items long.
 */
export function ReorderButtons({
  idPrefix,
  id,
  index,
  count,
  pending,
  onMove,
}: {
  /** "status" or "priority" */
  idPrefix: string
  id: string
  index: number
  count: number
  pending: boolean
  onMove: (targetIndex: number) => void
}) {
  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        aria-label="Move up"
        data-testid={`${idPrefix}-up-${id}`}
        disabled={pending || index === 0}
        onClick={() => onMove(index - 1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        aria-label="Move down"
        data-testid={`${idPrefix}-down-${id}`}
        disabled={pending || index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <ChevronDownIcon />
      </Button>
    </>
  )
}

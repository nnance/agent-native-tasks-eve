"use client"

import { Button } from "@/components/ui/button"

/**
 * One selectable tag in a filter row (product spec §8.1).
 *
 * Single-select per category: clicking the active chip clears that filter, and
 * the three categories combine with AND. `listTasksSchema` accepts one
 * `projectId` / `statusId` / `priorityId`, so a multi-select chip row would be
 * a UI that promises something the contract cannot express. It also matches
 * the spec's own worked example — Website AND In Progress AND High.
 *
 * `aria-pressed` rather than a checkbox role: this is a toggle button, and it
 * is what makes the selected state audible as well as visible.
 */
export function FilterChip({
  testId,
  label,
  active,
  onToggle,
}: {
  testId: string
  label: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      data-testid={testId}
      data-active={active}
      onClick={onToggle}
    >
      {label}
    </Button>
  )
}

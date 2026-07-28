"use client"

import { useEffect, useState } from "react"

/**
 * Trails `value` by `delayMs`, so a fast-changing input (the task search box)
 * produces one query rather than one per keystroke.
 *
 * The initial state is the live value, not `undefined`, so the first render
 * never shows an empty result while the timer settles.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)

    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

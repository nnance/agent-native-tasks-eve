"use client"

/**
 * The client-side providers the app tree needs.
 *
 * React context is unavailable in Server Components, so the TanStack
 * `QueryClientProvider` lives here behind a `"use client"` boundary and is
 * rendered from the Server Component layout — the documented pattern
 * (next/dist/docs/.../05-server-and-client-components.md, "Context providers")
 * and the same shape `components/theme-provider.tsx` already uses.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

/**
 * One `QueryClient` configuration, in one place.
 *
 * - `refetchOnWindowFocus` + `refetchInterval` are implementation plan §2.6's
 *   backstop for live sync (§5), configured once on the client rather than per
 *   hook. The `onEvent`-driven half arrives in Phase 6; this half costs nothing
 *   now and avoids a client-config retrofit later.
 * - `retry: 0` is deliberate. TanStack's default of three retries with
 *   exponential backoff would delay every `*-error` testid by roughly seven
 *   seconds, making the deterministic error state plan §2.7 requires both slow
 *   to assert and flaky. This is a single-user local app; a retry storm only
 *   delays an honest error.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: 0,
        refetchOnWindowFocus: true,
        refetchInterval: 30_000,
      },
      mutations: { retry: 0 },
    },
  })
}

/**
 * `useState(makeQueryClient)` rather than a module-level singleton: the lazy
 * initialiser runs once per mounted tree, so a client is never shared across
 * requests during SSR and never recreated by a re-render.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

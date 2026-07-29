import { connection } from "next/server"

import { AppShell } from "@/components/app-shell"
import { ChatPane } from "@/components/workspace/chat-pane"
import { TaskWorkspace } from "@/components/workspace/task-workspace"
import { getChatState } from "@/lib/actions/chat-state"

/**
 * The whole app: the split screen of product spec §8.0.
 *
 * Now an async Server Component, because the chat pane has a real server data
 * need: the persisted conversation snapshot must be on the first render of
 * `ChatPane`, not fetched after mount. `useEveAgent` reads its session options
 * once, when it builds its store, so a snapshot that arrives later would be
 * ignored and US-F1.3 would silently fail.
 *
 * `getChatState()` is called directly rather than fetched from
 * `/api/chat-state`: a Server Component has no reason to make an HTTP round
 * trip to its own origin, and the action is the same code the route calls. It
 * is imported from its file rather than through `lib/actions/index.ts` — that
 * barrel is the product-spec §5 capability set, and chat state is transport,
 * not a capability.
 *
 * `await connection()` is load-bearing and was found by reading the build
 * output, not by reasoning about it. This page uses no request-time API — no
 * `params`, no `searchParams`, no `cookies()` — so Next 16 happily prerenders
 * it as static, and `pnpm build` marked `/` with a `○`. That would have baked
 * one build-time conversation snapshot into the HTML forever and broken
 * US-F1.3 under `next start` while working perfectly under `next dev`.
 * `connection()` is the documented way to say "wait for a real request" when
 * no request API is read
 * (next/dist/docs/.../04-functions/connection.md); it is a function call, not
 * route-segment config, and it needs no `cacheComponents`, which stays off.
 */
export default async function Page() {
  await connection()

  const snapshot = await getChatState()

  return (
    <AppShell
      left={<TaskWorkspace />}
      right={
        <ChatPane
          snapshot={{ events: snapshot.events, session: snapshot.session }}
        />
      }
    />
  )
}

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
 * Still no `params` or `searchParams`, so Next 16's Promise-only request APIs
 * never come into play, and `cacheComponents` is off in next.config.ts, so no
 * Suspense obligation applies. Filter and search state stays local React state
 * inside the tasks tab.
 */
export default async function Page() {
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

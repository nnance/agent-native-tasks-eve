import { AppShell } from "@/components/app-shell"
import { ChatPanePlaceholder } from "@/components/workspace/chat-pane-placeholder"
import { TaskWorkspace } from "@/components/workspace/task-workspace"

/**
 * The whole app: the split screen of product spec §8.0.
 *
 * A Server Component with no props. There is no `params` or `searchParams`
 * here, so Next 16's Promise-only request APIs never come into play, and
 * `cacheComponents` is off in next.config.ts, so no Suspense obligation
 * applies either. Filter and search state is local React state inside the
 * tasks tab rather than URL state — no acceptance criterion asks for a
 * shareable filtered view, and keeping it local avoids `useSearchParams` on a
 * page with no server-rendered data need.
 */
export default function Page() {
  return <AppShell left={<TaskWorkspace />} right={<ChatPanePlaceholder />} />
}

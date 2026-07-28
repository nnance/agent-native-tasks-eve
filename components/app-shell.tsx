import type { ReactNode } from "react"

/**
 * The split screen of product spec §8.0.
 *
 * Both halves are permanently visible — neither is a drawer, modal or separate
 * page — because the whole thesis is that you ask for a change on the right
 * and watch it land on the left. Below `lg` the two stack vertically (§8.0's
 * explicit allowance for viewports too narrow for a usable split); at `lg` and
 * above each half owns its own scroll container so one pane scrolling never
 * moves the other.
 *
 * A plain Server Component: it has no state, so there is no reason to ship the
 * static chrome to the client bundle.
 */
export function AppShell({
  left,
  right,
}: {
  left: ReactNode
  right: ReactNode
}) {
  return (
    <div
      data-testid="app-shell"
      className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:flex-row"
    >
      <section
        data-testid="task-pane"
        aria-label="Tasks"
        className="flex min-h-0 flex-1 flex-col border-b border-border lg:w-1/2 lg:overflow-y-auto lg:border-r lg:border-b-0"
      >
        {left}
      </section>
      <section
        data-testid="chat-pane"
        aria-label="Agent chat"
        className="flex min-h-0 flex-1 flex-col lg:w-1/2 lg:overflow-y-auto"
      >
        {right}
      </section>
    </div>
  )
}

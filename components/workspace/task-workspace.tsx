"use client"

import { ListsTab } from "@/components/lists/lists-tab"
import { TasksTab } from "@/components/tasks/tasks-tab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * The left half of the split screen, and the root of the interactive tree.
 *
 * The `"use client"` boundary starts here rather than at `app/page.tsx`: the
 * page and `AppShell` are static chrome with no state, so there is no reason
 * to ship them to the browser.
 *
 * List management is a second **tab**, not a dialog or a route. Product spec
 * §8.2 asks for dedicated management surfaces and the implementation plan
 * describes one page; a tab keeps both halves of §8.0 permanently visible and
 * avoids the nested-modal problem a dialog-based manager would create as soon
 * as a delete confirmation opens inside it.
 *
 * Neither tab's state is lifted here. The two panels mean genuinely different
 * things by "selected project" — the task filter's is nullable and means "all
 * projects", the manager's is never null because statuses and priorities have
 * no meaningful project-less state — so sharing one value would force one of
 * them into a wrong default.
 */
export function TaskWorkspace() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-lg font-medium">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Everything here is also available to the agent, and vice versa.
        </p>
      </header>

      <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList>
          <TabsTrigger value="tasks" data-testid="tab-tasks">
            Tasks
          </TabsTrigger>
          <TabsTrigger value="lists" data-testid="tab-lists">
            Manage lists
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="tasks"
          data-testid="panel-tasks"
          className="flex min-h-0 flex-col gap-4"
        >
          <TasksTab />
        </TabsContent>

        <TabsContent
          value="lists"
          data-testid="panel-lists"
          className="flex min-h-0 flex-col gap-6"
        >
          <ListsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

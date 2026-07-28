import { MessageCircleDashedIcon, SendHorizontalIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

/**
 * The right half of the split screen, until Phase 5 wires the real agent.
 *
 * Deliberately inert: no `useChat`, no transport, no scripted transcript. The
 * demo conversation that used to live in `app/page.tsx` was a canned script
 * with a fake transport, and shipping it inside the real shell would overstate
 * what is implemented. The composer is present but visibly disabled so the
 * §8.0 layout is honest about its two halves while the copy is honest about
 * which one works.
 *
 * The chat-kit components it borrows (`InputGroup`, `Card`, `Empty`) are the
 * ones Phase 5 grows the real pane from — the shell is the components, not the
 * transcript.
 */
export function ChatPanePlaceholder() {
  return (
    <div
      data-testid="chat-placeholder"
      className="flex min-h-0 flex-1 flex-col p-4"
    >
      <Card className="flex min-h-0 flex-1 flex-col gap-0">
        <CardHeader className="gap-1 border-b">
          <CardTitle>Agent</CardTitle>
          <CardDescription>
            Ask for a change here and watch it land on the left.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 overflow-hidden p-0">
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleDashedIcon />
              </EmptyMedia>
              <EmptyTitle>The agent arrives in a later phase</EmptyTitle>
              <EmptyDescription>
                Everything on the left already works. This pane becomes a real
                conversation once the agent and its tools are wired up.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <InputGroup data-testid="chat-composer-disabled" className="w-full">
            <InputGroupTextarea
              aria-label="Message the agent"
              placeholder="Not available yet"
              disabled
              rows={2}
            />
            <InputGroupAddon align="block-end" className="pt-1">
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="default"
                className="ml-auto"
                disabled
                aria-label="Send"
              >
                <SendHorizontalIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </CardFooter>
      </Card>
    </div>
  )
}

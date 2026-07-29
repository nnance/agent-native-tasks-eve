"use client"

/**
 * The right half of the split screen: a real conversation with the agent.
 *
 * This is the only stateful node in the feature. `app/page.tsx` stays a Server
 * Component that reads the persisted snapshot and hands it down, matching the
 * "client boundary as deep as possible" shape `TaskWorkspace` already uses on
 * the left.
 *
 * ## The session is ours, not the hook's
 *
 * `useEveAgent` will happily build its own session from `initialSession`, and
 * the docs' minimal recipe does exactly that. We do not use it. The hook
 * constructs `new Client({ auth, headers, host }).session(initialSession)` and
 * never passes `preserveCompletedSessions`, which the `Client` constructor
 * defaults to `false` — and `advanceSession` throws the cursor away
 * (`createInitialSessionState()`) on any `session.completed` boundary. The next
 * send would then open a *fresh* server-side conversation and "move that one
 * to Done" would resolve against nothing.
 *
 * A conversation-mode turn is supposed to park at `session.waiting`, so in
 * practice the cursor survives either way. But US-F1.4 is a graded exit
 * criterion, owning the session costs four lines, and it is what eve's own
 * scaffolded chat template does. `EveAgentStore` still honours `initialEvents`
 * when an external session is supplied, so nothing is lost.
 *
 * ## Persistence
 *
 * `onFinish` fires from the store's `finally` block on every turn boundary —
 * completion, error, abort, and a turn parked waiting for an approval — so one
 * PUT there covers US-F1.3 including a reload with an approval card on screen.
 * The whole snapshot goes every time, session cursor included in full.
 *
 * ## Cache hygiene
 *
 * `onFinish` also invalidates the four query families. That is this pane's own
 * housekeeping, not Phase 6's live sync: without it the label resolver goes
 * stale the moment the agent creates or renames anything, and the next
 * approval card in the same conversation degrades to short ids — a direct
 * US-F5.2 regression. Phase 6 replaces it with finer-grained `onEvent`
 * invalidation.
 *
 * §3.4: everything the agent writes into this pane is untrusted *data*. It is
 * rendered as text and never interpreted.
 */

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { SendHorizontalIcon, SparklesIcon } from "lucide-react"
import { useEveAgent, type EveDynamicToolPart } from "eve/react"
import { Client } from "eve/client"
import type {
  HandleMessageStreamEvent,
  InputResponse,
  SessionState,
} from "eve/client"

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
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { MessageAnimated } from "@/components/message-animated"
import { ToolPart } from "@/components/chat/tool-part"
import {
  collectToolCallRefs,
  useEntityLabels,
} from "@/lib/chat/use-entity-labels"
import { persistChatState } from "@/lib/chat/persist-chat-state"
import { queryKeys } from "@/lib/queries/keys"

/**
 * `end`, not the scroller's default `last-anchor`.
 *
 * A conversation restored from the persisted snapshot has to open on the
 * newest turn. With `last-anchor` a reloaded transcript lands on an old
 * question mid-scroll — which a browser pass caught — and, worse, leaves
 * autoscroll disengaged for everything that streams in afterwards.
 */
const RESTORED_SCROLL_POSITION = "end" as const

/**
 * This transcript sticks to the bottom; it does not pin each question to the
 * top of the viewport.
 *
 * The scroller's default is the familiar "your question stays at the top while
 * the reply reads downward" pattern, which it implements with a message anchor
 * plus a viewport-height spacer under the last message. Measured in the
 * browser, that combination put an **approval card entirely below the fold**
 * (card top 637, viewport ending at 454) behind a scroll-to-bottom button, and
 * scrolling to `end` then landed a full viewport *past* the last real content
 * because the spacer counts toward `scrollHeight`.
 *
 * A safety control the user has to go looking for is not a safety control, so
 * this pane opts out of both halves: no anchor, and `spacerClassName="h-0"`.
 * The pane is half a screen wide, where that dead space is expensive anyway.
 */
const PIN_QUESTIONS_TO_TOP = false

/**
 * The persisted snapshot, in the envelope shape `putChatStateSchema` defines.
 *
 * Deliberately loose. That schema is envelope-only on purpose — the interior
 * of an eve event belongs to a young runtime — so the one cast to eve's
 * concrete types happens here, in the component that actually knows what eve
 * expects, rather than in a Server Component that should not carry
 * agent-runtime knowledge.
 */
export type ChatSnapshot = {
  events: unknown[]
  session: Record<string, unknown> | null
}

export function ChatPane({ snapshot }: { snapshot: ChatSnapshot }) {
  const queryClient = useQueryClient()

  const [session] = React.useState(() =>
    new Client({ host: "", preserveCompletedSessions: true }).session(
      (snapshot.session as SessionState | null) ?? undefined
    )
  )

  const [initialEvents] = React.useState(
    () => snapshot.events as HandleMessageStreamEvent[]
  )

  const agent = useEveAgent({
    session,
    initialEvents,
    onFinish: (finished) => {
      void persistChatState({
        events: finished.events as unknown[],
        session: (finished.session ?? null) as unknown as Record<
          string,
          unknown
        > | null,
      })

      for (const key of [
        queryKeys.tasks.all,
        queryKeys.projects.all,
        queryKeys.statuses.all,
        queryKeys.priorities.all,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const messages = agent.data.messages
  const refs = React.useMemo(() => collectToolCallRefs(messages), [messages])
  const labels = useEntityLabels(refs)

  const isBusy = agent.status === "submitted" || agent.status === "streaming"

  const [draft, setDraft] = React.useState("")

  const respond = React.useCallback(
    (response: InputResponse) => {
      void agent.send({ inputResponses: [response] })
    },
    [agent]
  )

  /**
   * `live` is true only for the newest message, which is the only place a
   * still-pending request can be — see `ToolPart`'s own note for why that
   * matters after a reload.
   */
  const renderPartFor = React.useCallback(
    (live: boolean) => {
      // Named rather than an inline arrow: an anonymous function returning JSX
      // reads to eslint as a component definition without a display name.
      function renderToolPart(part: { type: string }, key: string) {
        return part.type === "dynamic-tool" ? (
          <ToolPart
            key={key}
            part={part as EveDynamicToolPart}
            labels={labels}
            onRespond={respond}
            disabled={isBusy}
            live={live}
          />
        ) : null
      }

      return renderToolPart
    },
    [labels, respond, isBusy]
  )

  const latestMessageId = messages.at(-1)?.id

  const submit = () => {
    const message = draft.trim()

    if (message === "" || isBusy) return

    setDraft("")
    void agent.send({ message })
  }

  return (
    <div
      data-testid="chat-conversation"
      className="flex min-h-0 flex-1 flex-col p-4"
    >
      <Card className="flex min-h-0 flex-1 flex-col gap-0">
        <CardHeader className="gap-1 border-b">
          <CardTitle>Agent</CardTitle>
          <CardDescription>
            Ask for a change here and watch it land on the left.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          {messages.length === 0 ? (
            <Empty data-testid="chat-empty" className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SparklesIcon />
                </EmptyMedia>
                <EmptyTitle>Start the conversation</EmptyTitle>
                <EmptyDescription>
                  Ask what is in progress, create a task, or move a few things
                  at once. Anything the list on the left can do, the agent can
                  do — and you will see every action it takes.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MessageScrollerProvider
              defaultScrollPosition={RESTORED_SCROLL_POSITION}
            >
              <MessageScroller>
                <MessageScrollerViewport
                  data-testid="chat-transcript"
                  className="px-4 py-4"
                >
                  <MessageScrollerContent
                    className="gap-6"
                    spacerClassName="h-0"
                  >
                    {messages.map((message) => (
                      <MessageAnimated
                        key={message.id}
                        message={message}
                        renderPart={renderPartFor(
                          message.id === latestMessageId
                        )}
                        scrollAnchor={PIN_QUESTIONS_TO_TOP}
                      />
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
        </CardContent>

        <CardFooter className="flex-col items-stretch gap-2 border-t pt-4">
          {agent.error ? (
            <div
              data-testid="chat-error"
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {agent.error.message}
            </div>
          ) : null}

          <form
            data-testid="chat-composer"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <InputGroup className="w-full">
              <InputGroupTextarea
                data-testid="chat-composer-input"
                aria-label="Message the agent"
                placeholder="Ask for a change…"
                rows={2}
                value={draft}
                disabled={isBusy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter starts a line. Nothing here
                  // blocks on a pending approval: eve durably queues unrelated
                  // follow-up text and replays it once the approval is
                  // answered, so refusing to send would be a restriction the
                  // framework does not need.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <InputGroupAddon align="block-end" className="pt-1">
                <InputGroupButton
                  data-testid="chat-send"
                  type="submit"
                  size="icon-sm"
                  variant="default"
                  className="ml-auto"
                  disabled={isBusy || draft.trim() === ""}
                  aria-label="Send"
                >
                  <SendHorizontalIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}

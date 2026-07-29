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
 * ## Cache hygiene, and live sync
 *
 * `onEvent` is Phase 6's "agent → UI" half (plan §5.1, US-G1). It fires once
 * per *completed successful mutating tool call*, mid-turn, and invalidates
 * only the families that call can have changed — `lib/chat/tool-invalidation.ts`
 * owns that mapping and explains why it keys off eve's real `action.result`
 * event rather than the `tool-result` the plan's prose names.
 *
 * It **replaces** the blanket four-family sweep `onFinish` used to run, and is
 * a strict refinement of it: every family the sweep touched is still
 * invalidated, per mutation rather than per turn, and *earlier*. So the
 * US-F5.2 label-resolver hygiene the sweep existed for is better served, not
 * merely preserved — a `create_project` mid-turn now refreshes labels before
 * the approval card for a later call in the same turn renders. Keeping both
 * would only manufacture the redundant refetching Phase 6's own fetch-storm
 * check exists to catch.
 *
 * One thing is genuinely lost: a dropped stream that the turn boundary would
 * previously have swept up anyway. `app/providers.tsx`'s refetch-on-focus plus
 * 30s poll is the documented backstop for exactly that (plan §5.3), and
 * `07-live-sync.test.ts` asserts it against a second browser session.
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
import { queryFamiliesForEvent } from "@/lib/chat/tool-invalidation"
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
    },

    /**
     * Observe-only, over the authoritative server stream — the store calls
     * this for confirmed events and never for its own optimistic client
     * projections, so an invalidation here can never race a write that has not
     * happened yet.
     */
    onEvent: (event) => {
      for (const family of queryFamiliesForEvent(event)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys[family].all })
      }
    },
  })

  const messages = agent.data.messages
  const refs = React.useMemo(() => collectToolCallRefs(messages), [messages])
  const labels = useEntityLabels(refs)

  /**
   * The newest message that can be carrying a *pending* request — the newest
   * message that is not the user's.
   *
   * Deliberately **not** `messages.at(-1)`. `useEveAgent` runs with
   * `optimistic: true` by default, so `agent.send({ message })` projects the
   * user's text into `agent.data.messages` immediately, before eve confirms
   * anything, and the last element stops being the assistant's.
   *
   * This only gates **questions** now — `ToolPart` explains why an approval
   * needs no position at all — but a question card should still not blink out
   * of existence between the click on Send and the server's answer.
   */
  const liveMessage = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index]
      if (candidate.role !== "user") return candidate
    }

    return undefined
  }, [messages])

  /**
   * Whether the transcript is waiting on an **approval** anywhere.
   *
   * Not on an `ask_question`, which arrives through the same protocol. eve
   * treats the two differently, and so does this pane: a follow-up sent while
   * an approval is pending is *held* until the approval is answered, whereas
   * one sent while a question is pending "clears that pending request before
   * the model continues" and starts the next turn. Typing past a question is a
   * supported, sensible move — "never mind, show me my tasks" — so the
   * composer stays open for it. Typing past an approval is not.
   *
   * Position-independent, matching `ToolPart`: answering an approval always
   * advances its part on the server, so one still reading `approval-requested`
   * is still parked, wherever it sits in the transcript.
   */
  const hasPendingApproval = messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "dynamic-tool" &&
        part.state === "approval-requested" &&
        part.toolMetadata?.eve?.inputRequest?.display === "confirmation"
    )
  )

  const isBusy = agent.status === "submitted" || agent.status === "streaming"

  /**
   * The composer is closed while an approval is pending.
   *
   * `agent.status` returns to `ready` on a turn parked at `session.waiting`
   * (the store calls `onFinish` from a `finally` block), so busy alone does not
   * cover this. eve would hold the follow-up rather than deny the tool call, so
   * nothing breaks without the lock — but the message buys the user nothing
   * either: it queues behind the very decision they are being asked to make,
   * unanswered, while a destructive call sits waiting. Closing the composer is
   * what keeps the safety control the only thing on the table.
   *
   * It cannot wedge: Approve and Deny stay enabled, and answering either one
   * projects `client.input.responded` locally, which resolves the part and
   * reopens the composer even if the request was stale.
   */
  const isBlocked = isBusy || hasPendingApproval

  const [draft, setDraft] = React.useState("")

  const respond = React.useCallback(
    (response: InputResponse) => {
      void agent.send({ inputResponses: [response] })
    },
    [agent]
  )

  /**
   * `live` is true only for `liveMessage`, the only place a still-pending
   * request can be — see `ToolPart`'s own note for why that matters after a
   * reload.
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

  const submit = () => {
    const message = draft.trim()

    if (message === "" || isBlocked) return

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
                          message.id === liveMessage?.id
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

          {hasPendingApproval ? (
            // Says why the composer is closed, and points at the one control
            // that reopens it. Muted and one line: the card above is the thing
            // to read, and this must not compete with it.
            <p
              data-testid="chat-blocked"
              className="px-1 text-xs text-muted-foreground"
            >
              Approve or deny the request above to keep going.
            </p>
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
                placeholder={
                  hasPendingApproval
                    ? "Approve or deny the request above to keep going…"
                    : "Ask for a change…"
                }
                rows={2}
                value={draft}
                disabled={isBlocked}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter starts a line. `submit` is the
                  // only send path, so the pending-request lock applies here
                  // too — a disabled textarea should never receive this, but
                  // the guard does not live in the DOM.
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
                  disabled={isBlocked || draft.trim() === ""}
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

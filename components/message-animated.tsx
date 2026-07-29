"use client"

/**
 * A chat-kit message row: text and reasoning parts, animated.
 *
 * It stays a generic shadcn-layer component — no `eve` import, nothing that
 * knows what a tool call is. Phase 5 needed it to render tool activity
 * interleaved with prose, and the way it gets that is `renderPart`, a render
 * prop: this file walks `message.parts` in **full original order** and hands
 * anything it does not recognise back to the caller. All the agent-runtime
 * knowledge lives in `components/chat/*`.
 *
 * The full-order walk matters beyond tidiness. `agent/instructions.md` asks
 * the model to state its plan and then call the gated tool in the same turn,
 * so prose and tool parts genuinely interleave — and US-F6.3 grades "one entry
 * per action, **in order**". The previous projection filtered to text and
 * silently discarded everything else, which would have rendered every action
 * after the prose, or not at all.
 */

import * as React from "react"
import { BrainIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

import type { MessageAnimationPreset } from "@/lib/message-animations"
import { MESSAGE_ANIMATIONS } from "@/lib/message-animations"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { MessageScrollerItem } from "@/components/ui/message-scroller"

type MessageAnimatedPart = {
  content?: unknown
  type: string
  text?: unknown
}

type MessageAnimatedMessage = {
  id: string
  role: string
  text?: string
  parts?: ReadonlyArray<MessageAnimatedPart>
}

/**
 * Renders a part this component does not understand. Returning nullish drops
 * the part, which is exactly what happened to every unknown part before.
 */
type MessageAnimatedPartRenderer = (
  part: MessageAnimatedPart,
  key: string
) => React.ReactNode

const MotionMessageScrollerItem = motion.create(MessageScrollerItem)

function MessageAnimated({
  message,
  animationPreset = MESSAGE_ANIMATIONS["slide-up"],
  assistantVariant = "ghost",
  renderPart,
  scrollAnchor,
  userVariant = "muted",
  ...props
}: Omit<
  React.ComponentProps<typeof MotionMessageScrollerItem>,
  "animate" | "children" | "exit" | "initial" | "messageId" | "variants"
> & {
  animationPreset?: MessageAnimationPreset
  assistantVariant?: React.ComponentProps<typeof Bubble>["variant"]
  message: MessageAnimatedMessage
  renderPart?: MessageAnimatedPartRenderer
  userVariant?: React.ComponentProps<typeof Bubble>["variant"]
}) {
  const shouldReduceMotion = useReducedMotion()
  const isUserMessage = message.role === "user"

  if (isUserMessage) {
    return (
      <MotionMessageScrollerItem
        messageId={message.id}
        scrollAnchor={scrollAnchor ?? true}
        variants={animationPreset.variants}
        initial={shouldReduceMotion ? false : "initial"}
        animate="animate"
        exit={shouldReduceMotion ? undefined : "exit"}
        {...props}
      >
        <MessageAnimatedRow
          message={message}
          assistantVariant={assistantVariant}
          renderPart={renderPart}
          userVariant={userVariant}
        />
      </MotionMessageScrollerItem>
    )
  }

  return (
    <MotionMessageScrollerItem
      messageId={message.id}
      scrollAnchor={scrollAnchor}
      initial={false}
      {...props}
    >
      <MessageAnimatedRow
        message={message}
        assistantVariant={assistantVariant}
        renderPart={renderPart}
        userVariant={userVariant}
      />
    </MotionMessageScrollerItem>
  )
}

function MessageAnimatedRow({
  message,
  assistantVariant,
  renderPart,
  userVariant,
}: {
  assistantVariant: React.ComponentProps<typeof Bubble>["variant"]
  message: MessageAnimatedMessage
  renderPart?: MessageAnimatedPartRenderer
  userVariant: React.ComponentProps<typeof Bubble>["variant"]
}) {
  const isUserMessage = message.role === "user"
  const parts = getMessageAnimatedContentParts(message)

  return (
    <Message align={isUserMessage ? "end" : "start"}>
      <MessageContent>
        {parts.map((part) => {
          if (part.kind === "other") {
            const rendered = renderPart?.(part.part, part.key)
            return rendered == null ? null : (
              <React.Fragment key={part.key}>{rendered}</React.Fragment>
            )
          }

          const paragraphs = part.text
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)

          if (part.kind === "reasoning") {
            return (
              <div
                key={part.key}
                className="w-full border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground"
              >
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <BrainIcon className="size-3.5" />
                  Reasoning
                </div>
                <div className="space-y-1.5 text-sm">
                  {paragraphs.map((paragraph, paragraphIndex) => (
                    <p
                      key={`${part.key}-${paragraphIndex}`}
                      className="whitespace-pre-wrap"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            )
          }

          return (
            <Bubble
              key={part.key}
              variant={isUserMessage ? userVariant : assistantVariant}
            >
              <BubbleContent className="space-y-2">
                {paragraphs.map((paragraph, paragraphIndex) => (
                  <p
                    key={`${part.key}-${paragraphIndex}`}
                    className="whitespace-pre-wrap"
                  >
                    {paragraph}
                  </p>
                ))}
              </BubbleContent>
            </Bubble>
          )
        })}
      </MessageContent>
    </Message>
  )
}

type MessageAnimatedContentPart =
  | { kind: "text" | "reasoning"; key: string; text: string }
  | { kind: "other"; key: string; part: MessageAnimatedPart }

/**
 * Every part, in the order the model produced them.
 *
 * A text-ish part whose text is missing is still dropped — there is nothing to
 * render — but an unrecognised *type* now travels to `renderPart` instead of
 * vanishing.
 */
function getMessageAnimatedContentParts(
  message: MessageAnimatedMessage
): MessageAnimatedContentPart[] {
  if (message.parts) {
    return message.parts.flatMap(
      (part, index): MessageAnimatedContentPart[] => {
        const key = `${message.id}-${index}`

        const kind =
          part.type === "reasoning" || part.type === "thinking"
            ? "reasoning"
            : part.type === "text"
              ? "text"
              : null

        if (!kind) return [{ kind: "other" as const, key, part }]

        const text =
          typeof part.text === "string"
            ? part.text
            : typeof part.content === "string"
              ? part.content
              : null

        return text === null ? [] : [{ kind, key, text }]
      }
    )
  }

  return typeof message.text === "string"
    ? [{ kind: "text" as const, key: `${message.id}-text`, text: message.text }]
    : []
}

export {
  MessageAnimated,
  type MessageAnimatedMessage,
  type MessageAnimatedPart,
  type MessageAnimatedPartRenderer,
}

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

          // A part that streamed in with no text of its own renders nothing
          // rather than a labelled empty box.
          if (paragraphs.length === 0) return null

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
                    <Prose
                      key={`${part.key}-${paragraphIndex}`}
                      text={paragraph}
                    />
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
                  <Prose
                    key={`${part.key}-${paragraphIndex}`}
                    text={paragraph}
                  />
                ))}
              </BubbleContent>
            </Bubble>
          )
        })}
      </MessageContent>
    </Message>
  )
}

/**
 * One paragraph of model prose.
 *
 * Models write light markdown whether or not you ask them to, and a browser
 * pass over the real agent showed `**Draft the launch plan**` reaching the
 * transcript with its asterisks intact. This renders the three constructs that
 * actually turn up — bullet lines, `**bold**`, and `` `code` `` — and nothing
 * else. It is deliberately not a markdown parser: §1.1 forbids adding one, and
 * a hand-rolled parser that tried to be complete would be a far bigger
 * liability than a few unstyled characters. Anything it does not recognise
 * renders as the literal text the model wrote.
 */
function Prose({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: Array<
    { kind: "lines"; lines: string[] } | { kind: "bullets"; items: string[] }
  > = []

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const last = blocks.at(-1)

    if (bullet) {
      if (last?.kind === "bullets") last.items.push(bullet[1] ?? "")
      else blocks.push({ kind: "bullets", items: [bullet[1] ?? ""] })
      continue
    }

    if (last?.kind === "lines") last.lines.push(line)
    else blocks.push({ kind: "lines", lines: [line] })
  }

  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "bullets" ? (
          <ul key={index} className="list-disc space-y-0.5 pl-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inline text={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-wrap">
            <Inline text={block.lines.join("\n")} />
          </p>
        )
      )}
    </>
  )
}

function Inline({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)

  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          return <strong key={index}>{token.slice(2, -2)}</strong>
        }

        if (token.startsWith("`") && token.endsWith("`") && token.length > 1) {
          return (
            <code
              key={index}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125em]"
            >
              {token.slice(1, -1)}
            </code>
          )
        }

        return <React.Fragment key={index}>{token}</React.Fragment>
      })}
    </>
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

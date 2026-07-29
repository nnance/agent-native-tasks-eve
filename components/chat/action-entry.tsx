"use client"

/**
 * One tool call, as a compact activity row.
 *
 * Product spec §6 asks for "structured activity in chat … not buried in
 * prose", and US-F6.1 says *each action*, not each write — so read calls get a
 * row too, in the quietest treatment. Showing the reads is also what makes the
 * grounding behaviour US-F2 requires visible evidence rather than a claim: the
 * user can see the agent looked before it answered.
 *
 * The visual register is deliberately the opposite of the approval card's.
 * Entries are a running record: a hairline rail, a small state glyph, one
 * line of sentence-case text, and the real tool name in the same
 * uppercase-mono "machine record" face the card uses. That face is the one
 * device tying the two together, and it encodes something true — which tool
 * actually ran — rather than decorating.
 *
 * The `data-*` attributes are the E2E contract (`data-tool`, `data-state`,
 * `data-outcome`), so the suite can assert precisely without minting a testid
 * per tool. They are attributes only; nothing here reads them.
 */

import { BanIcon, CheckIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"
import {
  describeToolCall,
  readToolOutcome,
  type EntityLabels,
} from "@/lib/chat/describe-tool-call"
import type { EveDynamicToolPart } from "eve/react"

type Outcome = "pending" | "ok" | "failed" | "denied"

function outcomeOf(part: EveDynamicToolPart): Outcome {
  if (part.state === "output-denied") return "denied"
  if (part.state === "output-error") return "failed"

  if (part.state === "output-available") {
    return readToolOutcome(part.output).kind === "failed" ? "failed" : "ok"
  }

  return "pending"
}

export function ActionEntry({
  part,
  labels,
}: {
  part: EveDynamicToolPart
  labels: EntityLabels
}) {
  const summary = describeToolCall(part.toolName, part.input, labels)
  const outcome = outcomeOf(part)

  const { text, tone } = describeRow(part, summary, outcome)

  return (
    <div
      data-testid="action-entry"
      data-tool={part.toolName}
      data-state={part.state}
      data-outcome={outcome}
      className={cn(
        "group/action-entry flex min-w-0 gap-2.5 border-l-2 py-1.5 pl-3 text-sm",
        outcome === "failed"
          ? "border-destructive/40"
          : outcome === "denied"
            ? "border-muted-foreground/40"
            : summary.severity === "read"
              ? "border-border"
              : "border-primary/40"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center",
          tone
        )}
      >
        {glyphFor(outcome, summary.severity)}
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn("wrap-break-word", tone)}>{text}</p>

        {summary.changes.length > 0 && outcome !== "failed" ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.changes
              .map((change) => `${change.label} → ${change.value}`)
              .join(" · ")}
          </p>
        ) : null}

        <details data-testid="action-entry-details" className="mt-1">
          <summary className="cursor-pointer list-none font-mono text-[0.625rem] tracking-widest text-muted-foreground uppercase select-none hover:text-foreground">
            {part.toolName}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {safeJson({
              input: part.input,
              output:
                part.state === "output-available" ? part.output : undefined,
              errorText:
                part.state === "output-error" ? part.errorText : undefined,
            })}
          </pre>
        </details>
      </div>
    </div>
  )
}

function glyphFor(
  outcome: Outcome,
  severity: ReturnType<typeof describeToolCall>["severity"]
) {
  if (outcome === "pending") return <Spinner className="size-3.5" />
  if (outcome === "failed") return <TriangleAlertIcon className="size-3.5" />
  if (outcome === "denied") return <BanIcon className="size-3.5" />
  if (severity === "read") return <SearchIcon className="size-3.5" />
  return <CheckIcon className="size-3.5" />
}

/**
 * The row's sentence and its colour, from the part's state.
 *
 * A failed call prints the server's `message` **verbatim** — product spec §9
 * and US-F3.4 make the `RuleViolation` wording a product deliverable, and the
 * chat pane relays it for the same reason `components/shared/query-state.tsx`
 * does on the left.
 */
function describeRow(
  part: EveDynamicToolPart,
  summary: ReturnType<typeof describeToolCall>,
  outcome: Outcome
): { text: string; tone: string } {
  if (part.state === "approval-responded") {
    return { text: "Waiting on the agent", tone: "text-muted-foreground" }
  }

  if (outcome === "pending") {
    return { text: summary.headline, tone: "text-muted-foreground" }
  }

  if (part.state === "output-denied") {
    return { text: "You denied this.", tone: "text-muted-foreground" }
  }

  if (part.state === "output-error") {
    return {
      text: part.errorText || "The tool failed with no message.",
      tone: "text-destructive",
    }
  }

  if (part.state === "output-available") {
    const result = readToolOutcome(part.output)

    if (result.kind === "failed") {
      return { text: result.message, tone: "text-destructive" }
    }

    const detail =
      result.kind === "ok" && result.detail && summary.count === 0
        ? ` — ${result.detail}`
        : ""

    return {
      text: `${summary.pastHeadline}${detail}`,
      tone: summary.severity === "read" ? "text-muted-foreground" : "",
    }
  }

  return { text: summary.headline, tone: "text-muted-foreground" }
}

/** Never let an unserialisable payload take the transcript down with it. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined"
  } catch {
    return "(not serializable)"
  }
}

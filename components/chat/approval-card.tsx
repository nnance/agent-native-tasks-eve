"use client"

/**
 * The safety UX: what the user actually signs off on.
 *
 * This is the one place in Phase 5 where boldness is spent, because it is the
 * one place where getting it wrong is dangerous. EVE's own approval request is
 * boilerplate — `extractApprovalRequests` builds every tool approval as
 * `prompt: "Approve tool call: <toolName>"` with options `Yes` / `No` — so a
 * card that rendered `request.prompt` would read *"Approve tool call:
 * bulk_delete_tasks — Yes / No"* and fail US-F5.2 outright. The prompt is
 * therefore **suppressed** for `display: "confirmation"`, and the card states
 * the case itself from `part.toolName` and `part.input`, with ids resolved to
 * names by `useEntityLabels`.
 *
 * `ask_question` arrives through the same protocol with `display: "text"` or
 * `"select"`, where `prompt` *is* the model's real question — so that one is
 * rendered verbatim and prominently. One component, two shapes, distinguished
 * by data rather than by type.
 *
 * The design is **a manifest, not an alert**: a work order the agent has
 * filled out and handed over for a signature. Every rule below is
 * load-bearing:
 *
 * 1. The count is in the headline ("Delete 3 tasks"), because US-F5.2 asks how
 *    many.
 * 2. Every target is enumerated by name, one per line — not "3 tasks
 *    selected". Beyond twelve the tail folds into a disclosure, but the
 *    headline count is always the true total.
 * 3. The confirm button says the verb ("Delete 3 tasks"), not "Approve". A
 *    control names exactly what happens when it is used, and eve's own labels
 *    are "Yes" / "No" — the weakest possible copy next to a permanent delete.
 *    The `approval-approve` testid is unchanged; plan §2.7 fixes testids, not
 *    labels.
 * 4. Option ids come from `request.options[].id`, never hardcoded, because
 *    `ask_question` can carry arbitrary options and free text.
 * 5. Severity keys the accent, so a bulk status change does not cry wolf in
 *    the same red a delete uses. Crying wolf everywhere is how the signal that
 *    matters gets ignored.
 * 6. An unresolved id renders as a short id in muted mono with the full id in
 *    `title` — it never masquerades as a name.
 * 7. Deny is not a dismissal: equal weight, equal size, to the left of confirm.
 */

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  describeToolCall,
  type EntityLabels,
  type ToolSeverity,
} from "@/lib/chat/describe-tool-call"
import type { EveDynamicToolPart, EveMessageInputRequest } from "eve/react"
import type { InputResponse } from "eve/client"

/** Beyond this the list folds; the headline count stays the true total. */
const VISIBLE_TARGETS = 12

const SEVERITY_STYLES: Record<
  ToolSeverity,
  { rail: string; label: string; confirm: "destructive" | "default" }
> = {
  destructive: {
    rail: "bg-destructive",
    label: "text-destructive",
    confirm: "destructive",
  },
  write: { rail: "bg-primary", label: "text-primary", confirm: "default" },
  read: {
    rail: "bg-muted-foreground",
    label: "text-muted-foreground",
    confirm: "default",
  },
  question: {
    rail: "bg-foreground/60",
    label: "text-foreground",
    confirm: "default",
  },
}

export function ApprovalCard({
  part,
  request,
  labels,
  onRespond,
  disabled,
}: {
  part: EveDynamicToolPart
  request: EveMessageInputRequest
  labels: EntityLabels
  onRespond: (response: InputResponse) => void
  disabled: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  const [freeform, setFreeform] = React.useState("")

  const summary = describeToolCall(part.toolName, part.input, labels)
  const isQuestion = request.display !== "confirmation"
  const severity = isQuestion ? "question" : summary.severity
  const style = SEVERITY_STYLES[severity]

  const options = request.options ?? []
  const approve = options.find((option) => option.id === "approve")
  const deny = options.find((option) => option.id === "deny")
  const others = options.filter(
    (option) => option.id !== "approve" && option.id !== "deny"
  )

  const respond = (optionId: string) => {
    onRespond({ requestId: request.requestId, optionId })
  }

  const visible = summary.targets.slice(0, VISIBLE_TARGETS)
  const overflow = summary.targets.slice(VISIBLE_TARGETS)

  return (
    <motion.section
      data-testid="approval-card"
      data-tool={part.toolName}
      data-severity={severity}
      data-count={summary.count}
      aria-label={isQuestion ? "The agent has a question" : "Approval needed"}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-card pl-1 shadow-sm"
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", style.rail)}
      />

      <div className="flex flex-col gap-4 px-4 py-3.5">
        <header className="flex items-start justify-between gap-3">
          <h3 className="text-sm leading-snug font-semibold text-balance">
            {isQuestion ? request.prompt : summary.headline}
          </h3>
          <span
            className={cn(
              "shrink-0 pt-0.5 font-mono text-[0.625rem] tracking-widest uppercase",
              style.label
            )}
          >
            Needs you
          </span>
        </header>

        {summary.targets.length > 0 ? (
          <TargetManifest targets={visible} overflow={overflow} />
        ) : null}

        {summary.changes.length > 0 && !isQuestion ? (
          <section>
            <h4 className="mb-1.5 font-mono text-[0.625rem] tracking-widest text-muted-foreground uppercase">
              Change
            </h4>
            <ul className="space-y-0.5 text-sm">
              {summary.changes.map((change) => (
                <li key={change.label} className="flex gap-2">
                  <span className="text-muted-foreground">{change.label}</span>
                  <span aria-hidden className="text-muted-foreground">
                    →
                  </span>
                  <span className="min-w-0 wrap-break-word">
                    {change.value}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* The machine record: the tool that will actually run, in the same
            uppercase-mono face the action entries use, plus the one sentence
            of consequence that matters. */}
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="font-mono text-[0.625rem] tracking-widest uppercase">
            {part.toolName}
          </span>
          {summary.consequence && !isQuestion ? (
            <span className={style.label}>{summary.consequence}</span>
          ) : null}
        </p>

        {request.allowFreeform ? (
          <div className="flex flex-col gap-2">
            <Textarea
              data-testid="approval-freeform"
              aria-label="Your answer"
              rows={2}
              value={freeform}
              disabled={disabled}
              onChange={(event) => setFreeform(event.target.value)}
              placeholder="Answer in your own words"
            />
            <Button
              data-testid="approval-freeform-submit"
              type="button"
              size="sm"
              variant="secondary"
              className="self-end"
              disabled={disabled || freeform.trim() === ""}
              onClick={() =>
                onRespond({
                  requestId: request.requestId,
                  text: freeform.trim(),
                })
              }
            >
              Send answer
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {others.map((option) => (
            <Button
              key={option.id}
              data-testid={`approval-option-${option.id}`}
              type="button"
              size="sm"
              variant={option.style === "danger" ? "destructive" : "secondary"}
              disabled={disabled}
              onClick={() => respond(option.id)}
            >
              {option.label}
            </Button>
          ))}

          {deny ? (
            <Button
              data-testid="approval-deny"
              type="button"
              size="sm"
              variant="ghost"
              className="border border-border"
              disabled={disabled}
              onClick={() => respond(deny.id)}
            >
              Deny
            </Button>
          ) : null}

          {approve ? (
            <Button
              data-testid="approval-approve"
              type="button"
              size="sm"
              variant={style.confirm}
              disabled={disabled}
              onClick={() => respond(approve.id)}
            >
              {summary.headline}
            </Button>
          ) : null}
        </div>
      </div>
    </motion.section>
  )
}

/** "TASKS" / "PROJECT" — the manifest's column head, never a generic "Items". */
const KIND_PLURAL: Record<string, string> = {
  task: "tasks",
  project: "projects",
  status: "statuses",
  priority: "priorities",
}

function TargetManifest({
  targets,
  overflow,
}: {
  targets: ReturnType<typeof describeToolCall>["targets"]
  overflow: ReturnType<typeof describeToolCall>["targets"]
}) {
  const total = targets.length + overflow.length
  const kind = targets[0]?.kind ?? overflow[0]?.kind ?? "item"

  return (
    <section>
      <h4 className="mb-1.5 font-mono text-[0.625rem] tracking-widest text-muted-foreground uppercase">
        {total === 1 ? kind : (KIND_PLURAL[kind] ?? `${kind}s`)}
      </h4>
      <ul className="space-y-0.5 text-sm">
        {targets.map((target) => (
          <TargetRow key={target.id} target={target} />
        ))}
      </ul>
      {overflow.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
            {overflow.length} more
          </summary>
          <ul className="mt-1 space-y-0.5 text-sm">
            {overflow.map((target) => (
              <TargetRow key={target.id} target={target} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

function TargetRow({
  target,
}: {
  target: ReturnType<typeof describeToolCall>["targets"][number]
}) {
  return (
    <li
      data-testid={`approval-target-${target.id}`}
      className={cn(
        "min-w-0 wrap-break-word",
        target.resolved ? "" : "font-mono text-xs text-muted-foreground"
      )}
      title={target.resolved ? undefined : target.id}
    >
      {target.label}
    </li>
  )
}

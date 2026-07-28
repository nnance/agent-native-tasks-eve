/**
 * The mechanical guard on Phase 4.
 *
 * The phase's central invariant is a table — implementation plan §2.4's tool
 * inventory and its approval column — plus one contract: a tool never
 * redefines a shape, it advertises the shared `lib/schemas` object itself.
 * Both are checkable, so neither is left to code review.
 *
 * Three things this file asserts that nothing else can:
 *
 * 1. **Only `.ts` modules live in `agent/tools/` and `agent/lib/`.** Those are
 *    "module-backed only" / "import-only" authored slots
 *    (eve/docs/reference/project-layout.md); a `.gitkeep` or a stray README
 *    breaks discovery and takes the dev server down with it. This is the
 *    automated form of a rule that is otherwise a comment in a phase brief.
 * 2. **`tool.inputSchema === <the object imported from lib/schemas>`.** Object
 *    identity, not structural equality, so "the tool restated the schema"
 *    cannot merge. `defineTool` is identity-preserving, which is what makes
 *    this possible.
 * 3. **The approval table, asserted by calling each policy.** `always()`
 *    returns a fresh closure per call, so identity comparison would prove
 *    nothing; invoking it and checking the status is the only honest form.
 */

import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

import { isDisabledToolSentinel, type ToolDefinition } from "eve/tools"
import type { ApprovalContext } from "eve/tools"

import * as schemas from "../../../lib/schemas/index.ts"

const toolsDir = fileURLToPath(
  new URL("../../../agent/tools/", import.meta.url)
)
const agentLibDir = fileURLToPath(
  new URL("../../../agent/lib/", import.meta.url)
)

/**
 * The §2.4 inventory, restated once so a missing tool and a stray tool both
 * fail. `schema` is the identity the tool must advertise; `gated` is the
 * approval column; `trimmed` is the `toModelOutput` column.
 */
const INVENTORY = [
  {
    name: "list_projects",
    schema: schemas.listProjectsSchema,
    gated: false,
    trimmed: true,
  },
  {
    name: "create_project",
    schema: schemas.createProjectSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "rename_project",
    schema: schemas.renameProjectSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "delete_project",
    schema: schemas.deleteProjectSchema,
    gated: true,
    trimmed: false,
  },
  {
    name: "list_tasks",
    schema: schemas.listTasksSchema,
    gated: false,
    trimmed: true,
  },
  {
    name: "get_task",
    schema: schemas.getTaskSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "create_task",
    schema: schemas.createTaskSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "update_task",
    schema: schemas.updateTaskSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "delete_task",
    schema: schemas.deleteTaskSchema,
    gated: true,
    trimmed: false,
  },
  {
    name: "bulk_update_tasks",
    schema: schemas.bulkUpdateTasksSchema,
    gated: true,
    trimmed: true,
  },
  {
    name: "bulk_delete_tasks",
    schema: schemas.bulkDeleteTasksSchema,
    gated: true,
    trimmed: true,
  },
  {
    name: "list_statuses",
    schema: schemas.listStatusesSchema,
    gated: false,
    trimmed: true,
  },
  {
    name: "create_status",
    schema: schemas.createStatusSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "update_status",
    schema: schemas.updateStatusSchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "delete_status",
    schema: schemas.deleteStatusSchema,
    gated: true,
    trimmed: false,
  },
  {
    name: "list_priorities",
    schema: schemas.listPrioritiesSchema,
    gated: false,
    trimmed: true,
  },
  {
    name: "create_priority",
    schema: schemas.createPrioritySchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "update_priority",
    schema: schemas.updatePrioritySchema,
    gated: false,
    trimmed: false,
  },
  {
    name: "delete_priority",
    schema: schemas.deletePrioritySchema,
    gated: true,
    trimmed: false,
  },
] as const

/** The framework built-ins this agent removes (see each file's own reason). */
const DISABLED = [
  "agent",
  "bash",
  "glob",
  "grep",
  "read_file",
  "todo",
  "web_fetch",
  "web_search",
  "write_file",
] as const

/** Every module under agent/tools/, keyed by the slug eve derives from it. */
const modules = new Map<string, unknown>(
  await Promise.all(
    readdirSync(toolsDir).map(
      async (entry) =>
        [
          entry.replace(/\.ts$/, ""),
          (await import(`${toolsDir}${entry}`)).default,
        ] as [string, unknown]
    )
  )
)

const authored = new Map(
  [...modules].filter(([, value]) => !isDisabledToolSentinel(value))
) as Map<string, ToolDefinition<unknown, unknown>>

const disabled = [...modules]
  .filter(([, value]) => isDisabledToolSentinel(value))
  .map(([slug]) => slug)

/**
 * Enough of an `ApprovalContext` to invoke a policy. The helpers only read
 * `approvedTools` and `toolName`; the rest of the session context is cast in
 * because building a real one would need a live runtime.
 */
function approvalContext(toolName: string): ApprovalContext<never> {
  return {
    approvedTools: new Set<string>(),
    callId: "conformance-call",
    toolName,
    session: {},
  } as unknown as ApprovalContext<never>
}

describe("agent/ authored slots", () => {
  it("contains only .ts modules in agent/tools/ and agent/lib/", () => {
    // eve's project layout calls both slots module-backed / import-only. A
    // .gitkeep here is not inert: discovery rejects it and `next dev` exits 1.
    for (const dir of [toolsDir, agentLibDir]) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        assert.ok(
          entry.isFile() && entry.name.endsWith(".ts"),
          `${dir}${entry.name} is not a .ts module.`
        )
      }
    }
  })
})

describe("the plan §2.4 tool inventory", () => {
  it("authors exactly the nineteen named tools, and no others", () => {
    assert.deepEqual(
      [...authored.keys()].sort(),
      INVENTORY.map((tool) => tool.name).sort()
    )
  })

  it("disables exactly the nine named framework tools", () => {
    assert.deepEqual([...disabled].sort(), [...DISABLED].sort())
  })

  for (const entry of INVENTORY) {
    describe(entry.name, () => {
      it("is a tool definition with a description and an executor", () => {
        const tool = authored.get(entry.name)

        assert.ok(tool, `${entry.name} was not discovered.`)
        assert.equal(typeof tool.description, "string")
        assert.ok(tool.description.length > 0)
        assert.equal(typeof tool.execute, "function")
      })

      it("advertises the shared schema object itself, not a copy", () => {
        // The parity contract of plan §2.1, as an identity check: the HTTP
        // route parses this exact object and the tool advertises it.
        assert.equal(authored.get(entry.name)?.inputSchema, entry.schema)
      })

      it(`approval is ${entry.gated ? "always()" : "never()"}`, async () => {
        const policy = authored.get(entry.name)?.approval

        assert.equal(
          typeof policy,
          "function",
          `${entry.name} must state its approval policy explicitly.`
        )

        assert.equal(
          await policy?.(approvalContext(entry.name)),
          entry.gated ? "user-approval" : "not-applicable"
        )
      })

      it(`${entry.trimmed ? "trims" : "does not trim"} its model output`, () => {
        assert.equal(
          typeof authored.get(entry.name)?.toModelOutput,
          entry.trimmed ? "function" : "undefined"
        )
      })
    })
  }
})

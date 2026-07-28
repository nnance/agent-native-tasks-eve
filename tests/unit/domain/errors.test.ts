import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"

/**
 * Phase 2 maps these to 409 and 404 by `instanceof`, never by matching message
 * text (implementation plan §2.1). That only holds if the two are genuinely
 * distinguishable, so the discrimination is asserted in both directions.
 */
describe("RuleViolation", () => {
  it("is an Error, and is not a NotFoundError", () => {
    const error = new RuleViolation("Project 'Design' still has 4 tasks")

    assert.ok(error instanceof Error)
    assert.ok(error instanceof RuleViolation)
    assert.ok(!(error instanceof NotFoundError))
  })

  it("carries its human-readable message and names itself", () => {
    const error = new RuleViolation("Project 'Design' still has 4 tasks")

    assert.strictEqual(error.message, "Project 'Design' still has 4 tasks")
    assert.strictEqual(error.name, "RuleViolation")
  })
})

describe("NotFoundError", () => {
  it("is an Error, and is not a RuleViolation", () => {
    const error = new NotFoundError("No project with id abc.")

    assert.ok(error instanceof Error)
    assert.ok(error instanceof NotFoundError)
    assert.ok(!(error instanceof RuleViolation))
  })

  it("carries its message and names itself", () => {
    const error = new NotFoundError("No project with id abc.")

    assert.strictEqual(error.message, "No project with id abc.")
    assert.strictEqual(error.name, "NotFoundError")
  })
})

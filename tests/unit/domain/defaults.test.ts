import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  SEED_PROJECT_NAME,
} from "../../../lib/domain/defaults.ts"

describe("default statuses", () => {
  // Product spec §4.1, US-A1.2
  it("is exactly To Do, In Progress, Done in that order", () => {
    assert.deepStrictEqual(
      DEFAULT_STATUSES.map((s) => s.name),
      ["To Do", "In Progress", "Done"]
    )
  })

  it("marks Done, and only Done, as completed", () => {
    const completed = DEFAULT_STATUSES.filter((s) => s.isCompleted)
    assert.deepStrictEqual(
      completed.map((s) => s.name),
      ["Done"]
    )
  })

  it("puts the first status, the one new tasks take, at index 0", () => {
    assert.strictEqual(DEFAULT_STATUSES[0]?.name, "To Do")
  })
})

describe("default priorities", () => {
  // Product spec §4.3, US-A1.3
  it("is exactly Low, Medium, High in that order", () => {
    assert.deepStrictEqual(
      DEFAULT_PRIORITIES.map((p) => p.name),
      ["Low", "Medium", "High"]
    )
  })

  it("designates exactly one default, and it is Medium", () => {
    const defaults = DEFAULT_PRIORITIES.filter((p) => p.isDefault)
    assert.deepStrictEqual(
      defaults.map((p) => p.name),
      ["Medium"]
    )
  })
})

describe("seed project", () => {
  // US-A1.1
  it("is named Personal", () => {
    assert.strictEqual(SEED_PROJECT_NAME, "Personal")
  })
})

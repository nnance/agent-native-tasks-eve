import { describe, expect, it } from "vitest"

import {
  DEFAULT_PRIORITIES,
  DEFAULT_STATUSES,
  SEED_PROJECT_NAME,
} from "./defaults"

describe("default statuses", () => {
  // Product spec §4.1, US-A1.2
  it("is exactly To Do, In Progress, Done in that order", () => {
    expect(DEFAULT_STATUSES.map((s) => s.name)).toEqual([
      "To Do",
      "In Progress",
      "Done",
    ])
  })

  it("marks Done, and only Done, as completed", () => {
    const completed = DEFAULT_STATUSES.filter((s) => s.isCompleted)
    expect(completed.map((s) => s.name)).toEqual(["Done"])
  })

  it("puts the first status, the one new tasks take, at index 0", () => {
    expect(DEFAULT_STATUSES[0]?.name).toBe("To Do")
  })
})

describe("default priorities", () => {
  // Product spec §4.3, US-A1.3
  it("is exactly Low, Medium, High in that order", () => {
    expect(DEFAULT_PRIORITIES.map((p) => p.name)).toEqual([
      "Low",
      "Medium",
      "High",
    ])
  })

  it("designates exactly one default, and it is Medium", () => {
    const defaults = DEFAULT_PRIORITIES.filter((p) => p.isDefault)
    expect(defaults.map((p) => p.name)).toEqual(["Medium"])
  })
})

describe("seed project", () => {
  // US-A1.1
  it("is named Personal", () => {
    expect(SEED_PROJECT_NAME).toBe("Personal")
  })
})

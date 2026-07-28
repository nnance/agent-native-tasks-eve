import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { reindexAfterMove, renumber } from "../../../lib/domain/reorder.ts"

// Named a/b/c so the (order, id) tie-break is legible in the assertions.
const list = [
  { id: "a", order: 0 },
  { id: "b", order: 1 },
  { id: "c", order: 2 },
  { id: "d", order: 3 },
]

const ids = (assignments: { id: string; order: number }[]) =>
  assignments.map((a) => a.id)

const orders = (assignments: { id: string; order: number }[]) =>
  assignments.map((a) => a.order)

describe("renumber", () => {
  it("collapses gaps to a dense 0..n-1 sequence", () => {
    const result = renumber([
      { id: "a", order: 0 },
      { id: "b", order: 7 },
      { id: "c", order: 40 },
    ])

    assert.deepStrictEqual(ids(result), ["a", "b", "c"])
    assert.deepStrictEqual(orders(result), [0, 1, 2])
  })

  it("sorts by stored order, not by input position", () => {
    const result = renumber([
      { id: "c", order: 2 },
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ])

    assert.deepStrictEqual(ids(result), ["a", "b", "c"])
  })

  it("breaks ties on id so duplicate orders still resolve deterministically", () => {
    const result = renumber([
      { id: "z", order: 1 },
      { id: "a", order: 1 },
    ])

    assert.deepStrictEqual(ids(result), ["a", "z"])
    assert.deepStrictEqual(orders(result), [0, 1])
  })

  it("handles the empty and single-element cases", () => {
    assert.deepStrictEqual(renumber([]), [])
    assert.deepStrictEqual(renumber([{ id: "a", order: 9 }]), [
      { id: "a", order: 0 },
    ])
  })
})

describe("reindexAfterMove", () => {
  // US-D1.2 / US-E1.2: the defined order is respected everywhere, so a move
  // must leave a dense sequence with no gaps and no duplicates.
  it("moves an item to the front", () => {
    const result = reindexAfterMove(list, "c", 0)

    assert.deepStrictEqual(ids(result), ["c", "a", "b", "d"])
    assert.deepStrictEqual(orders(result), [0, 1, 2, 3])
  })

  it("moves an item to the middle", () => {
    const result = reindexAfterMove(list, "a", 2)

    assert.deepStrictEqual(ids(result), ["b", "c", "a", "d"])
    assert.deepStrictEqual(orders(result), [0, 1, 2, 3])
  })

  it("moves an item to the end", () => {
    const result = reindexAfterMove(list, "a", 3)

    assert.deepStrictEqual(ids(result), ["b", "c", "d", "a"])
  })

  it("clamps a target above the range to the last position", () => {
    assert.deepStrictEqual(ids(reindexAfterMove(list, "a", 99)), [
      "b",
      "c",
      "d",
      "a",
    ])
  })

  it("clamps a negative target to the first position", () => {
    assert.deepStrictEqual(ids(reindexAfterMove(list, "d", -5)), [
      "d",
      "a",
      "b",
      "c",
    ])
  })

  it("leaves the order untouched when the item is already in place", () => {
    const result = reindexAfterMove(list, "b", 1)

    assert.deepStrictEqual(ids(result), ["a", "b", "c", "d"])
    assert.deepStrictEqual(orders(result), [0, 1, 2, 3])
  })

  it("collapses gaps in the input while moving", () => {
    const sparse = [
      { id: "a", order: 5 },
      { id: "b", order: 10 },
      { id: "c", order: 30 },
    ]

    const result = reindexAfterMove(sparse, "c", 0)

    assert.deepStrictEqual(ids(result), ["c", "a", "b"])
    assert.deepStrictEqual(orders(result), [0, 1, 2])
  })

  it("handles a single-element list", () => {
    assert.deepStrictEqual(reindexAfterMove([{ id: "a", order: 4 }], "a", 3), [
      { id: "a", order: 0 },
    ])
  })

  it("throws when the moved id is not among the siblings", () => {
    // A programmer error, not a RuleViolation: every caller has already loaded
    // the row and proven it exists.
    assert.throws(
      () => reindexAfterMove(list, "zzz", 0),
      /not among its siblings/
    )
  })
})

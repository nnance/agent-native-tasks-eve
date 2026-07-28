/**
 * Unit coverage for the transport helpers.
 *
 * No database, no server: this file proves the status vocabulary itself, so
 * tests/api/ can spend its (much slower) budget proving that real handlers
 * reach it. The rethrow case matters most — it is what keeps a genuine defect
 * from being flattened into a plausible 4xx.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { z } from "zod"

import { readJsonObject } from "../../../lib/api/request.ts"
import { BadRequest, errorResponse, respond } from "../../../lib/api/respond.ts"
import { NotFoundError, RuleViolation } from "../../../lib/domain/errors.ts"

/** Builds a Request with a raw (possibly invalid) JSON body. */
function requestWith(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
}

describe("errorResponse", () => {
  it("maps a ZodError to 400 with the issue list", async () => {
    let thrown: unknown

    try {
      z.strictObject({ name: z.string() }).parse({})
    } catch (error) {
      thrown = error
    }

    const response = errorResponse(thrown)
    const body = (await response.json()) as {
      error: string
      issues: unknown[]
    }

    assert.equal(response.status, 400)
    assert.equal(body.error, "Invalid request.")
    assert.ok(Array.isArray(body.issues))
    assert.ok(body.issues.length > 0)
  })

  it("maps a BadRequest to 400 with its message", async () => {
    const response = errorResponse(new BadRequest("Body must be JSON."))

    assert.equal(response.status, 400)
    assert.deepStrictEqual(await response.json(), {
      error: "Body must be JSON.",
    })
  })

  // Product spec §9 / US-F3.4: the action's own words reach the caller.
  it("maps a NotFoundError to 404, message verbatim", async () => {
    const message = "No project with id 123."
    const response = errorResponse(new NotFoundError(message))

    assert.equal(response.status, 404)
    assert.deepStrictEqual(await response.json(), { error: message })
  })

  it("maps a RuleViolation to 409, message verbatim", async () => {
    const message =
      "Project 'Design' still has 1 task. Delete or move those tasks first, " +
      "then delete the project."
    const response = errorResponse(new RuleViolation(message))

    assert.equal(response.status, 409)
    assert.deepStrictEqual(await response.json(), { error: message })
  })

  it("rethrows anything else, so a defect surfaces as a 500", () => {
    const bug = new TypeError("cannot read properties of undefined")

    assert.throws(() => errorResponse(bug), TypeError)
  })
})

describe("respond", () => {
  it("JSON-encodes the result at 200 by default", async () => {
    const response = await respond(async () => ({ id: "a", name: "Website" }))

    assert.equal(response.status, 200)
    assert.deepStrictEqual(await response.json(), { id: "a", name: "Website" })
  })

  it("honours an explicit status, which is how POST answers 201", async () => {
    const response = await respond(async () => ({ id: "a" }), { status: 201 })

    assert.equal(response.status, 201)
  })

  it("returns a bare array for a list result — no envelope", async () => {
    const response = await respond(async () => [{ id: "a" }, { id: "b" }])

    assert.deepStrictEqual(await response.json(), [{ id: "a" }, { id: "b" }])
  })

  it("maps an error thrown inside the callback", async () => {
    const response = await respond(async () => {
      throw new RuleViolation("blocked")
    })

    assert.equal(response.status, 409)
  })

  it("lets an unrecognised error escape", async () => {
    await assert.rejects(
      respond(async () => {
        throw new Error("boom")
      }),
      /boom/
    )
  })
})

describe("readJsonObject", () => {
  it("reads an object body through unchanged", async () => {
    const parsed = await readJsonObject(requestWith(`{"name":"Website"}`))

    assert.deepStrictEqual(parsed, { name: "Website" })
  })

  // An empty body becomes {} so the schema — not this helper — writes the
  // error message, and the caller learns which field is missing.
  it("treats an empty body as an empty object", async () => {
    assert.deepStrictEqual(await readJsonObject(requestWith("")), {})
    assert.deepStrictEqual(await readJsonObject(requestWith("   \n ")), {})
  })

  it("rejects malformed JSON as a BadRequest", async () => {
    await assert.rejects(readJsonObject(requestWith("{oops")), (error) => {
      assert.ok(error instanceof BadRequest)
      assert.equal(error.message, "Request body must be valid JSON.")
      return true
    })
  })

  it("rejects an array body", async () => {
    await assert.rejects(readJsonObject(requestWith("[1,2]")), (error) => {
      assert.ok(error instanceof BadRequest)
      assert.equal(error.message, "Request body must be a JSON object.")
      return true
    })
  })

  it("rejects scalar and null bodies", async () => {
    for (const body of ["42", `"hello"`, "true", "null"]) {
      await assert.rejects(readJsonObject(requestWith(body)), (error) => {
        assert.ok(error instanceof BadRequest)
        assert.equal(error.message, "Request body must be a JSON object.")
        return true
      })
    }
  })
})

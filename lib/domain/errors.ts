/**
 * The two failure kinds the shared action layer raises.
 *
 * Implementation plan §2.1 mandates `RuleViolation`: a product-spec §7 rule
 * blocked the operation, and the message is written for a human to read
 * directly — the UI surfaces it verbatim and the agent relays it to the user
 * (US-F3.4, product-spec §9 "clear errors"). Messages therefore always state
 * both what is blocking and what to do about it (§7.3).
 *
 * `NotFoundError` is its sibling for "no entity with that id". The plan names
 * only RuleViolation, but Phase 2 must answer 404 for a missing entity and 409
 * for a blocked rule, and Phase 4's tools phrase the two differently to the
 * model. Folding both into one class would force downstream layers to
 * string-match message text to tell them apart — exactly the downstream logic
 * this architecture exists to prevent. Both carry a message and nothing else:
 * no codes, no structured payload.
 */

export class RuleViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RuleViolation"
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotFoundError"
  }
}

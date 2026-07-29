/**
 * Shared defaults for every eval in this directory.
 *
 * Run with `pnpm eval` (see `scripts/eval.ts`, which is what keeps these off
 * the dev database), not with `eve eval` directly.
 */

import { defineEvalConfig } from "eve/evals"

export default defineEvalConfig({
  /**
   * The judge model for `t.judge.autoevals.*`.
   *
   * Defaults to the exact resolution `agent/agent.ts` already uses — the
   * repo's one model-selection convention — so evals introduce no new required
   * credential and no unverified model id. `EVE_EVAL_JUDGE_MODEL` is the one
   * opt-in override, for anyone who wants a cheaper dedicated judge.
   */
  judge: {
    model:
      process.env.EVE_EVAL_JUDGE_MODEL ??
      process.env.EVE_MODEL ??
      "anthropic/claude-sonnet-5",
  },

  /**
   * Below eve's default of 8. Every eval here drives a real agent against one
   * shared Postgres and one shared gateway budget; four is enough parallelism
   * to keep a full run short without making rate limits the flakiest thing in
   * the suite.
   *
   * Concurrency is why fixtures are uniquely named and every prompt is
   * project-scoped: there is no per-eval database reset, and there cannot be
   * one while siblings are still in flight. See `evals/support/fixtures.ts`.
   */
  maxConcurrency: 4,

  /**
   * No Braintrust reporter. It is not on the §1.1 dependency allow-list and no
   * key is provisioned; `.eve/evals/<timestamp>/` artifacts carry the full
   * event stream for anything a run needs explaining.
   */
})

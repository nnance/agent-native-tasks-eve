/**
 * `pnpm eval` — runs the EVE evals in `evals/` against the **test** database.
 *
 * Run as `node --env-file=.env.local --env-file-if-exists=.env.test
 * scripts/eval.ts [eve eval flags…]`, so both `DATABASE_URL` and
 * `DATABASE_URL_TEST` are visible to the guard below in one process. Every
 * argument is forwarded, so `pnpm eval -- --strict` and
 * `pnpm eval grounded-counts` both work.
 *
 * ## Why this wrapper exists at all
 *
 * `eve eval` boots its own local target and has no `--database-url` flag: the
 * agent under test reaches Postgres through `lib/actions` → `lib/db/client.ts`
 * exactly as the Next app does, from whatever `DATABASE_URL` it inherits. Left
 * alone, that is the **dev** database, and evals execute real, unreviewed
 * agent tool calls — creates, deletes, bulk operations. The project's "tests
 * never touch the dev database" rule (plan §4.3, §8 risk 11) applies verbatim
 * even though `evals/` sits outside `tests/`.
 *
 * So this does what `tests/e2e/harness/server.ts` and `tests/api/support/
 * server.ts` already do, in the same shape: resolve the test URL through the
 * one guard that exists (`resolveTestDbUrl()`, which throws when
 * `DATABASE_URL_TEST` is unset *or* equals `DATABASE_URL`), then override
 * `DATABASE_URL` in the **child's environment** — never on the command line,
 * where a credential would reach any process listing.
 *
 * It is deliberately not part of `pnpm test` or `pnpm test:all`: evals make
 * real, billable model calls, exactly like `verify:agent`, which was kept out
 * for the same reason.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"

import { describeDbUrl, resolveTestDbUrl } from "../lib/db/urls.ts"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const eveBin = fileURLToPath(
  new URL("../node_modules/eve/bin/eve.js", import.meta.url)
)
const resetScript = fileURLToPath(new URL("./reset.ts", import.meta.url))

/** Resolves to a spawned child's exit code, treating a signal kill as failure. */
function exitCodeOf(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once("error", () => resolve(1))
    child.once("exit", (code, signal) =>
      resolve(code ?? (signal === null ? 1 : 1))
    )
  })
}

async function run(
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<number> {
  return exitCodeOf(
    spawn(process.execPath, [...args], {
      cwd: repoRoot,
      env,
      stdio: "inherit",
    })
  )
}

try {
  // Nothing has run at this point: the guard comes before the reset, and the
  // reset comes before any model call.
  const testDbUrl = resolveTestDbUrl()

  // A skipped run must never look like a passing one (plan §4.3). Evals grade
  // real qualitative behaviour, so there is no mock model to fall back on.
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set. Evals call a real model through the " +
        "Vercel AI Gateway; a skipped run must not look like a pass."
    )
  }

  console.log(`Running evals against ${describeDbUrl(testDbUrl)} (test).`)

  // Reuse the one destructive routine rather than duplicating drop/migrate/
  // seed. `reset.ts` carries its own independent refusal-if-URLs-match guard,
  // so the destructive step is double-guarded, and a full reset guarantees a
  // known baseline (the seeded starter project) for every run.
  const reset = await run([resetScript, "--target=test"], process.env)

  if (reset !== 0) {
    throw new Error(`Resetting the test database failed with code ${reset}.`)
  }

  // `eve eval` runs discovered eval files concurrently, so there is no
  // per-eval reset — isolation is by uniquely-named, project-scoped fixtures.
  // See `evals/support/fixtures.ts`.
  process.exitCode = await run([eveBin, "eval", ...process.argv.slice(2)], {
    ...process.env,
    DATABASE_URL: testDbUrl,
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}

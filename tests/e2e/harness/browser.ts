/**
 * The `agent-browser` wrapper (implementation plan §4.2).
 *
 * One module spells every CLI invocation the suite makes, so if the CLI's
 * surface moves the blast radius is this file.
 *
 * Elements are addressed with **raw CSS** through `tid()` rather than with
 * `find testid … <action>`: the raw-CSS fallback works uniformly across
 * `click`/`fill`/`select`/`check`/`get`/`is`/`wait`, whereas `find` covers a
 * smaller verb set, and prefix selectors (`[data-testid^="task-row-"]`) make
 * row counting a one-liner. `find testid` stays the manual §3.1 resolution
 * check during the build.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

/** Selector for a testid. The suite never writes the attribute form inline. */
export const tid = (id: string) => `[data-testid="${id}"]`

/** Selector matching every testid with the given prefix, for counting. */
export const tidPrefix = (prefix: string) => `[data-testid^="${prefix}"]`

const CLI_TIMEOUT_MS = 60_000

type CliResult<T> = { success: boolean; data: T | null; error?: string }

export type Browser = ReturnType<typeof createBrowser>

/**
 * A non-zero exit rejects with the CLI's own stderr, so a missing element
 * fails the test with the CLI's message rather than a bare exit code.
 */
async function invoke(session: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(
      "pnpm",
      ["exec", "agent-browser", "--session", session, "--json", ...args],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }
    )
    return stdout
  } catch (error) {
    const shell = error as { stderr?: string; stdout?: string; message: string }
    const detail = (shell.stderr || shell.stdout || shell.message).trim()
    throw new Error(`agent-browser ${args.join(" ")} failed:\n${detail}`)
  }
}

export function createBrowser(session: string) {
  /**
   * Parses the CLI's JSON envelope. Several commands emit plain text even
   * under `--json`, so a parse failure raises an error carrying the raw
   * stdout rather than throwing an opaque SyntaxError from inside a test.
   */
  const json = async <T>(args: string[]): Promise<T> => {
    const stdout = await invoke(session, args)

    let parsed: CliResult<T>

    try {
      parsed = JSON.parse(stdout) as CliResult<T>
    } catch {
      throw new Error(
        `agent-browser ${args.join(" ")} returned non-JSON output:\n` +
          stdout.slice(0, 2000)
      )
    }

    if (parsed.success === false) {
      throw new Error(
        `agent-browser ${args.join(" ")} failed: ${parsed.error ?? "unknown"}`
      )
    }

    return parsed.data as T
  }

  const call = async (...args: string[]): Promise<void> => {
    await json<unknown>(args)
  }

  return {
    json,
    call,

    open: async (url: string) => {
      await call("open", "--enable", "react-devtools", url)
      await call("wait", "--load", "networkidle")
    },
    reload: async () => {
      await call("reload")
      await call("wait", "--load", "networkidle")
    },
    viewport: (width: number, height: number) =>
      call("set", "viewport", String(width), String(height)),

    click: (selector: string) => call("click", selector),
    fill: (selector: string, value: string) => call("fill", selector, value),
    select: (selector: string, value: string) =>
      call("select", selector, value),

    text: async (selector: string) =>
      (await json<{ text: string }>(["get", "text", selector])).text,
    value: async (selector: string) =>
      (await json<{ value: string }>(["get", "value", selector])).value,
    attr: async (selector: string, name: string) =>
      (await json<{ value: string }>(["get", "attr", selector, name])).value,
    count: async (selector: string) =>
      (await json<{ count: number }>(["get", "count", selector])).count,

    /**
     * `false` rather than a throw when the element is absent — "is this gone?"
     * is a question the suite asks constantly, and an exception is the wrong
     * answer to it.
     */
    visible: async (selector: string) => {
      try {
        const data = await json<{ visible: boolean }>([
          "is",
          "visible",
          selector,
        ])
        return data.visible === true
      } catch {
        return false
      }
    },

    waitFor: (selector: string) => call("wait", selector),
    waitText: (text: string) => call("wait", "--text", text),
    waitGone: (selector: string) =>
      call(
        "wait",
        "--fn",
        `!document.querySelector(${JSON.stringify(selector)})`
      ),

    errors: async () =>
      (await json<{ errors: { text: string }[] }>(["errors"])).errors,
    clearErrors: () => call("errors", "--clear"),
    console: async () =>
      (
        await json<{ messages: { type?: string; text?: string }[] }>([
          "console",
        ])
      ).messages,

    screenshot: (path: string) => call("screenshot", path),
    a11y: (tags: string) => json<unknown>(["a11y", "--tags", tags]),

    close: () => call("close"),
  }
}

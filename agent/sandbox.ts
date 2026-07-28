import { defaultBackend, defineSandbox } from "eve/sandbox"

/**
 * This agent never runs sandboxed code — it edits tasks through server
 * actions. The only reason this file exists is to stop `eve dev` from
 * writing packages into package.json behind our backs.
 *
 * eve's default backend chain auto-installs `microsandbox` (Apple Silicon) or
 * `just-bash` (elsewhere) as devDependencies on first sandbox resolution. It
 * did exactly that during Phase 0r, adding `microsandbox` to package.json
 * unbidden — which would break implementation plan §1.1's rule that no
 * dependency exists outside its allowed table. Turning autoInstall off keeps
 * the selection chain intact while making it read-only with respect to our
 * manifest; if a sandbox is ever genuinely needed, eve fails with an
 * actionable install error and the dependency gets added deliberately.
 */
export default defineSandbox({
  backend: defaultBackend({
    microsandbox: { setup: { autoInstall: false } },
    justBash: { autoInstall: false },
  }),
})

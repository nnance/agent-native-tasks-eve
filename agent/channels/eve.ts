import { localDev } from "eve/channels/auth"
import { eveChannel } from "eve/channels/eve"

// v1 is single-user and local-only — there is no deployment until Phase 7,
// so localDev() alone is the correct posture: it opens localhost requests
// for `eve dev`, the REPL, and the same-origin browser client, and every
// other caller gets a 401.
//
// PHASE 7: revisit before deploying. Add vercelOidc() so the eve TUI and
// Vercel deployments can reach the agent, plus a real browser auth provider
// in place of the scaffold's placeholderAuth() (or none() for a public demo).
export default eveChannel({ auth: [localDev()] })

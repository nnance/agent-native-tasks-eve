import { localDev, none, vercelOidc } from "eve/channels/auth"
import { eveChannel } from "eve/channels/eve"

// The auth walk is ordered; the first entry that recognises the caller wins,
// and any entry that does not returns null so the walk continues.
//
//   vercelOidc()  Vercel-to-Vercel and internal runtime callers (subagents,
//                 schedules, the eve TUI against a deployment). A plain
//                 browser session carries no OIDC bearer, so this does not by
//                 itself admit the deployed chat pane.
//   localDev()    loopback callers: `eve dev`, the REPL, local browser.
//   none()        explicit anonymous access — eve fails closed, so without
//                 this the deployed browser client gets
//                 "Authorization is required for this route".
//
// ⚠️  none() is only acceptable because **Vercel Deployment Protection is
// enabled on this project**, so Vercel authenticates the human before any
// request reaches the app. It is the platform gate, not this file, that keeps
// the agent private. Turning that protection off makes the agent — and every
// unauthenticated /api route alongside it — fully public to anyone with the
// URL, with write and delete access to the database.
//
// Before this is exposed to real users, replace none() with an actual
// authenticator (httpBasic(), jwtHmac(), oidc(), or a custom AuthFn mapping
// your app's session) AND add auth to the REST routes under app/api/, which
// have none today. See node_modules/eve/docs/guides/auth-and-route-protection.md.
export default eveChannel({ auth: [vercelOidc(), localDev(), none()] })

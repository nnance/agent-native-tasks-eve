import { networkInterfaces } from "node:os"

import type { NextConfig } from "next"
import { withEve } from "eve/next"

/**
 * Origins allowed to reach the dev server, beyond localhost.
 *
 * Next blocks cross-origin requests to dev-only assets, allowing only the host
 * the dev server was started with. Opening the app from another device — over
 * the LAN, or a VPN address — therefore serves the HTML but never initializes
 * the client runtime, so React does not hydrate. The symptom is easy to
 * misread: the task pane sits on "Loading…" and the composer will not send,
 * while every API route answers normally, because nothing client-side is
 * running to call them.
 *
 * Detected rather than hardcoded so no machine's address ends up in the repo,
 * and so a new DHCP lease does not silently reintroduce the same symptom.
 * `DEV_ORIGINS` (comma-separated, in the gitignored .env.local) covers what
 * detection cannot see: tunnel hostnames like ngrok, or a mDNS name.
 *
 * Development only — `allowedDevOrigins` has no effect on a production build.
 */
function devOrigins(): string[] {
  const detected = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface!.address)

  const configured = (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)

  return [...new Set([...detected, ...configured])]
}

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(),
}

// withEve boots the eve runtime alongside `next dev` and mounts the agent
// routes same-origin at /eve/v1/*, so the browser never crosses a CORS
// boundary. It discovers the agent from the ./agent directory by default.
export default withEve(nextConfig)

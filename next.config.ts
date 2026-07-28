import type { NextConfig } from "next"
import { withEve } from "eve/next"

const nextConfig: NextConfig = {}

// withEve boots the eve runtime alongside `next dev` and mounts the agent
// routes same-origin at /eve/v1/*, so the browser never crosses a CORS
// boundary. It discovers the agent from the ./agent directory by default.
export default withEve(nextConfig)

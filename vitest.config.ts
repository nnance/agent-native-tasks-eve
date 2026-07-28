import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Nested node_modules and eve's .eve/dev-runtime snapshots both contain
    // third-party test files, so these globs must match at any depth.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.eve/**",
      "**/drizzle/**",
    ],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
})

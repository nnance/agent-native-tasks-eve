import { defineAgent } from "eve"

export default defineAgent({
  // Overridable per environment without a code change; see .env.example.
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-5",
})

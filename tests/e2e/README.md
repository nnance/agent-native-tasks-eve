# End-to-end tests

Browser-driven tests written with `node:test` and driven by the pinned
`agent-browser` CLI (`pnpm exec agent-browser`), run with `pnpm test:e2e`.
They are deliberately serialised (`--test-concurrency=1`) because they share
one browser and one database.

This directory is empty on purpose at Phase 0r: the phase verifies that the
browser toolchain launches, but adds no product features to exercise. From
Phase 3 onward every phase writes its own E2E tests as part of the phase, and
the user-story → test coverage table required by implementation plan §4.6
lives in this file, with any declared gaps recorded at Phase 7.

| User story | Covering test | Status |
| --- | --- | --- |
| _(populated by Phases 3–7)_ | | |

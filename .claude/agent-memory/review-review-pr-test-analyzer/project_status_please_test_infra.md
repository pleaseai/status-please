---
name: project-status-please-test-infra
description: status-please monorepo test infrastructure boundaries — only packages/core is unit-tested
metadata:
  type: project
---

`packages/core` (bun:test, files matching `*.test.ts`) is the only unit-tested package in the
status-please monorepo. `apps/web` (Astro + React) has zero test infrastructure: no `*.test.*`
files, no test script in `apps/web/package.json`, no vitest/testing-library/astro test config.
Root `bun test` only picks up `packages/core`'s tests.

**Why:** confirmed by direct search (`find apps/web -iname "*test*"` → empty; no test script) while
reviewing the i18n PR (branch `amondnet/i18n`, commit 384f788).

**How to apply:** when reviewing diffs touching `apps/web/**`, don't flag missing unit tests for
Astro components/pages/middleware as a hard gap — there's no harness to write them in. Instead:
1. Check whether the changed logic is *pure* (no Astro/Cloudflare-runtime dependency) and could be
   extracted into `packages/core` where it would inherit the existing bun:test harness. This is a
   legitimate, actionable suggestion (e.g. `apps/web/src/middleware.ts`'s locale-negotiation
   precedence — cookie > Accept-Language > config default > English — is pure branching logic,
   handled by the shared `negotiateLocale()` helper in core).
   2. If it's genuinely framework glue (Astro props/response headers, JSX markup, `cloudflare:workers`
   env bindings), don't demand a test — note it as accepted risk instead.
   See [[feedback-tz-sensitive-date-tests]] for a related pitfall found in the same review.

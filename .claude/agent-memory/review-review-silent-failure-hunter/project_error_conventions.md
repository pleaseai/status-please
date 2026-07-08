---
name: project-error-conventions
description: status-please repo's actual error-handling/logging conventions (no Sentry/logError infra; console.error/warn is the house style)
metadata:
  type: project
---

This repo (chatbot-pf/status-please or amondnet fork, `apps/web` Astro+Cloudflare status page, `apps/worker` cron Worker, `packages/core` shared lib) has **no** `logError`/`logForDebugging`/`logEvent`/Sentry/`errorIds.ts` infrastructure — that convention from generic global guidance does not apply here.

The actual house style, established in `apps/worker/src/cache.ts` and `apps/worker/src/notify.ts`, is plain `console.warn`/`console.error` on every catch that swallows-and-continues, e.g.:
- `cache.ts:25` `console.warn('purgeStatusCache: CF_API_TOKEN/CF_ZONE_ID unset; skipping cache purge')`
- `cache.ts:54` `console.error('purgeStatusCache: purge threw', err)`
- `notify.ts:54` `console.error('notify: POST ... threw', err)`

**Why this matters for review:** any new catch block in this repo that swallows an error with *zero* `console.warn`/`console.error` call is a deviation from the repo's own established pattern, not just a generic best-practice nit — cite the sibling files above as precedent when flagging it.

**How to apply:** when auditing new try/catch in `apps/web` or `apps/worker`, check whether it logs via `console.error`/`console.warn` before ruling on severity. A silent (no-log) catch is a real, citable inconsistency here even though the "no Sentry infra" fact makes it lower severity than in a project with real observability tooling.

Related: [[i18n-feature-2026-07]] for the specific PR this was found in.

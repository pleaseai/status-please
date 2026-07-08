---
name: status-please-conventions
description: status-please repo's error-handling/logging conventions and known intentional fallback locations in badge.ts/data.ts
metadata:
  type: project
---

## Logging conventions in this repo

No `logError`/`logForDebugging`/`errorIds.ts` framework exists here (that's generic
boilerplate from the agent's system prompt, not this project). The only logging
convention actually in use is plain `console.error`/`console.warn`, and only in
`apps/worker/src/cache.ts` and `apps/worker/src/notify.ts` (both catch + log +
continue, e.g. cache purge failures, webhook notify failures). `apps/web` and
`packages/core` have zero logging calls anywhere as of the `amondnet/badge` branch.

**How to apply:** don't expect or demand Sentry-style error IDs in this repo.
When flagging a missing-log issue here, the fix is "add a `console.error` with
context," matching the worker package's existing style — not "wire up
logError(errorId)".

## Known intentional fail-open fallbacks (packages/core/src/badge.ts)

- `parseUptimePercent` (badge.ts:100) returns `1` (perfect/green) for any
  unparseable uptime display string. Comment explicitly says this is so a
  malformed KV snapshot degrades to green rather than throwing on the request
  path. No logging when this triggers.
- `overallBadge` (badge.ts:131, see `color: worst ? ... : 'brightgreen'` at
  badge.ts:146) reports `operational`/`brightgreen` for an **empty** site
  summary. Covered by an explicit test (`badge.test.ts`: "degrades to green
  for an empty summary") — this is deliberate, not an oversight.

Both are defensible as "never throw on the request path for a public badge
endpoint," but both fail in the direction of "claim everything is healthy"
for a status/uptime *monitoring* product, which is the wrong direction to
fail silently in if the fallback is ever actually hit (masks real outages
data-corruption would otherwise reveal). Worth re-raising in future reviews
of this area if new fallback paths are added — flag as a design tradeoff to
confirm with the author, not an outright bug, since it's test-documented intent.

## Structural note

New `/api/badge*.json.ts` and `/api/status*.json.ts` route handlers
(introduced on `amondnet/badge`) call `getSite`/`getSummary`
(`apps/web/src/lib/data.ts`) with no try/catch. The underlying
`kv.get()` + `JSON.parse(raw)` in `getSummary` (data.ts, pre-existing,
unchanged by that branch) has no error handling either — a corrupt KV
snapshot would throw all the way up through these new routes uncaught. Not
flagged as a diff-scope bug the first time since `getSummary` itself was
unchanged, but worth watching if `data.ts` internals get touched again.

---
name: statuspage-webhook-ingest-2026-07
description: Review findings for amondnet/statuspage-webhook branch (apps/worker/src/webhook.ts, ingest.ts, packages/core/src/statuspage-webhook.ts) — logging gap in webhook reject paths, fallback chains confirmed sound
metadata:
  type: project
---

Reviewed the Statuspage webhook-ingest feature (branch `amondnet/statuspage-webhook`,
repo pleaseai/statusbeam) on 2026-07-08 for silent failures. One real finding, two
confirmed-safe items worth remembering for future reviews of this area.

**Finding — `apps/worker/src/webhook.ts` reject paths (400 JSON-parse catch, 401
auth failure, 404 unknown site) return correct HTTP statuses but log nothing
server-side.** This breaks with the established house convention in
`apps/worker/src/notify.ts` and `apps/worker/src/cache.ts`, both of which
`console.error`/`console.warn` on every caught-and-continued failure (see
[[project_error_conventions]] — plain console logging is this repo's only
observability, no Sentry/logError infra). Confidence 55, minor/moderate severity:
the HTTP caller isn't left in the dark (distinct status codes), but an operator
running `wrangler tail` has zero visibility into brute-force 401 attempts,
Statuspage payload-shape changes, or misregistered webhook URLs (wrong slug).
Recommended fix: add a one-line console.warn/error in each reject branch,
matching notify.ts/cache.ts style.

**Confirmed safe — `writeSummary` fallback chain `r?.status ?? prior?.status ??
'down'` in `apps/worker/src/ingest.ts`.** This is an *improvement* over the
pre-diff `index.ts` (which had only `r?.status ?? 'down'`, harmless there because
cron always covered every site). The webhook path introduced partial-batch
ingest (one site at a time), and the added `prior?.status` fallback correctly
prevents untouched sites from being reset to 'down' on every webhook-triggered
summary rewrite. Well-documented, well-designed — no action needed if this
pattern reappears elsewhere in the codebase.

**Confirmed safe — first-ever webhook with no prior KV summary skips
notification/cache-purge for that slug.** The `changed` filter in
`apps/worker/src/ingest.ts` requires `previous.get(slug) !== undefined`, which is
byte-for-byte the same filter that existed pre-diff in `index.ts`. Not a
regression introduced by this branch — cron remains the backstop that will
correct it on the next tick. Don't re-flag this as new unless the filter logic
itself changes.

**Pattern confirmed for this codebase's Statuspage adapter:** unknown
status/indicator strings always map to `'degraded'`, never `'up'` — this is
intentional and consistent across both the polling adapter
(`packages/core/src/check.ts::deriveStatuspageStatus`) and the new webhook
mapper (`packages/core/src/statuspage-webhook.ts::deriveStatuspageWebhookStatus`).
Well tested in `packages/core/src/statuspage-webhook.test.ts`. Do not flag this
as a masking fallback in future reviews — it's the established, deliberate safe
default for this adapter.

---
name: statusbeam-queue-notify-comments
description: Doc-comment accuracy findings for the Cloudflare Queues notification path added in issue #42 (notify.ts, wrangler.jsonc) — useful if this branch/PR is re-reviewed or the pattern recurs elsewhere.
metadata:
  type: project
---

Reviewed `git diff origin/main...HEAD` on `amondnet/42` (Cloudflare Queues opt-in
notification delivery). Two real findings, otherwise the diff's extensive new
JSDoc was accurate and cross-checked cleanly against `notify.test.ts`.

1. **apps/worker/wrangler.jsonc:47-48** (Important, confidence 78) — comment
   says "The `scheduled` producer then enqueues..." but `notify()` (where
   enqueueing happens) is reached via `ingest()`, which is called from BOTH
   `index.ts`'s `scheduled` handler AND the webhook `fetch` handler
   (`webhook.ts:116` → `handleStatuspageWebhook` → `ingest`). The comment
   undersells that inbound Statuspage subscriber webhooks also enqueue to
   NOTIFY_QUEUE, not just the 5-min cron tick. Same prose does NOT appear in
   `packages/create-statusbeam/templates/wrangler.worker.jsonc` (that one is
   trigger-agnostic and correct) — only the main worker's own wrangler.jsonc
   has this specific overclaim.

2. **apps/worker/src/notify.ts:72** (Minor, confidence 45) — `dispatchNotifications`'s
   doc says "(called from `ctx.waitUntil`)", stale from before this diff when
   that was literally true. Now `ingest.ts:68` calls
   `ctx.waitUntil(notify(env, ...))` and `notify()` calls `dispatchNotifications`
   internally as its fallback branch — one level removed, and also called
   directly in tests with no waitUntil at all.

**Why this matters for future reviews**: this repo (chatbot-pf/pleaseai OSS,
`statusbeam`) has a strong convention of rich, precise doc-comments (see
`notify.ts`, `env.ts`, `wrangler.jsonc`) that reference concrete call sites and
entrypoints (e.g. "called from ctx.waitUntil", "the scheduled producer").
That precision is a strength but also the exact failure mode to check first
when a refactor moves a call up/down a call chain — the comment tends to keep
naming the *old* direct caller instead of being updated or genericized.

**How to apply**: When reviewing future diffs in this repo that touch
`notify.ts`, `index.ts`, `ingest.ts`, or `webhook.ts`, explicitly trace which
functions call `ingest()`/`notify()` before trusting any comment that names a
specific trigger (`scheduled`, `fetch`, cron) as "the" producer/caller — this
codebase has multiple entrypoints funneling into the same pipeline
(`index.ts:9` documents this pattern: "Two triggers feed the same `ingest`
pipeline").

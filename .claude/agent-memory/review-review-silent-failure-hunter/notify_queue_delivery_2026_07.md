---
name: notify-queue-delivery-2026-07
description: amondnet/42 (Cloudflare Queues notification delivery) findings — unguarded NOTIFY_QUEUE.sendBatch enqueue path, ack/retry conflation edge case in the queue consumer
metadata:
  type: project
---

Branch `amondnet/42` (issue #42) adds an opt-in Cloudflare Queues delivery path for
notifications in `apps/worker/src/notify.ts`. Two dispatch modes: inline
(`dispatchNotifications`/`postJson`, intentionally swallows + logs, never throws —
by design so one bad target can't wedge a cron run) and queue
(`consumeNotificationBatch`, must throw/retry so Queues re-delivers and
eventually dead-letters — `deliverNotification` throws on non-2xx/network error,
consumer catches and calls `message.retry()`).

Reviewed 2026-07-08. Two real gaps found, distinct from the swallow-vs-throw
design the PR got right elsewhere:

1. **Unguarded enqueue call** (notify.ts ~line 59): `await
   env.NOTIFY_QUEUE.sendBatch(...)` inside `notify()` has no try/catch. If it
   throws (CF Queues message-size/batch-size limits, quota, transient API
   error), the rejection propagates out of `notify()` through
   `ctx.waitUntil(notify(...))` in `ingest.ts` (~line 68) with none of the
   "notify:"-prefixed contextual logging every other failure path in this file
   has. Unlike the documented missing-binding fallback (which warns + degrades
   to inline), an enqueue-time throw drops the *entire batch* silently (no
   fallback, no retry — ironic since queue mode exists specifically for
   retry/DLQ guarantees). `notify.test.ts` has no test for `sendBatch`
   rejecting, confirming the gap. Recommended fix: wrap the `sendBatch` call in
   try/catch, log with `console.error('notify: enqueue failed ...', err)`
   including target count, and consider falling back to inline dispatch (same
   pattern already used for the missing-binding case) rather than dropping the
   batch.

2. **ack()/retry() not independently guarded** (consumeNotificationBatch,
   notify.ts ~lines 101-108): `message.ack()` is called inside the same `try`
   as `deliverNotification`. If `ack()` itself throws post-delivery-success,
   the catch block logs the misleading "queue delivery failed, retrying" (delivery
   actually succeeded) and calls `message.retry()` — causing a duplicate
   delivery. If `retry()` itself then also throws, the exception is uncaught,
   propagates through `consumeNotificationBatch` → `queue()` in `index.ts`
   (no try/catch there either), and per Cloudflare Queues semantics a handler
   throw retries the *whole batch*, including messages that had already
   ack'd/delivered successfully — a duplicate-delivery risk for unrelated
   messages in the same batch. Low likelihood (ack/retry are Workers-runtime
   calls, rarely throw) but zero test coverage for this edge case either.

See also [[project_error_conventions]] (house style: plain console.error/warn,
no Sentry/errorIds infra — both gaps above should be fixed with that same
plain-logging style, not by introducing new infra).

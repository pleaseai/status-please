import type { Notifications, StatusChangePayload } from '@statusbeam/core'
import type { Env } from './env'
import { toSlackMessage } from '@statusbeam/core'

/**
 * A single ready-to-POST notification: one target URL and its JSON body. Slack
 * carries its Block Kit message; generic webhooks carry the channel-agnostic
 * payload. This is the wire shape for both delivery modes — inline dispatch
 * POSTs it directly; queue dispatch enqueues it as one message.
 */
export interface NotificationMessage {
  url: string
  body: unknown
}

/** Cloudflare Queues caps a single `sendBatch` at 100 messages. */
const QUEUE_BATCH_LIMIT = 100

/**
 * Fan a status-change payload out into one {@link NotificationMessage} per
 * configured target. Shared by both delivery modes so they dispatch to exactly
 * the same set of targets with the same bodies.
 */
export function buildNotificationMessages(
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
): NotificationMessage[] {
  if (!notifications) {
    return []
  }
  const messages: NotificationMessage[] = []
  if (notifications.slack) {
    messages.push({ url: notifications.slack.webhookUrl, body: toSlackMessage(payload) })
  }
  for (const hook of notifications.webhooks ?? []) {
    messages.push({ url: hook.url, body: payload })
  }
  return messages
}

/**
 * Deliver a status-change payload, picking the transport from
 * `notifications.delivery` (see {@link Notifications}):
 *
 * - `queue`: enqueue one message per target onto {@link Env.NOTIFY_QUEUE} so a
 *   consumer dispatches them with the queue's retries + dead-lettering.
 * - `inline` (default): POST each target directly here.
 *
 * Falls back to inline dispatch — so a status change is never silently dropped —
 * whenever the queue path can't be taken:
 * - the queue binding is absent (misconfiguration, or the free plan where Queues
 *   is unavailable), or
 * - the enqueue itself fails (`sendBatch` throws on a quota/throttle/transient
 *   API error).
 * Both cases warn the operator so the misconfiguration or outage is visible.
 */
export async function notify(
  env: Env,
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (notifications?.delivery === 'queue') {
    if (env.NOTIFY_QUEUE) {
      const messages = buildNotificationMessages(notifications, payload)
      if (messages.length === 0) {
        return
      }
      // Chunk to the sendBatch limit so a large target list still takes the
      // queue path instead of erroring straight into the inline fallback.
      let enqueued = 0
      try {
        for (let i = 0; i < messages.length; i += QUEUE_BATCH_LIMIT) {
          const chunk = messages.slice(i, i + QUEUE_BATCH_LIMIT)
          await env.NOTIFY_QUEUE.sendBatch(chunk.map(body => ({ body })))
          enqueued += chunk.length
        }
        return
      }
      catch (err) {
        // A chunk failed to enqueue. `sendBatch` is atomic per call, so
        // `enqueued` counts only fully-accepted chunks — fall back to inline for
        // just the un-enqueued remainder. Re-dispatching the already-queued
        // messages would double-deliver them. Log with the file's `notify:`
        // style (counts, never payload contents).
        console.error(`notify: enqueue failed after ${enqueued}/${messages.length} message(s); dispatching the rest inline`, err)
        await postAll(fetchImpl, messages.slice(enqueued))
        return
      }
    }
    else {
      console.warn(
        'notify: notifications.delivery is "queue" but the NOTIFY_QUEUE binding is missing; '
        + 'add the queues.producers binding in wrangler.jsonc. Falling back to inline dispatch.',
      )
    }
  }
  await dispatchNotifications(notifications, payload, fetchImpl)
}

/**
 * Inline dispatch: POST every target directly (the default transport {@link notify}
 * selects, and its fallback when the queue path is unavailable). Failures are
 * logged, never thrown, so one bad target cannot wedge the run and a status
 * change still reaches the healthy targets. Best-effort — no retries; the
 * {@link notify} queue path is the opt-in reliable alternative. Resolves once
 * every dispatch settles.
 */
export async function dispatchNotifications(
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postAll(fetchImpl, buildNotificationMessages(notifications, payload))
}

/** POST every message inline, swallowing individual failures. */
async function postAll(fetchImpl: typeof fetch, messages: NotificationMessage[]): Promise<void> {
  await Promise.allSettled(messages.map(m => postJson(fetchImpl, m)))
}

/**
 * Queue consumer: deliver each message, acking on success and retrying on
 * failure. Cloudflare Queues re-delivers retried messages with backoff and,
 * once `max_retries` is exhausted, routes them to the configured dead-letter
 * queue — so a persistently failing target surfaces there, never silently
 * dropped. Messages are settled independently so one bad target doesn't force
 * healthy ones to redeliver.
 */
export async function consumeNotificationBatch(
  batch: MessageBatch<NotificationMessage>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await deliverNotification(message.body, fetchImpl)
      }
      catch (err) {
        // Delivery failed — retry so Queues re-delivers and eventually
        // dead-letters. Keep `ack()` out of this try so a post-success ack
        // failure isn't misread as a delivery failure and spuriously retried.
        console.error(`notify: queue delivery failed, retrying`, err)
        try {
          message.retry()
        }
        catch (retryErr) {
          // A thrown retry() would escape Promise.all and abort the whole
          // batch (re-delivering already-settled messages). Contain it — Queues
          // re-delivers an unsettled message on its own.
          console.error(`notify: retry() failed`, retryErr)
        }
        return
      }
      try {
        message.ack()
      }
      catch (err) {
        // Delivery already succeeded; a failed ack must not crash the batch or
        // trigger a retry (that would re-POST a delivered notification). Log in
        // the file's `notify:` style and let Queues auto-settle the message.
        console.error(`notify: ack failed after successful delivery`, err)
      }
    }),
  )
}

/**
 * POST one notification message. Throws on a network error or a non-2xx
 * response so the queue consumer retries (and eventually dead-letters) it. The
 * inline path wraps this in {@link postJson} to swallow failures instead.
 */
export async function deliverNotification(
  message: NotificationMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(message.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message.body),
    // Cap a slow/hung target so it can't stall the queue consumer (or hold an
    // inline `ctx.waitUntil`). A timeout aborts as a throw → the consumer
    // retries (transient), the inline path swallows it.
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new Error(`POST ${redactUrl(message.url)} failed (${res.status})`)
  }
}

/** Scheme + host only — webhook URLs embed secrets (Slack path, `?token=`). */
function redactUrl(url: string): string {
  try {
    return new URL(url).origin
  }
  catch {
    return '<invalid url>'
  }
}

/** Inline variant of {@link deliverNotification}: logs failures, never throws. */
async function postJson(fetchImpl: typeof fetch, message: NotificationMessage): Promise<void> {
  try {
    await deliverNotification(message, fetchImpl)
  }
  catch (err) {
    // A non-2xx error already names the target; a thrown fetch (network failure)
    // does not, so include the redacted URL either way.
    console.error(`notify: POST ${redactUrl(message.url)} failed`, err)
  }
}

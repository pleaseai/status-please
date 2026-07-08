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
 * If `delivery: queue` is set but the queue binding is absent (misconfiguration,
 * or the free plan where Queues is unavailable), it falls back to inline so a
 * status change is never silently dropped — and warns the operator.
 */
export async function notify(
  env: Env,
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
): Promise<void> {
  if (notifications?.delivery === 'queue') {
    if (env.NOTIFY_QUEUE) {
      const messages = buildNotificationMessages(notifications, payload)
      if (messages.length > 0) {
        await env.NOTIFY_QUEUE.sendBatch(messages.map(body => ({ body })))
      }
      return
    }
    console.warn(
      'notify: notifications.delivery is "queue" but the NOTIFY_QUEUE binding is missing; '
      + 'add the queues.producers binding in wrangler.jsonc. Falling back to inline dispatch.',
    )
  }
  await dispatchNotifications(notifications, payload)
}

/**
 * Inline dispatch: POST every target directly (called from `ctx.waitUntil`).
 * Failures are logged, never thrown, so one bad target cannot wedge the run and
 * a status change still reaches the healthy targets. Best-effort — no retries;
 * the {@link notify} queue path is the opt-in reliable alternative. Resolves
 * once every dispatch settles.
 */
export async function dispatchNotifications(
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const messages = buildNotificationMessages(notifications, payload)
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
        message.ack()
      }
      catch (err) {
        console.error(`notify: queue delivery failed, retrying`, err)
        message.retry()
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

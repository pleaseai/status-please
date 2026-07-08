import type { Notifications, StatusChangePayload } from '@statusbeam/core'
import { toSlackMessage } from '@statusbeam/core'

/**
 * Fan out a status-change payload to every configured target. Slack receives
 * its Block Kit message; generic webhooks receive the channel-agnostic payload
 * as JSON. Failures are logged, never thrown, so one bad target cannot wedge
 * the cron run. Resolves once every dispatch settles.
 *
 * This is inline dispatch via `fetch` (called from `ctx.waitUntil`). A
 * Cloudflare Workers Queue could sit between producer and dispatch for retries
 * and backpressure; see the follow-up note in wrangler.jsonc.
 */
export async function dispatchNotifications(
  notifications: Notifications | undefined,
  payload: StatusChangePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!notifications) {
    return
  }
  const posts: Promise<void>[] = []
  if (notifications.slack) {
    posts.push(postJson(fetchImpl, notifications.slack.webhookUrl, toSlackMessage(payload)))
  }
  for (const hook of notifications.webhooks ?? []) {
    posts.push(postJson(fetchImpl, hook.url, payload))
  }
  await Promise.allSettled(posts)
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

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown): Promise<void> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.error(`notify: POST ${redactUrl(url)} failed (${res.status})`)
    }
  }
  catch (err) {
    console.error(`notify: POST ${redactUrl(url)} threw`, err)
  }
}

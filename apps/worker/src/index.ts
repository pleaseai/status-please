import type { Env } from './env'
import type { NotificationMessage } from './notify'
import { checkSite } from '@statusbeam/core'
import { ingest, loadConfig } from './ingest'
import { consumeNotificationBatch } from './notify'
import { handleWebhook } from './webhook'

/**
 * Worker entrypoints. Two triggers feed the same {@link ingest} pipeline:
 *
 * - `scheduled` (cron, wrangler.jsonc): check every configured site and ingest
 *   the whole batch. The reliable backstop.
 * - `fetch` (HTTP): accept inbound provider webhooks at
 *   `POST /webhooks/:provider/:slug` (Atlassian Statuspage or Sentry) and ingest
 *   a single site's status the moment it changes, instead of waiting for the next
 *   cron tick.
 *
 * Both persist the result, refresh the snapshot the status page reads, and — on
 * a status change — notify subscribers and purge the edge cache.
 *
 * A third, opt-in trigger drains notifications when `notifications.delivery` is
 * `queue`:
 *
 * - `queue` (Cloudflare Queues): dispatch each enqueued notification with the
 *   queue's automatic retries + dead-lettering. Inert unless the operator wires
 *   the `queues` bindings in wrangler.jsonc (Queues runs on the free plan; the
 *   Paid plan raises limits and retention).
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = await loadConfig(env)
    // Skip webhook-only Sentry sites (a `check: sentry` site with no `sentry:`
    // poll block, or no SENTRY_AUTH_TOKEN to authenticate the poll). Polling them
    // would record a false `down` every tick and clobber the webhook-driven
    // status; ingest preserves a skipped site's previous status instead.
    const sites = config.sites.filter((site) => {
      if (site.check !== 'sentry') {
        return true
      }
      // A `sentry:` block declares intent to poll; a missing token then is a
      // deploy/config mistake worth surfacing rather than skipping silently. A
      // site with no `sentry:` block is webhook-only by design — skip it quietly.
      if (site.sentry !== undefined && !env.SENTRY_AUTH_TOKEN) {
        console.warn(`scheduled: sentry poll configured for "${site.slug}" but SENTRY_AUTH_TOKEN is missing; skipping poll`)
        return false
      }
      return site.sentry !== undefined
    })
    const results = await Promise.all(
      sites.map(site => checkSite(site, { sentryToken: env.SENTRY_AUTH_TOKEN })),
    )
    await ingest(env, config, results, ctx)
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleWebhook(request, env, ctx)
  },

  async queue(batch: MessageBatch<NotificationMessage>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    await consumeNotificationBatch(batch)
  },
}

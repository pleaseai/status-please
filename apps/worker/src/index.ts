import type { Env } from './env'
import type { NotificationMessage } from './notify'
import { checkSite } from '@statusbeam/core'
import { ingest, loadConfig } from './ingest'
import { consumeNotificationBatch } from './notify'
import { handleStatuspageWebhook } from './webhook'

/**
 * Worker entrypoints. Two triggers feed the same {@link ingest} pipeline:
 *
 * - `scheduled` (cron, wrangler.jsonc): check every configured site and ingest
 *   the whole batch. The reliable backstop.
 * - `fetch` (HTTP): accept inbound Atlassian Statuspage subscriber webhooks at
 *   `POST /webhooks/statuspage/:slug` and ingest a single site's status the
 *   moment it changes, instead of waiting for the next cron tick.
 *
 * Both persist the result, refresh the snapshot the status page reads, and — on
 * a status change — notify subscribers and purge the edge cache.
 *
 * A third, opt-in trigger drains notifications when `notifications.delivery` is
 * `queue`:
 *
 * - `queue` (Cloudflare Queues): dispatch each enqueued notification with the
 *   queue's automatic retries + dead-lettering. Inert unless the operator wires
 *   the `queues` bindings in wrangler.jsonc (Workers Paid plan).
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = await loadConfig(env)
    const results = await Promise.all(config.sites.map(site => checkSite(site)))
    await ingest(env, config, results, ctx)
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleStatuspageWebhook(request, env, ctx)
  },

  async queue(batch: MessageBatch<NotificationMessage>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    await consumeNotificationBatch(batch)
  },
}

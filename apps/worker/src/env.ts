import type { NotificationMessage } from './notify'

export interface Env {
  /** Time-series checks + incident history. */
  DB: D1Database
  /** Current snapshot the status page reads, plus the `config` YAML document. */
  STATUS_KV: KVNamespace
  /**
   * Optional Cloudflare Queue for reliable notification delivery. Bound only
   * when the operator opts into `notifications.delivery: queue` and wires the
   * `queues.producers` binding in wrangler.jsonc (Workers Paid plan). When
   * unset, dispatch falls back to inline `fetch` (see {@link notify} in
   * notify.ts). The `queue()` consumer in index.ts drains it with retries + DLQ.
   */
  NOTIFY_QUEUE?: Queue<NotificationMessage>
  /**
   * Cloudflare API token with the "Cache Purge" permission. Used by
   * {@link purgeStatusCache} to purge the edge cache by Cache-Tag on a status
   * change. Optional: when unset, cache purge is skipped (logged, not fatal).
   * Set with `wrangler secret put CF_API_TOKEN`.
   */
  CF_API_TOKEN?: string
  /** Zone id whose cache is purged by tag. Optional; pairs with CF_API_TOKEN. */
  CF_ZONE_ID?: string
  /**
   * Shared secret authenticating inbound Statuspage webhooks. Compared
   * constant-time against the request's `?token=` by {@link handleStatuspageWebhook}.
   * When unset, the webhook endpoint fails closed (every request → 401), so the
   * endpoint is never open.
   *
   * Use a long, random value — generate one with `openssl rand -hex 32` — and
   * set it with `wrangler secret put WEBHOOK_SECRET`. The comparison short-circuits
   * on a length mismatch (like Node's `crypto.timingSafeEqual`), so the secret's
   * length is not itself secret; a 32-byte random value keeps the brute-force
   * search space astronomically large regardless.
   */
  WEBHOOK_SECRET?: string
}

/** KV keys used by statusbeam. */
export const KV_KEYS = {
  /** The `status.config.yml` document, uploaded at deploy time. */
  config: 'config',
  /** JSON array of SiteSummary — the whole dashboard in one read. */
  summary: 'summary',
  /** JSON array of Incident — the incident timeline in one read. */
  incidents: 'incidents',
} as const

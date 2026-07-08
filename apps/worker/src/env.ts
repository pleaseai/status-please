export interface Env {
  /** Time-series checks + incident history. */
  DB: D1Database
  /** Current snapshot the status page reads, plus the `config` YAML document. */
  STATUS_KV: KVNamespace
  /**
   * Cloudflare API token with the "Cache Purge" permission. Used by
   * {@link purgeStatusCache} to purge the edge cache by Cache-Tag on a status
   * change. Optional: when unset, cache purge is skipped (logged, not fatal).
   * Set with `wrangler secret put CF_API_TOKEN`.
   */
  CF_API_TOKEN?: string
  /** Zone id whose cache is purged by tag. Optional; pairs with CF_API_TOKEN. */
  CF_ZONE_ID?: string
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

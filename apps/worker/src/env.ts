export interface Env {
  /** Time-series checks + incident history. */
  DB: D1Database
  /** Current snapshot the status page reads, plus the `config` YAML document. */
  STATUS_KV: KVNamespace
}

/** KV keys used by status-please. */
export const KV_KEYS = {
  /** The `status.config.yml` document, uploaded at deploy time. */
  config: 'config',
  /** JSON array of SiteSummary — the whole dashboard in one read. */
  summary: 'summary',
  /** JSON array of Incident — the incident timeline in one read. */
  incidents: 'incidents',
} as const

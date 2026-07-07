import type { CheckResult, CheckStatus, DayStat, SiteSummary, StatusConfig } from '@status-please/core'
import type { Env } from './env'
import { buildStatusChangePayload, checkSite, formatUptime, parseConfig, windowUptime } from '@status-please/core'
import { purgeStatusCache } from './cache'
import { KV_KEYS } from './env'
import { dispatchNotifications } from './notify'

const HISTORY_DAYS = 90

/**
 * Cron entrypoint. Runs on the schedule in wrangler.jsonc: check every site,
 * persist the result, refresh the snapshot the status page reads, and — on a
 * status change — notify subscribers and purge the edge cache so the page
 * updates immediately instead of waiting for a TTL.
 */
export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = await loadConfig(env)

    const results = await Promise.all(config.sites.map(site => checkSite(site)))

    // Persist every check row (time-series) in one batch.
    await env.DB.batch(
      results.map(r =>
        env.DB.prepare(
          `INSERT INTO checks (slug, status, code, response_time, checked_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(r.slug, r.status, r.code, r.responseTime, r.checkedAt),
      ),
    )

    // Detect status changes against the previous snapshot before overwriting it.
    const previous = await readSummary(env)
    const changed = results.filter(r => previous.get(r.slug) !== undefined && previous.get(r.slug) !== r.status)

    await writeSummary(env, config, results)

    if (changed.length > 0) {
      // Diff against the previous snapshot: `previous.get` is defined here
      // because `changed` only keeps slugs whose prior status existed and moved.
      const changes = changed.map(r => ({
        slug: r.slug,
        from: previous.get(r.slug) as CheckStatus,
        to: r.status,
      }))
      const payload = buildStatusChangePayload(changes, new Date().toISOString())

      // Notify subscribers and purge the edge cache by tag so the page reflects
      // the new state immediately instead of waiting for its TTL.
      ctx.waitUntil(dispatchNotifications(config.notifications, payload))
      ctx.waitUntil(purgeStatusCache(env, changes.map(c => c.slug)))
    }
  },
}

async function loadConfig(env: Env): Promise<StatusConfig> {
  const yaml = await env.STATUS_KV.get(KV_KEYS.config)
  if (!yaml) {
    throw new Error('No config in KV. Upload status.config.yml to the "config" key.')
  }
  return parseConfig(yaml)
}

/** Read the previous snapshot as slug → status for change detection. */
async function readSummary(env: Env): Promise<Map<string, string>> {
  const raw = await env.STATUS_KV.get(KV_KEYS.summary)
  if (!raw) {
    return new Map()
  }
  const summary = JSON.parse(raw) as SiteSummary[]
  return new Map(summary.map(s => [s.slug, s.status]))
}

/** Overwrite the snapshot the status page reads at the edge. */
async function writeSummary(env: Env, config: StatusConfig, results: CheckResult[]): Promise<void> {
  const bySlug = new Map(results.map(r => [r.slug, r]))
  const historyBySlug = await readHistory(env)
  const summary: SiteSummary[] = config.sites.map((site) => {
    const r = bySlug.get(site.slug)
    const history = denseHistory(historyBySlug.get(site.slug))
    return {
      slug: site.slug,
      name: site.name,
      status: r?.status ?? 'down',
      responseTime: r?.responseTime ?? 0,
      // Trailing windows are the tail slices of the same 90-day history.
      uptimeDay: formatUptime(windowUptime(history.slice(-1))),
      uptimeWeek: formatUptime(windowUptime(history.slice(-7))),
      uptimeMonth: formatUptime(windowUptime(history.slice(-30))),
      history,
    }
  })
  await env.STATUS_KV.put(KV_KEYS.summary, JSON.stringify(summary))
}

interface DayRow {
  slug: string
  day: string
  up: number
  degraded: number
  down: number
  total: number
}

/**
 * Aggregate the D1 `checks` table into one row per (slug, day) for the last
 * {@link HISTORY_DAYS} days: the worst status of the day and its uptime ratio.
 */
async function readHistory(env: Env): Promise<Map<string, Map<string, DayStat>>> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - (HISTORY_DAYS - 1))
  since.setUTCHours(0, 0, 0, 0)
  // Filter on the raw ISO `checked_at` (sargable via idx_checks_time) rather
  // than `date(checked_at)`, which would wrap the column and skip the index.
  const rows = await env.DB.prepare(
    `SELECT slug,
            date(checked_at) AS day,
            SUM(status = 'up') AS up,
            SUM(status = 'degraded') AS degraded,
            SUM(status = 'down') AS down,
            COUNT(*) AS total
     FROM checks
     WHERE checked_at >= ?
     GROUP BY slug, day`,
  ).bind(since.toISOString()).all<DayRow>()

  const bySlug = new Map<string, Map<string, DayStat>>()
  for (const row of rows.results) {
    const status: CheckStatus = row.down > 0 ? 'down' : row.degraded > 0 ? 'degraded' : 'up'
    const days = bySlug.get(row.slug) ?? new Map<string, DayStat>()
    days.set(row.day, { date: row.day, status, uptime: row.total ? row.up / row.total : 1 })
    bySlug.set(row.slug, days)
  }
  return bySlug
}

/** Expand sparse per-day rows into a dense 90-entry window (oldest → newest). */
function denseHistory(days: Map<string, DayStat> | undefined): DayStat[] {
  const out: DayStat[] = []
  const today = new Date()
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().slice(0, 10)
    out.push(days?.get(date) ?? { date, status: null, uptime: 1 })
  }
  return out
}

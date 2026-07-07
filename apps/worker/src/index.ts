import type { CheckResult, SiteSummary, StatusConfig } from '@status-please/core'
import type { Env } from './env'
import { checkSite, parseConfig } from '@status-please/core'
import { KV_KEYS } from './env'

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
      // TODO(notify): enqueue notification events (Slack/webhook/email/RSS).
      // TODO(cache): purge the page/badge cache by tag so updates are instant.
      //   e.g. ctx.cache.purge({ tags: ['status-page', ...changed.map(c => c.slug)] })
      ctx.waitUntil(Promise.resolve())
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
  const summary: SiteSummary[] = config.sites.map((site) => {
    const r = bySlug.get(site.slug)
    return {
      slug: site.slug,
      name: site.name,
      status: r?.status ?? 'down',
      responseTime: r?.responseTime ?? 0,
      // TODO(uptime): compute trailing windows from the D1 `checks` table.
      uptimeDay: '—',
      uptimeWeek: '—',
      uptimeMonth: '—',
    }
  })
  await env.STATUS_KV.put(KV_KEYS.summary, JSON.stringify(summary))
}

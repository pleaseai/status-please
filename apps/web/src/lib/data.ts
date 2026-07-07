import type { CheckStatus, DayStat, SiteSummary } from '@status-please/core'
import { env } from 'cloudflare:workers'

/**
 * Build 90 days of deterministic sample history (oldest → newest, ending
 * today). A small LCG keyed by `seed` sprinkles occasional degraded/down days
 * so the demo timeline looks organic without depending on `Math.random`.
 */
function sampleHistory(seed: number): DayStat[] {
  const days: DayStat[] = []
  const today = new Date()
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const r = ((i + 1) * 9301 + seed * 49297) % 233280 / 233280
    let status: CheckStatus = 'up'
    let uptime = 1
    if (r > 0.97) {
      status = 'down'
      uptime = 0.62
    }
    else if (r > 0.92) {
      status = 'degraded'
      uptime = 0.98
    }
    days.push({ date: d.toISOString().slice(0, 10), status, uptime })
  }
  return days
}

const SAMPLE: SiteSummary[] = [
  { slug: 'website', name: 'Website', status: 'up', responseTime: 142, uptimeDay: '100%', uptimeWeek: '99.98%', uptimeMonth: '99.95%', history: sampleHistory(3) },
  { slug: 'api', name: 'API', status: 'degraded', responseTime: 2310, uptimeDay: '99.2%', uptimeWeek: '99.7%', uptimeMonth: '99.8%', history: sampleHistory(11) },
  { slug: 'cdn', name: 'CDN', status: 'up', responseTime: 38, uptimeDay: '100%', uptimeWeek: '100%', uptimeMonth: '100%', history: sampleHistory(7) },
]

/**
 * Read the dashboard snapshot the check Worker writes to KV. Falls back to
 * sample data so `astro dev` renders without Cloudflare bindings.
 *
 * Bindings come from `cloudflare:workers` (Astro 7 removed `Astro.locals.runtime`).
 */
export async function getSummary(): Promise<SiteSummary[]> {
  const kv = env.STATUS_KV
  if (kv) {
    const raw = await kv.get('summary')
    if (raw) {
      return JSON.parse(raw) as SiteSummary[]
    }
  }
  return SAMPLE
}

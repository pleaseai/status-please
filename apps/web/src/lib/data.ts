import type { CheckStatus, DayStat, ResponsePoint, SiteSummary } from '@status-please/core'
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

/**
 * Build a day's worth of deterministic response-time samples (48 points, every
 * 30 min, oldest → newest). Values jitter around `base` ms with the odd spike so
 * the demo sparkline looks organic without depending on `Math.random`.
 */
function sampleResponses(seed: number, base: number): ResponsePoint[] {
  const points: ResponsePoint[] = []
  const now = Date.now()
  const stepMs = 30 * 60 * 1000
  const count = 48
  for (let i = count - 1; i >= 0; i--) {
    const r = ((i + 1) * 4271 + seed * 7919) % 10000 / 10000
    const spike = r > 0.9 ? 1.8 : 1
    const ms = Math.max(1, Math.round(base * (0.7 + r * 0.6) * spike))
    points.push({ at: new Date(now - i * stepMs).toISOString(), ms })
  }
  return points
}

const SAMPLE: SiteSummary[] = [
  { slug: 'website', name: 'Website', status: 'up', responseTime: 142, uptimeDay: '100%', uptimeWeek: '99.98%', uptimeMonth: '99.95%', history: sampleHistory(3), responseHistory: sampleResponses(3, 142) },
  { slug: 'api', name: 'API', status: 'degraded', responseTime: 2310, uptimeDay: '99.2%', uptimeWeek: '99.7%', uptimeMonth: '99.8%', history: sampleHistory(11), responseHistory: sampleResponses(11, 2310) },
  { slug: 'cdn', name: 'CDN', status: 'up', responseTime: 38, uptimeDay: '100%', uptimeWeek: '100%', uptimeMonth: '100%', history: sampleHistory(7), responseHistory: sampleResponses(7, 38) },
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

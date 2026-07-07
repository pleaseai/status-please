import type { CheckStatus, DayStat, Incident, SiteSummary } from '@status-please/core'
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

/** ISO timestamp `hours` before now — keeps sample incidents fresh for `astro dev`. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

const SAMPLE_INCIDENTS: Incident[] = [
  {
    id: 2,
    slug: 'api',
    title: 'Elevated API error rates',
    severity: 'degraded',
    startedAt: hoursAgo(2),
    resolvedAt: null,
    updates: [
      { id: 3, incidentId: 2, state: 'investigating', body: 'We are investigating a spike in 5xx responses on the API.', createdAt: hoursAgo(2) },
      { id: 4, incidentId: 2, state: 'identified', body: 'A slow upstream dependency has been identified as the cause. A fix is being rolled out.', createdAt: hoursAgo(1) },
    ],
  },
  {
    id: 1,
    slug: 'website',
    title: 'Intermittent connection timeouts',
    severity: 'major_outage',
    startedAt: hoursAgo(52),
    resolvedAt: hoursAgo(48),
    updates: [
      { id: 1, incidentId: 1, state: 'investigating', body: 'Some visitors are seeing connection timeouts loading the website.', createdAt: hoursAgo(52) },
      { id: 2, incidentId: 1, state: 'monitoring', body: 'We restarted the affected edge nodes and are monitoring recovery.', createdAt: hoursAgo(50) },
      { id: 5, incidentId: 1, state: 'resolved', body: 'Timeouts have cleared and traffic is fully healthy. The incident is resolved.', createdAt: hoursAgo(48) },
    ],
  },
]

/**
 * Read the incident timeline the check Worker writes to KV. Falls back to sample
 * incidents so `astro dev` renders a realistic timeline without Cloudflare bindings.
 */
export async function getIncidents(): Promise<Incident[]> {
  const kv = env.STATUS_KV
  if (kv) {
    const raw = await kv.get('incidents')
    if (raw) {
      return JSON.parse(raw) as Incident[]
    }
  }
  return SAMPLE_INCIDENTS
}

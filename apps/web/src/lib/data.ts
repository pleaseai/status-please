import type { CheckStatus, DayStat, Incident, Locale, ResponsePoint, SiteSummary } from '@statusbeam/core'
import { DEFAULT_LOCALE, parseConfig, resolveLocale } from '@statusbeam/core'
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

/** Find one site in the snapshot by slug, or `undefined` if it isn't tracked. */
export async function getSite(slug: string): Promise<SiteSummary | undefined> {
  const summary = await getSummary()
  return summary.find(s => s.slug === slug)
}

// A missing `config` key is a steady-state deploy misconfiguration, so
// `getLocale()` (invoked on every bare-`/` request) would log it on every hit.
// Warn once per Worker isolate instead — enough to surface the problem without
// flooding the logs. (The catch below logs unconditionally: a thrown KV/parse
// error is exceptional, not steady-state, so each occurrence is worth a line.)
let warnedNoConfigKey = false

/**
 * Resolve the status page's UI locale from the `config` YAML in KV (the same
 * document the check Worker reads). Falls back to the default locale so `astro
 * dev` renders without Cloudflare bindings, and never throws — a malformed
 * config degrades to English rather than breaking the render.
 */
export async function getLocale(): Promise<Locale> {
  const kv = env.STATUS_KV
  if (kv) {
    try {
      // The KV read is inside the try too: a transient KV error must degrade to
      // the default locale, not throw — `/`'s middleware fallback depends on
      // this never failing the redirect.
      const raw = await kv.get('config')
      if (raw) {
        return resolveLocale(parseConfig(raw).theme.locale)
      }
      // KV is bound but has no `config` key — the deploy step never uploaded it
      // (or the key name is wrong). Warn (once per isolate) so the
      // misconfiguration is debuggable, instead of silently serving the default.
      if (!warnedNoConfigKey) {
        warnedNoConfigKey = true
        console.warn('getLocale: no `config` key in KV, falling back to default locale')
      }
    }
    catch (err) {
      // KV read failure or malformed config: fall back rather than fail the
      // whole page render, but log it (matching cache.ts/notify.ts) so the
      // operator can debug why `/` isn't honoring their configured `theme.locale`.
      console.warn('getLocale: KV read failed or malformed config, falling back to default locale', err)
    }
  }
  return DEFAULT_LOCALE
}

/** ISO timestamp `hours` before now — keeps sample incidents fresh for `astro dev`. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

// A factory (not a module-level const) so `hoursAgo()` is evaluated per call —
// relative times stay fresh across a long-running `astro dev` session.
function sampleIncidents(): Incident[] {
  return [
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
}

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
  return sampleIncidents()
}

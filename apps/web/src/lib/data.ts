import type { SiteSummary } from '@status-please/core'

const SAMPLE: SiteSummary[] = [
  { slug: 'website', name: 'Website', status: 'up', responseTime: 142, uptimeDay: '100%', uptimeWeek: '99.98%', uptimeMonth: '99.95%' },
  { slug: 'api', name: 'API', status: 'degraded', responseTime: 2310, uptimeDay: '99.2%', uptimeWeek: '99.7%', uptimeMonth: '99.8%' },
  { slug: 'cdn', name: 'CDN', status: 'up', responseTime: 38, uptimeDay: '100%', uptimeWeek: '100%', uptimeMonth: '100%' },
]

/**
 * Read the dashboard snapshot the check Worker writes to KV. Falls back to
 * sample data so `astro dev` renders without Cloudflare bindings.
 */
export async function getSummary(locals: App.Locals): Promise<SiteSummary[]> {
  const kv = locals.runtime?.env?.STATUS_KV
  if (kv) {
    const raw = await kv.get('summary')
    if (raw) {
      return JSON.parse(raw) as SiteSummary[]
    }
  }
  return SAMPLE
}

import type { APIRoute } from 'astro'
import { overallSeverity } from '@status-please/core'
import { jsonResponse } from '../../lib/api'
import { getSummary } from '../../lib/data'

// On-demand: reads the live KV snapshot at the edge, fronted by Workers Cache.
export const prerender = false

/**
 * Public status API: the whole dashboard as JSON in one read. `status` is the
 * rolled-up severity (worst site wins); `sites` is a lean per-site summary
 * (history omitted — fetch `/api/status/<slug>.json` for a single site's
 * timeline).
 */
export const GET: APIRoute = async () => {
  const summary = await getSummary()
  const payload = {
    status: overallSeverity(summary.map(s => s.status)),
    generatedAt: new Date().toISOString(),
    sites: summary.map(s => ({
      slug: s.slug,
      name: s.name,
      status: s.status,
      responseTime: s.responseTime,
      uptime: { day: s.uptimeDay, week: s.uptimeWeek, month: s.uptimeMonth },
    })),
  }
  return jsonResponse(payload, { tagSlugs: summary.map(s => s.slug) })
}

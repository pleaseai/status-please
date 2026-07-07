import type { APIRoute } from 'astro'
import { overallBadge } from '@status-please/core'
import { jsonResponse } from '../../lib/api'
import { getSummary } from '../../lib/data'

export const prerender = false

/**
 * Overall status badge (shields.io endpoint). Use with:
 * `https://img.shields.io/endpoint?url=<origin>/api/badge.json`
 */
export const GET: APIRoute = async () => {
  const summary = await getSummary()
  return jsonResponse(overallBadge(summary), { tagSlugs: summary.map(s => s.slug) })
}

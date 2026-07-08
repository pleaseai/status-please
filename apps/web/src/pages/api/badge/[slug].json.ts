import type { APIRoute } from 'astro'
import { statusBadge } from '@statusbeam/core'
import { jsonResponse, notFound } from '../../../lib/api'
import { getSite } from '../../../lib/data'

export const prerender = false

/**
 * Per-site status badge (shields.io endpoint): `<name> | up|degraded|down`.
 * `https://img.shields.io/endpoint?url=<origin>/api/badge/<slug>.json`
 */
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? ''
  const site = await getSite(slug)
  if (!site) {
    return notFound(`No site with slug "${slug}"`)
  }
  return jsonResponse(statusBadge(site), { tagSlugs: [site.slug] })
}

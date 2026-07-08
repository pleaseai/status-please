import type { APIRoute } from 'astro'
import { responseBadge } from '@statusbeam/core'
import { jsonResponse, notFound } from '../../../../lib/api'
import { getSite } from '../../../../lib/data'

export const prerender = false

/**
 * Per-site response-time badge (shields.io endpoint): `response time | 142ms`.
 * `https://img.shields.io/endpoint?url=<origin>/api/badge/<slug>/response-time.json`
 */
export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug ?? ''
  const site = await getSite(slug)
  if (!site) {
    return notFound(`No site with slug "${slug}"`)
  }
  return jsonResponse(responseBadge(site), { tagSlugs: [site.slug] })
}

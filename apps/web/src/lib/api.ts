import { cacheTagHeader } from '@statusbeam/core'

/**
 * JSON response for the public `/api/*` endpoints (badges + status API).
 *
 * These live behind Workers Cache exactly like the status page: a short
 * `s-maxage` plus a `Cache-Tag` so the check Worker's purge-by-tag busts them
 * the instant a status flips, rather than waiting for the TTL. `tagSlugs` is the
 * set of sites the payload reflects (one site for a per-site route, all sites
 * for the overall badge / status API) so a change to any of them invalidates it.
 *
 * `Access-Control-Allow-Origin: *` lets browsers fetch the status API directly;
 * the badge routes are fetched server-side by shields.io, which doesn't need it,
 * but a single public policy keeps every endpoint consistent.
 */
export function jsonResponse(
  data: unknown,
  { tagSlugs, maxAge = 60 }: { tagSlugs: string[], maxAge?: number },
): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=600`,
      'Cache-Tag': cacheTagHeader(tagSlugs),
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/**
 * 404 for an unknown site slug. Not tagged or long-cached: the slug may start
 * existing later, so we don't want a stale miss pinned at the edge.
 */
export function notFound(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

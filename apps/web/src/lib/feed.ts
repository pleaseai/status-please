import type { FeedMeta } from '@statusbeam/core'
import type { APIContext } from 'astro'
import { buildAtomFeed, buildRssFeed, cacheTagHeader } from '@statusbeam/core'
import { getIncidents, getPageName } from './data'

/** Feed flavor → its response `Content-Type`. */
const CONTENT_TYPE = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
} as const

export type FeedKind = keyof typeof CONTENT_TYPE

/**
 * Shared handler for the incident feed endpoints (`/feed.rss`, `/feed.atom`, and
 * the `history.*` aliases). Reads the live incident timeline + page name from KV,
 * derives absolute URLs from the request so a self-hosted deploy feeds its own
 * origin, and serves the XML behind Workers Cache exactly like the status API.
 *
 * The `Cache-Tag` covers the page tag plus each affected site, so the check
 * Worker's purge-by-tag busts the feed the instant a status flips — the same
 * invalidation path as the page itself (see lib/api.ts / core/cache.ts).
 */
export async function feedResponse(kind: FeedKind, { url }: APIContext): Promise<Response> {
  const [incidents, name] = await Promise.all([getIncidents(), getPageName()])

  const meta: FeedMeta = {
    name,
    siteUrl: url.origin,
    // Drop any query string so the advertised self URL is the canonical route.
    feedUrl: `${url.origin}${url.pathname}`,
  }
  const body = kind === 'rss' ? buildRssFeed(incidents, meta) : buildAtomFeed(incidents, meta)
  const tagSlugs = [...new Set(incidents.map(i => i.slug))]

  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPE[kind],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
      'Cache-Tag': cacheTagHeader(tagSlugs),
      'Access-Control-Allow-Origin': '*',
    },
  })
}

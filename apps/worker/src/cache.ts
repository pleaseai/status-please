import type { Env } from './env'

/** Cache-Tag on every status-page response; purging it busts the whole page. */
export const STATUS_PAGE_TAG = 'status-page'

/** Cache-Tag for a single site, so one flip can purge just that site's assets. */
export function siteTag(slug: string): string {
  return `status-site-${slug}`
}

/**
 * Purge the edge cache by Cache-Tag when a status changes, so the page reflects
 * the new state immediately instead of waiting for its TTL.
 *
 * Cloudflare Workers expose no binding-level tag purge — purge-by-tag is an
 * Enterprise Cache feature driven through the REST API. This POSTs to
 * `/zones/{zone}/purge_cache` with `{ tags }`. It needs two secrets (see
 * env.ts / wrangler.jsonc):
 *   - `CF_API_TOKEN` — token with the "Cache Purge" permission
 *   - `CF_ZONE_ID`   — the zone serving the status page
 * The web app must emit a matching `Cache-Tag` response header for the purge to
 * hit anything. When either secret is unset, the purge is skipped (logged).
 */
export async function purgeStatusCache(
  env: Env,
  changedSlugs: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) {
    console.warn('purgeStatusCache: CF_API_TOKEN/CF_ZONE_ID unset; skipping cache purge')
    return
  }
  const tags = [STATUS_PAGE_TAG, ...changedSlugs.map(siteTag)]
  try {
    const res = await fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags }),
      },
    )
    if (!res.ok) {
      console.error(`purgeStatusCache: purge failed (${res.status})`)
    }
  }
  catch (err) {
    console.error('purgeStatusCache: purge threw', err)
  }
}

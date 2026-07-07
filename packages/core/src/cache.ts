/**
 * Cache-Tag values shared by the two sides of the purge loop: the status page
 * (apps/web) emits them as a `Cache-Tag` response header, and the check Worker
 * (apps/worker) purges them by tag on a status change. Keeping them here means
 * the emit side and the purge side can never drift apart.
 */

/** Tag on every status-page response; purging it busts the whole page. */
export const STATUS_PAGE_TAG = 'status-page'

/**
 * Tag for a single site, so one flip can purge just that site's assets.
 * `slug` must be Cache-Tag-safe (no commas/whitespace — those would split or
 * corrupt the header). The config schema enforces this at parse time
 * (`siteSchema.slug`), so callers here don't re-validate.
 */
export function siteTag(slug: string): string {
  return `status-site-${slug}`
}

/** The full tag set for a page showing `slugs`: the page tag plus one per site. */
export function cacheTags(slugs: string[]): string[] {
  return [STATUS_PAGE_TAG, ...slugs.map(siteTag)]
}

/** Comma-joined `Cache-Tag` response header value for a page showing `slugs`. */
export function cacheTagHeader(slugs: string[]): string {
  return cacheTags(slugs).join(',')
}

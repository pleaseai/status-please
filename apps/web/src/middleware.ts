import { isLocale, resolveLocale } from '@status-please/core'
import { defineMiddleware } from 'astro:middleware'
import { getLocale } from './lib/data'

/**
 * Language negotiation for the bare root `/`. Locale-prefixed paths (`/en/`,
 * `/ja/`, …) and asset requests pass straight through — they render and cache
 * per URL, so the edge cache never fragments on `Accept-Language`.
 *
 * Precedence for `/`: the visitor's remembered choice (a `locale` cookie set
 * client-side on the localized page) → the browser's `Accept-Language`
 * (negotiated by Astro against the configured locales) → the deployment's
 * configured default (`theme.locale`) → English. The redirect is per-visitor,
 * so it's marked uncacheable; the localized page it points at stays cacheable.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname !== '/') {
    return next()
  }

  const remembered = context.cookies.get('locale')?.value
  const target = isLocale(remembered)
    ? remembered
    : context.preferredLocale
      ? resolveLocale(context.preferredLocale)
      : await getLocale()

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `/${target}/`,
      // Per-visitor decision — never let the edge cache pin one language here.
      'Cache-Control': 'private, no-store',
      'Vary': 'Accept-Language, Cookie',
    },
  })
})

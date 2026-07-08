import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { DEFAULT_LOCALE, LOCALES } from './i18n'

/**
 * How a single service is checked. `incidentio` reads an incident.io status
 * page, which serves a Statuspage-compatible `summary.json`, so it shares the
 * `statuspage` code path (see check.ts).
 */
export const checkKindSchema = z.enum(['http', 'tcp', 'ssl', 'statuspage', 'incidentio'])
export type CheckKind = z.infer<typeof checkKindSchema>

/** Turn a human name into a stable, URL-safe slug. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const siteSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    check: checkKindSchema.default('http'),
    method: z.string().default('GET'),
    expectedStatusCodes: z.array(z.number().int()).default([200]),
    /** Response time above this (ms) marks the site `degraded` rather than `up`. */
    maxResponseTime: z.number().int().positive().default(5000),
    /**
     * For `check: statuspage` / `incidentio` only (both read the same
     * Statuspage-format payload). Reads one component by name (case-insensitive)
     * or id; when omitted, the page's overall indicator is used. Rejected at
     * parse time for other check kinds (see superRefine below) so a mistyped
     * `check` doesn't silently ignore the field.
     */
    component: z.string().min(1).optional(),
    /**
     * Optional explicit slug; defaults to slugify(name). Constrained to the
     * same charset slugify emits so it's safe to embed in a `Cache-Tag` (no
     * commas/whitespace, which would corrupt the header — see cache.ts).
     */
    slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and hyphens').optional(),
  })
  .superRefine((site, ctx) => {
    // `component` only means something for statuspage/incidentio checks; surface
    // a mistyped `check` (or a stray `component:` line) as a parse error instead
    // of quietly ignoring it at runtime.
    if (site.component !== undefined && site.check !== 'statuspage' && site.check !== 'incidentio') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['component'],
        message: `component is only valid with check: statuspage or incidentio (got check: ${site.check})`,
      })
    }
  })
  .transform(site => ({ ...site, slug: site.slug ?? slugify(site.name) }))

export type Site = z.infer<typeof siteSchema>

/**
 * How status-change notifications reach their targets.
 *
 * - `inline` (default): POST each target directly from the run via `fetch`.
 *   Best-effort — a failed POST is logged, never retried. Works on the free
 *   Workers plan; adequate for the low volume of status-change alerts.
 * - `queue`: enqueue each target onto a Cloudflare Queue whose consumer does
 *   the POST, gaining automatic retries + backoff and dead-lettering. Requires
 *   the Workers Paid plan and the `queues` bindings in wrangler.jsonc.
 */
export const notificationDeliverySchema = z.enum(['inline', 'queue'])
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>

/**
 * Optional outbound notification targets. Every field is optional so existing
 * configs without a `notifications` block keep parsing unchanged; `delivery`
 * defaults to `inline` so adding it never changes existing behavior.
 */
export const notificationsSchema = z.object({
  delivery: notificationDeliverySchema.default('inline'),
  slack: z.object({ webhookUrl: z.string().url() }).optional(),
  webhooks: z.array(z.object({ url: z.string().url() })).optional(),
})
export type Notifications = z.infer<typeof notificationsSchema>

export const themeSchema = z
  .object({
    logoUrl: z.string().optional(),
    darkMode: z.boolean().default(true),
    /** UI language for the status page. Defaults to English. */
    locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
  })
  .default({ darkMode: true, locale: DEFAULT_LOCALE })

export const configSchema = z.object({
  name: z.string().min(1),
  sites: z.array(siteSchema).min(1),
  notifications: notificationsSchema.optional(),
  theme: themeSchema,
})

export type StatusConfig = z.infer<typeof configSchema>

/** Parse and validate a `status.config.yml` document. Throws on invalid input. */
export function parseConfig(yaml: string): StatusConfig {
  return configSchema.parse(parseYaml(yaml))
}

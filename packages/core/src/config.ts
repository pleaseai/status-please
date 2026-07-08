import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { DEFAULT_LOCALE, LOCALES } from './i18n'

/** How a single service is checked. */
export const checkKindSchema = z.enum(['http', 'tcp', 'ssl', 'statuspage'])
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
     * For `check: statuspage` only. Reads one Atlassian Statuspage component by
     * name (case-insensitive) or id; when omitted, the page's overall indicator
     * is used. Ignored by other check kinds.
     */
    component: z.string().min(1).optional(),
    /**
     * Optional explicit slug; defaults to slugify(name). Constrained to the
     * same charset slugify emits so it's safe to embed in a `Cache-Tag` (no
     * commas/whitespace, which would corrupt the header — see cache.ts).
     */
    slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and hyphens').optional(),
  })
  .transform(site => ({ ...site, slug: site.slug ?? slugify(site.name) }))

export type Site = z.infer<typeof siteSchema>

/**
 * Optional outbound notification targets. Every field is optional so existing
 * configs without a `notifications` block keep parsing unchanged.
 */
export const notificationsSchema = z.object({
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

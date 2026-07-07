import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/** How a single service is checked. */
export const checkKindSchema = z.enum(['http', 'tcp', 'ssl'])
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
    /** Optional explicit slug; defaults to slugify(name). */
    slug: z.string().optional(),
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
  })
  .default({ darkMode: true })

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

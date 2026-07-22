import type { CheckStatus } from './types'
import { z } from 'zod'

/**
 * The slice of a Sentry issue webhook payload we rely on. A Sentry Uptime check
 * that keeps failing opens an **issue** (outage category, `type:
 * uptime_domain_failure`); a recovery resolves it. Sentry pushes an issue/alert
 * webhook on those transitions — there is no dedicated "uptime status" event — so
 * we grade the issue lifecycle:
 *
 * - Issue-alert (internal integration) webhooks carry `action: created|resolved`
 *   with `data.issue`.
 * - Metric/alert-rule webhooks carry `action: triggered|resolved` with `data.event`.
 *
 * Validated at the boundary — like {@link ./statuspage-webhook.statuspageWebhookSchema}
 * — rather than trusting a bare assertion, so a wrong-shaped body (a proxy error
 * page, a spoofed request, an API version change) is rejected instead of graded.
 * Every field is optional because a single event only populates the subset
 * relevant to it, and Sentry's payload varies by integration/version.
 */
export const sentryWebhookSchema = z.object({
  /** `created` | `resolved` | `triggered` | … — the issue/alert transition. */
  action: z.string().optional(),
  data: z
    .object({
      issue: z
        .object({
          id: z.string().optional(),
          /** `unresolved` | `resolved` | `ignored`. */
          status: z.string().optional(),
          title: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

export type SentryWebhook = z.infer<typeof sentryWebhookSchema>

/**
 * Map an inbound Sentry issue webhook to a {@link CheckStatus}, or `null` when
 * the event carries no up/down transition for the site (the caller acks and
 * ignores it, like an unrelated Statuspage component event).
 *
 * Sentry Uptime is binary — a monitor is failing or it isn't — so this only ever
 * returns `up`/`down` (never `degraded`):
 *
 * - **up**: the issue resolved (`action: resolved`, or `data.issue.status:
 *   resolved`) — the monitor recovered.
 * - **down**: the issue opened or fired (`action: created|triggered`, or
 *   `data.issue.status: unresolved`) — the monitor is failing.
 * - **null**: anything else (e.g. an `ignored`/muted issue, or an unrecognized
 *   action) — leave the site's current status untouched rather than guess.
 */
export function deriveSentryWebhookStatus(payload: SentryWebhook): CheckStatus | null {
  const action = payload.action
  const status = payload.data?.issue?.status

  if (action === 'resolved' || status === 'resolved') {
    return 'up'
  }
  if (action === 'created' || action === 'triggered' || status === 'unresolved') {
    return 'down'
  }
  return null
}

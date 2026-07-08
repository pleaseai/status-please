import type { Site } from './config'
import type { CheckStatus } from './types'
import { z } from 'zod'
import { STATUSPAGE_COMPONENT_STATUS, STATUSPAGE_INDICATOR_STATUS } from './check'

/**
 * The slice of an Atlassian Statuspage webhook payload we rely on. Statuspage
 * pushes one of these to a subscriber URL when a component's status changes
 * (`component`/`component_update`) or an incident is posted/updated
 * (`incident`); every payload also carries the page's overall `status_indicator`.
 *
 * Validated at the boundary — like {@link ./check.statuspageSummarySchema} —
 * rather than trusting a bare assertion, so a wrong-shaped body (a proxy error
 * page, a spoofed request, an API version change) is rejected instead of graded.
 * Every field is optional because a single event only populates the subset
 * relevant to it.
 */
export const statuspageWebhookSchema = z.object({
  page: z
    .object({
      id: z.string().optional(),
      status_indicator: z.string().optional(),
      status_description: z.string().optional(),
    })
    .optional(),
  component: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  component_update: z
    .object({
      component_id: z.string().optional(),
      new_status: z.string().optional(),
      old_status: z.string().optional(),
    })
    .optional(),
  incident: z
    .object({
      components: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string().optional(),
            status: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

export type StatuspageWebhook = z.infer<typeof statuspageWebhookSchema>

/** True when a payload component matches the configured `component` (id or trimmed, case-insensitive name). */
function matchesComponent(
  candidate: { id?: string, name?: string } | undefined,
  id: string,
  name: string,
): boolean {
  if (!candidate) {
    return false
  }
  return candidate.id === id || candidate.name?.trim().toLowerCase() === name
}

/**
 * Map an inbound Statuspage webhook to a {@link CheckStatus} for one configured
 * site, or `null` when the event doesn't concern it.
 *
 * - **Component site** (`site.component` set): find the component the event is
 *   about — in the `component` object, via `component_update.component_id`, or in
 *   `incident.components[]` — matched by id or case-insensitive/trimmed name, and
 *   grade its status. A Statuspage subscription pushes *every* component's events,
 *   so an event about a different component yields `null` (caller ignores it).
 * - **Whole-page site** (no `component`): grade the page's `status_indicator`.
 *
 * Unknown status/indicator strings map to `degraded` — the same safe default the
 * polling adapter uses (see {@link ./check.deriveStatuspageStatus}): surface that
 * something is off without ever silently reporting `up`. Returns `null` (rather
 * than throwing, unlike the polling path) when the event carries no status for
 * this site, because receiving unrelated component events is normal.
 */
export function deriveStatuspageWebhookStatus(
  payload: StatuspageWebhook,
  site: Pick<Site, 'component'>,
): CheckStatus | null {
  if (site.component !== undefined) {
    const id = site.component.trim()
    const name = id.toLowerCase()

    if (matchesComponent(payload.component, id, name)) {
      return STATUSPAGE_COMPONENT_STATUS[payload.component?.status ?? ''] ?? 'degraded'
    }
    if (payload.component_update?.component_id === id) {
      return STATUSPAGE_COMPONENT_STATUS[payload.component_update.new_status ?? ''] ?? 'degraded'
    }
    const incidentComponent = payload.incident?.components?.find(c => matchesComponent(c, id, name))
    if (incidentComponent) {
      return STATUSPAGE_COMPONENT_STATUS[incidentComponent.status ?? ''] ?? 'degraded'
    }
    return null
  }

  const indicator = payload.page?.status_indicator
  if (indicator === undefined) {
    return null
  }
  return STATUSPAGE_INDICATOR_STATUS[indicator] ?? 'degraded'
}

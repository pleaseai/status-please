import { describe, expect, it } from 'bun:test'
import { siteSchema } from './config'
import { deriveStatuspageWebhookStatus, statuspageWebhookSchema } from './statuspage-webhook'

const pageSite = siteSchema.parse({ name: 'Claude', url: 'https://status.claude.com', check: 'statuspage' })
const componentSite = siteSchema.parse({
  name: 'Claude API',
  url: 'https://status.claude.com',
  check: 'statuspage',
  component: 'Claude API (api.anthropic.com)',
})
const componentById = siteSchema.parse({
  name: 'Claude API',
  url: 'https://status.claude.com',
  check: 'statuspage',
  component: 'abc',
})

/** A Statuspage component_update webhook body. */
const componentUpdatePayload = {
  page: { id: 'p1', status_indicator: 'major', status_description: 'Major outage' },
  component_update: { component_id: 'abc', new_status: 'major_outage', old_status: 'operational' },
  component: { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'major_outage' },
}

/** A Statuspage incident webhook body (affected components carry their status). */
const incidentPayload = {
  page: { id: 'p1', status_indicator: 'minor' },
  incident: {
    components: [
      { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'degraded_performance' },
      { id: 'def', name: 'claude.ai', status: 'operational' },
    ],
  },
}

describe('statuspageWebhookSchema', () => {
  it('accepts a component_update payload', () => {
    expect(statuspageWebhookSchema.safeParse(componentUpdatePayload).success).toBe(true)
  })

  it('accepts an incident payload', () => {
    expect(statuspageWebhookSchema.safeParse(incidentPayload).success).toBe(true)
  })

  it('accepts an empty object (all fields optional)', () => {
    expect(statuspageWebhookSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a non-object body', () => {
    expect(statuspageWebhookSchema.safeParse(null).success).toBe(false)
    expect(statuspageWebhookSchema.safeParse('nope').success).toBe(false)
  })

  it('rejects a wrong-shaped field', () => {
    expect(statuspageWebhookSchema.safeParse({ page: 'oops' }).success).toBe(false)
    expect(statuspageWebhookSchema.safeParse({ incident: { components: 'nope' } }).success).toBe(false)
  })
})

describe('deriveStatuspageWebhookStatus — whole-page site', () => {
  it('grades the page status_indicator', () => {
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'none' } }, pageSite)).toBe('up')
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'minor' } }, pageSite)).toBe('degraded')
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'major' } }, pageSite)).toBe('down')
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'critical' } }, pageSite)).toBe('down')
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'maintenance' } }, pageSite)).toBe('degraded')
  })

  it('returns null when no page indicator is present', () => {
    expect(deriveStatuspageWebhookStatus({}, pageSite)).toBeNull()
    expect(deriveStatuspageWebhookStatus({ page: {} }, pageSite)).toBeNull()
  })

  it('falls back to degraded for an unknown indicator', () => {
    expect(deriveStatuspageWebhookStatus({ page: { status_indicator: 'weird' } }, pageSite)).toBe('degraded')
  })
})

describe('deriveStatuspageWebhookStatus — component site', () => {
  it('grades a component_update matched by the component object name', () => {
    expect(deriveStatuspageWebhookStatus(componentUpdatePayload, componentSite)).toBe('down')
  })

  it('grades a component matched by id', () => {
    expect(deriveStatuspageWebhookStatus(componentUpdatePayload, componentById)).toBe('down')
  })

  it('matches the component name case-insensitively', () => {
    const payload = { component: { name: 'CLAUDE API (API.ANTHROPIC.COM)', status: 'operational' } }
    expect(deriveStatuspageWebhookStatus(payload, componentSite)).toBe('up')
  })

  it('falls back to component_update.new_status when only the id is present', () => {
    const payload = { component_update: { component_id: 'abc', new_status: 'partial_outage' } }
    expect(deriveStatuspageWebhookStatus(payload, componentById)).toBe('degraded')
  })

  it('prefers the component object over component_update when they conflict', () => {
    // Both branches match the same site; the `component` object is checked
    // first, so its status must win. Conflicting values lock in that precedence
    // (a shared value would pass regardless of which branch fired).
    const payload = {
      component_update: { component_id: 'abc', new_status: 'major_outage' },
      component: { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'operational' },
    }
    expect(deriveStatuspageWebhookStatus(payload, componentById)).toBe('up')
  })

  it('grades a component found inside incident.components[]', () => {
    expect(deriveStatuspageWebhookStatus(incidentPayload, componentSite)).toBe('degraded')
    expect(deriveStatuspageWebhookStatus(incidentPayload, componentById)).toBe('degraded')
  })

  it('returns null when the event is about a different component', () => {
    const other = {
      component_update: { component_id: 'def', new_status: 'major_outage' },
      component: { id: 'def', name: 'claude.ai', status: 'major_outage' },
    }
    expect(deriveStatuspageWebhookStatus(other, componentSite)).toBeNull()
  })

  it('falls back to degraded for an unknown component status', () => {
    // The "never silently up" guarantee must hold on every branch that maps a
    // component status, not just the `component` object: exercise the
    // component_update and incident.components paths with an unknown string too.
    const viaComponent = { component: { id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'weird' } }
    expect(deriveStatuspageWebhookStatus(viaComponent, componentSite)).toBe('degraded')

    const viaUpdate = { component_update: { component_id: 'abc', new_status: 'weird' } }
    expect(deriveStatuspageWebhookStatus(viaUpdate, componentById)).toBe('degraded')

    const viaIncident = { incident: { components: [{ id: 'abc', name: 'Claude API (api.anthropic.com)', status: 'weird' }] } }
    expect(deriveStatuspageWebhookStatus(viaIncident, componentSite)).toBe('degraded')
  })
})

import { describe, expect, it } from 'bun:test'
import { deriveSentryWebhookStatus, sentryWebhookSchema } from './sentry-webhook'

/** An issue-alert webhook body: an uptime issue was created (monitor failing). */
const createdPayload = {
  action: 'created',
  data: { issue: { id: '123', status: 'unresolved', title: 'Uptime check failed for example.com' } },
}

/** A resolved webhook body: the uptime issue recovered. */
const resolvedPayload = {
  action: 'resolved',
  data: { issue: { id: '123', status: 'resolved', title: 'Uptime check failed for example.com' } },
}

/** A metric/alert-rule webhook body: the alert triggered (carries data.event, not issue). */
const triggeredPayload = {
  action: 'triggered',
}

describe('sentryWebhookSchema', () => {
  it('accepts a created issue payload', () => {
    expect(sentryWebhookSchema.safeParse(createdPayload).success).toBe(true)
  })

  it('accepts a resolved issue payload', () => {
    expect(sentryWebhookSchema.safeParse(resolvedPayload).success).toBe(true)
  })

  it('accepts an empty object (all fields optional)', () => {
    expect(sentryWebhookSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a non-object body', () => {
    expect(sentryWebhookSchema.safeParse(null).success).toBe(false)
    expect(sentryWebhookSchema.safeParse('nope').success).toBe(false)
  })

  it('rejects a wrong-shaped field', () => {
    expect(sentryWebhookSchema.safeParse({ data: 'oops' }).success).toBe(false)
    expect(sentryWebhookSchema.safeParse({ data: { issue: 'nope' } }).success).toBe(false)
  })
})

describe('deriveSentryWebhookStatus', () => {
  it('maps a created/unresolved issue to down', () => {
    expect(deriveSentryWebhookStatus(createdPayload)).toBe('down')
  })

  it('maps a resolved issue to up', () => {
    expect(deriveSentryWebhookStatus(resolvedPayload)).toBe('up')
  })

  it('maps a triggered alert to down', () => {
    expect(deriveSentryWebhookStatus(triggeredPayload)).toBe('down')
  })

  it('maps a resolved action to up even without a status field', () => {
    expect(deriveSentryWebhookStatus({ action: 'resolved' })).toBe('up')
  })

  it('maps an unresolved status to down even without an action', () => {
    expect(deriveSentryWebhookStatus({ data: { issue: { status: 'unresolved' } } })).toBe('down')
  })

  it('returns null for an ignored/muted issue (leave status untouched)', () => {
    expect(deriveSentryWebhookStatus({ action: 'ignored', data: { issue: { status: 'ignored' } } })).toBeNull()
  })

  it('returns null for an unrecognized action with no status', () => {
    expect(deriveSentryWebhookStatus({ action: 'assigned' })).toBeNull()
    expect(deriveSentryWebhookStatus({})).toBeNull()
  })
})

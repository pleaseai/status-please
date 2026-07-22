import { describe, expect, it } from 'bun:test'
import { parseWebhookPath, timingSafeEqual } from './webhook'

describe('parseWebhookPath', () => {
  it('extracts the provider + slug from a statuspage route', () => {
    expect(parseWebhookPath('/webhooks/statuspage/claude-api')).toEqual({ provider: 'statuspage', slug: 'claude-api' })
  })

  it('extracts the provider + slug from a sentry route', () => {
    expect(parseWebhookPath('/webhooks/sentry/api')).toEqual({ provider: 'sentry', slug: 'api' })
  })

  it('ignores a trailing slash', () => {
    expect(parseWebhookPath('/webhooks/statuspage/claude/')).toEqual({ provider: 'statuspage', slug: 'claude' })
  })

  it('returns null for a missing slug', () => {
    expect(parseWebhookPath('/webhooks/statuspage')).toBeNull()
    expect(parseWebhookPath('/webhooks/statuspage/')).toBeNull()
    expect(parseWebhookPath('/webhooks/sentry/')).toBeNull()
  })

  it('returns null for an unrelated path or unknown provider', () => {
    expect(parseWebhookPath('/')).toBeNull()
    expect(parseWebhookPath('/webhooks/other/claude')).toBeNull()
    expect(parseWebhookPath('/webhooks/statuspage/claude/extra')).toBeNull()
  })
})

describe('timingSafeEqual', () => {
  it('is true for equal strings', () => {
    expect(timingSafeEqual('s3cret-token', 's3cret-token')).toBe(true)
  })

  it('is false for different strings of equal length', () => {
    expect(timingSafeEqual('s3cret-token', 's3cret-tokeX')).toBe(false)
  })

  it('is false when lengths differ', () => {
    expect(timingSafeEqual('short', 'longer-secret')).toBe(false)
  })

  it('is true for two empty strings', () => {
    // Guarded separately at the call site (an unset WEBHOOK_SECRET → 401); this
    // documents the raw comparison contract.
    expect(timingSafeEqual('', '')).toBe(true)
  })
})

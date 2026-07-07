import { describe, expect, it } from 'bun:test'
import { configSchema, notificationsSchema, parseConfig } from './config'

const baseYaml = `
name: Example Status
sites:
  - name: Example
    url: https://example.com
`

describe('parseConfig', () => {
  it('parses a minimal config and slugifies site names', () => {
    const config = parseConfig(baseYaml)
    expect(config.name).toBe('Example Status')
    expect(config.sites[0]?.slug).toBe('example')
  })

  it('leaves notifications undefined when the block is absent', () => {
    expect(parseConfig(baseYaml).notifications).toBeUndefined()
  })

  it('accepts a valid explicit slug', () => {
    const config = parseConfig(`${baseYaml}    slug: my-api\n`)
    expect(config.sites[0]?.slug).toBe('my-api')
  })

  it('rejects an explicit slug with Cache-Tag-unsafe characters', () => {
    // A comma would split the Cache-Tag header into bogus tags.
    expect(() => parseConfig(`${baseYaml}    slug: my,service\n`)).toThrow()
  })
})

describe('notificationsSchema', () => {
  it('accepts a valid slack webhook and generic webhooks', () => {
    const parsed = notificationsSchema.parse({
      slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
      webhooks: [{ url: 'https://example.com/hook' }],
    })
    expect(parsed.slack?.webhookUrl).toBe('https://hooks.slack.com/services/T/B/X')
    expect(parsed.webhooks).toHaveLength(1)
  })

  it('accepts an empty object (all fields optional)', () => {
    expect(notificationsSchema.parse({})).toEqual({})
  })

  it('rejects an invalid slack webhook URL', () => {
    expect(() => notificationsSchema.parse({ slack: { webhookUrl: 'not-a-url' } })).toThrow()
  })

  it('rejects an invalid generic webhook URL', () => {
    expect(() => notificationsSchema.parse({ webhooks: [{ url: 'nope' }] })).toThrow()
  })
})

describe('configSchema with notifications', () => {
  it('parses a config that includes a notifications block', () => {
    const config = configSchema.parse({
      name: 'Example Status',
      sites: [{ name: 'Example', url: 'https://example.com' }],
      notifications: { slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' } },
    })
    expect(config.notifications?.slack?.webhookUrl).toBe(
      'https://hooks.slack.com/services/T/B/X',
    )
  })

  it('rejects a config with an invalid webhook URL', () => {
    expect(() =>
      configSchema.parse({
        name: 'Example Status',
        sites: [{ name: 'Example', url: 'https://example.com' }],
        notifications: { webhooks: [{ url: 'bad' }] },
      }),
    ).toThrow()
  })
})

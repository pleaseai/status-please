import { describe, expect, it } from 'bun:test'
import { buildStatusChangePayload, toSlackMessage } from './notify'

const timestamp = '2026-07-07T00:00:00.000Z'

describe('buildStatusChangePayload', () => {
  it('carries the timestamp and changes through unchanged', () => {
    const changes = [{ slug: 'api', from: 'up', to: 'down' } as const]
    const payload = buildStatusChangePayload(changes, timestamp)
    expect(payload.timestamp).toBe(timestamp)
    expect(payload.changes).toEqual(changes)
  })

  it('rolls up the worst resulting status as severity', () => {
    expect(
      buildStatusChangePayload(
        [
          { slug: 'a', from: 'up', to: 'degraded' },
          { slug: 'b', from: 'up', to: 'down' },
        ],
        timestamp,
      ).severity,
    ).toBe('major_outage')

    expect(
      buildStatusChangePayload([{ slug: 'a', from: 'down', to: 'up' }], timestamp).severity,
    ).toBe('operational')
  })

  it('is operational for an empty change list', () => {
    expect(buildStatusChangePayload([], timestamp).severity).toBe('operational')
  })
})

describe('toSlackMessage', () => {
  it('summarises a single change with a from → to line', () => {
    const message = toSlackMessage(
      buildStatusChangePayload([{ slug: 'api', from: 'up', to: 'down' }], timestamp),
    )
    expect(message.text).toContain('Status changed for 1 service')
    expect(message.text).toContain('*api*: up → down')
    expect(message.blocks.length).toBeGreaterThan(0)
  })

  it('pluralises and lists every change', () => {
    const message = toSlackMessage(
      buildStatusChangePayload(
        [
          { slug: 'api', from: 'up', to: 'down' },
          { slug: 'web', from: 'up', to: 'degraded' },
        ],
        timestamp,
      ),
    )
    expect(message.text).toContain('Status changed for 2 services')
    expect(message.text).toContain('*api*: up → down')
    expect(message.text).toContain('*web*: up → degraded')
  })
})

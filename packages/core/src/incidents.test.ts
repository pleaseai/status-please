import type { Incident, IncidentState, IncidentUpdate } from './incidents'
import { describe, expect, it } from 'bun:test'
import { isActive, latestState, latestUpdate, orderedUpdates, relativeTime } from './incidents'

function update(id: number, state: IncidentState, createdAt: string): IncidentUpdate {
  return { id, incidentId: 1, state, body: `${state} at ${createdAt}`, createdAt }
}

function incident(updates: IncidentUpdate[], resolvedAt: string | null = null): Incident {
  return {
    id: 1,
    slug: 'api',
    title: 'Elevated error rates',
    severity: 'major_outage',
    startedAt: '2026-01-01T00:00:00.000Z',
    resolvedAt,
    updates,
  }
}

describe('orderedUpdates', () => {
  it('sorts updates oldest → newest without mutating the input', () => {
    const updates = [
      update(2, 'identified', '2026-01-01T02:00:00.000Z'),
      update(1, 'investigating', '2026-01-01T01:00:00.000Z'),
      update(3, 'resolved', '2026-01-01T03:00:00.000Z'),
    ]
    const ordered = orderedUpdates(incident(updates))
    expect(ordered.map(u => u.id)).toEqual([1, 2, 3])
    // Original array order is preserved (non-mutating).
    expect(updates.map(u => u.id)).toEqual([2, 1, 3])
  })

  it('returns [] when a KV record is missing updates (no crash)', () => {
    const broken = { ...incident([]), updates: undefined } as unknown as Incident
    expect(orderedUpdates(broken)).toEqual([])
  })
})

describe('latestUpdate', () => {
  it('returns the most recent update', () => {
    const updates = [
      update(1, 'investigating', '2026-01-01T01:00:00.000Z'),
      update(2, 'monitoring', '2026-01-01T02:00:00.000Z'),
    ]
    expect(latestUpdate(incident(updates))?.id).toBe(2)
  })

  it('is undefined when there are no updates', () => {
    expect(latestUpdate(incident([]))).toBeUndefined()
  })
})

describe('latestState', () => {
  it('is the state of the latest update', () => {
    const updates = [
      update(1, 'investigating', '2026-01-01T01:00:00.000Z'),
      update(2, 'monitoring', '2026-01-01T02:00:00.000Z'),
    ]
    expect(latestState(incident(updates))).toBe('monitoring')
  })

  it('falls back to resolved/investigating when there are no updates', () => {
    expect(latestState(incident([], '2026-01-01T04:00:00.000Z'))).toBe('resolved')
    expect(latestState(incident([]))).toBe('investigating')
  })
})

describe('isActive', () => {
  it('is active while unresolved and the latest state is not resolved', () => {
    const updates = [update(1, 'identified', '2026-01-01T01:00:00.000Z')]
    expect(isActive(incident(updates))).toBe(true)
  })

  it('is inactive once resolvedAt is set', () => {
    const updates = [update(1, 'resolved', '2026-01-01T03:00:00.000Z')]
    expect(isActive(incident(updates, '2026-01-01T03:00:00.000Z'))).toBe(false)
  })

  it('is inactive when the latest update is resolved even without resolvedAt', () => {
    const updates = [update(1, 'resolved', '2026-01-01T03:00:00.000Z')]
    expect(isActive(incident(updates))).toBe(false)
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-01-02T00:00:00.000Z').getTime()

  it('reports seconds as "just now"', () => {
    expect(relativeTime('2026-01-01T23:59:30.000Z', now)).toBe('just now')
  })

  it('reports minutes, hours, and days', () => {
    expect(relativeTime('2026-01-01T23:45:00.000Z', now)).toBe('15m ago')
    expect(relativeTime('2026-01-01T21:00:00.000Z', now)).toBe('3h ago')
    expect(relativeTime('2025-12-30T00:00:00.000Z', now)).toBe('3d ago')
  })

  it('falls back to the raw string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', now)).toBe('not-a-date')
  })

  it('localizes non-English locales via Intl.RelativeTimeFormat', () => {
    // Exact wording is ICU-provided; assert it differs from the English form and
    // carries the localized number so a regression in wiring is caught.
    expect(relativeTime('2026-01-01T23:45:00.000Z', now, 'ko')).toContain('15')
    expect(relativeTime('2026-01-01T23:45:00.000Z', now, 'ko')).not.toBe('15m ago')
    expect(relativeTime('2026-01-01T21:00:00.000Z', now, 'ja')).toContain('3')
    expect(relativeTime('2026-01-01T21:00:00.000Z', now, 'ja')).not.toBe('3h ago')
  })
})

import type { DayStat } from './types'
import { describe, expect, it } from 'bun:test'
import { formatUptime, overallSeverity, toSeverity, windowUptime } from './types'

function day(status: DayStat['status'], uptime: number): DayStat {
  return { date: '2026-01-01', status, uptime }
}

describe('toSeverity', () => {
  it('maps check statuses to display severities', () => {
    expect(toSeverity('up')).toBe('operational')
    expect(toSeverity('degraded')).toBe('degraded')
    expect(toSeverity('down')).toBe('major_outage')
  })
})

describe('overallSeverity', () => {
  it('is operational when everything is up', () => {
    expect(overallSeverity(['up', 'up'])).toBe('operational')
  })

  it('picks the worst status (down beats degraded)', () => {
    expect(overallSeverity(['up', 'degraded', 'down'])).toBe('major_outage')
    expect(overallSeverity(['up', 'degraded'])).toBe('degraded')
  })

  it('is operational for an empty list', () => {
    expect(overallSeverity([])).toBe('operational')
  })
})

describe('windowUptime', () => {
  it('averages the uptime of days that have data', () => {
    expect(windowUptime([day('up', 1), day('degraded', 0.98)])).toBeCloseTo(0.99)
  })

  it('ignores no-data days', () => {
    // Only the two data days count; the null day is excluded.
    expect(windowUptime([day('up', 1), day(null, 1), day('down', 0)])).toBeCloseTo(0.5)
  })

  it('returns 1 when the window is empty or entirely no-data', () => {
    expect(windowUptime([])).toBe(1)
    expect(windowUptime([day(null, 1), day(null, 1)])).toBe(1)
  })
})

describe('formatUptime', () => {
  it('formats a ratio as a two-decimal percentage', () => {
    expect(formatUptime(0.9998)).toBe('99.98%')
    expect(formatUptime(0.9)).toBe('90.00%')
  })

  it('collapses a rounded 100 to "100%"', () => {
    expect(formatUptime(1)).toBe('100%')
    expect(formatUptime(0.99999)).toBe('100%')
  })
})

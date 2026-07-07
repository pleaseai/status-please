import type { SiteSummary } from './types'
import { overallSeverity, toSeverity } from './types'

/**
 * A shields.io [endpoint badge](https://shields.io/badges/endpoint-badge)
 * response. Users point `https://img.shields.io/endpoint?url=<our JSON URL>` at
 * one of the `/api/badge/*` routes and shields.io renders the SVG — so we never
 * generate images ourselves, only this small JSON contract.
 */
export interface ShieldsEndpoint {
  /** Always `1`; the only schema shields.io currently understands. */
  schemaVersion: 1
  /** Left side of the badge. */
  label: string
  /** Right side of the badge. */
  message: string
  /** Right-side background: a shields named color or `rrggbb` hex. */
  color: string
}

/** Uptime window a badge can report; mirrors the SiteSummary trailing fields. */
export type UptimePeriod = 'day' | 'week' | 'month'

/** Map a display severity to a shields.io badge color. */
export function severityColor(status: SiteSummary['status']): string {
  switch (toSeverity(status)) {
    case 'operational':
      return 'brightgreen'
    case 'degraded':
      return 'yellow'
    case 'partial_outage':
      return 'orange'
    case 'major_outage':
      return 'red'
    case 'maintenance':
      return 'blue'
  }
}

/** Human-readable badge message for a site's current status. */
export function statusMessage(status: SiteSummary['status']): string {
  switch (status) {
    case 'up':
      return 'up'
    case 'degraded':
      return 'degraded'
    case 'down':
      return 'down'
  }
}

/**
 * Badge color for an uptime ratio (0..1), from healthy (green) to poor (red).
 * Thresholds match common status-page conventions (three nines is excellent).
 */
export function uptimeColor(ratio: number): string {
  if (ratio >= 0.999) {
    return 'brightgreen'
  }
  if (ratio >= 0.99) {
    return 'green'
  }
  if (ratio >= 0.95) {
    return 'yellow'
  }
  if (ratio >= 0.9) {
    return 'orange'
  }
  return 'red'
}

/**
 * Badge color for a response time in ms, from fast (green) to slow (red).
 * Lower is better, so the scale is inverted relative to {@link uptimeColor}.
 */
export function responseColor(ms: number): string {
  if (ms <= 200) {
    return 'brightgreen'
  }
  if (ms <= 500) {
    return 'green'
  }
  if (ms <= 1000) {
    return 'yellowgreen'
  }
  if (ms <= 2000) {
    return 'yellow'
  }
  if (ms <= 4000) {
    return 'orange'
  }
  return 'red'
}

/**
 * Parse a formatted uptime string (e.g. `"99.98%"`, `"100%"`) back to a ratio
 * (0..1). Returns `1` for anything unparseable so a malformed snapshot degrades
 * to a green badge rather than throwing on the request path.
 */
export function parseUptimePercent(display: string): number {
  const pct = Number.parseFloat(display)
  return Number.isFinite(pct) ? pct / 100 : 1
}

/** The trailing uptime display string a `SiteSummary` holds for `period`. */
function uptimeDisplay(site: SiteSummary, period: UptimePeriod): string {
  switch (period) {
    case 'day':
      return site.uptimeDay
    case 'week':
      return site.uptimeWeek
    case 'month':
      return site.uptimeMonth
  }
}

/** Status badge for one site: `<name> | up|degraded|down`. */
export function statusBadge(site: SiteSummary): ShieldsEndpoint {
  return {
    schemaVersion: 1,
    label: site.name,
    message: statusMessage(site.status),
    color: severityColor(site.status),
  }
}

/**
 * Overall status badge across every site (worst status wins). Label is
 * `status`; message is `operational` when all up, else the worst severity.
 */
export function overallBadge(summary: SiteSummary[]): ShieldsEndpoint {
  const severity = overallSeverity(summary.map(s => s.status))
  const message = severity === 'operational'
    ? 'operational'
    : severity === 'major_outage'
      ? 'major outage'
      : severity.replace(/_/g, ' ')
  // Color keys off the worst site's raw status so severityColor's mapping is reused.
  const worst = summary.find(s => s.status === 'down')
    ?? summary.find(s => s.status === 'degraded')
    ?? summary[0]
  return {
    schemaVersion: 1,
    label: 'status',
    message,
    color: worst ? severityColor(worst.status) : 'brightgreen',
  }
}

/** Uptime badge for one site over `period` (default `month`). */
export function uptimeBadge(site: SiteSummary, period: UptimePeriod = 'month'): ShieldsEndpoint {
  const display = uptimeDisplay(site, period)
  return {
    schemaVersion: 1,
    label: 'uptime',
    message: display,
    color: uptimeColor(parseUptimePercent(display)),
  }
}

/** Response-time badge for one site: `response time | <n>ms`. */
export function responseBadge(site: SiteSummary): ShieldsEndpoint {
  return {
    schemaVersion: 1,
    label: 'response time',
    message: `${site.responseTime}ms`,
    color: responseColor(site.responseTime),
  }
}

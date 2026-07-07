/** Raw verdict of a single check run. */
export type CheckStatus = 'up' | 'degraded' | 'down'

/** Display severity rolled up for the status page (superset of CheckStatus). */
export type Severity
  = | 'operational'
    | 'degraded'
    | 'partial_outage'
    | 'major_outage'
    | 'maintenance'

/** One check data point for one site. */
export interface CheckResult {
  slug: string
  status: CheckStatus
  /** HTTP status code (0 when the request never completed). */
  code: number
  /** Round-trip time in milliseconds. */
  responseTime: number
  /** ISO-8601 timestamp of when the check ran. */
  checkedAt: string
  /** Present when the check failed to complete. */
  error?: string
}

/** One calendar day's rolled-up outcome, for the 90-day timeline. */
export interface DayStat {
  /** ISO date, `YYYY-MM-DD` (UTC). */
  date: string
  /** Worst status seen that day; `null` when no checks ran (no data). */
  status: CheckStatus | null
  /** Fraction of checks that were `up` (0..1). `1` for a no-data day. */
  uptime: number
}

/** Aggregated current state for one site, served to the status page. */
export interface SiteSummary {
  slug: string
  name: string
  status: CheckStatus
  responseTime: number
  /** Trailing uptime percentages as display strings, e.g. "99.98%". */
  uptimeDay: string
  uptimeWeek: string
  uptimeMonth: string
  /** Per-day history, oldest → newest, up to 90 entries. */
  history: DayStat[]
}

/** Map CheckStatus → the display severity used by the banner and badges. */
export function toSeverity(status: CheckStatus): Severity {
  switch (status) {
    case 'up':
      return 'operational'
    case 'degraded':
      return 'degraded'
    case 'down':
      return 'major_outage'
  }
}

/** Roll up many site statuses into one overall severity (worst wins). */
export function overallSeverity(statuses: CheckStatus[]): Severity {
  if (statuses.includes('down')) {
    return 'major_outage'
  }
  if (statuses.includes('degraded')) {
    return 'degraded'
  }
  return 'operational'
}

/**
 * Average uptime over a day-stat window, ignoring no-data days. Returns `1`
 * when the window is empty or entirely no-data (nothing to report against).
 */
export function windowUptime(history: DayStat[]): number {
  const days = history.filter(d => d.status !== null)
  if (days.length === 0) {
    return 1
  }
  return days.reduce((sum, d) => sum + d.uptime, 0) / days.length
}

/** Format an uptime ratio (0..1) as a display percentage, e.g. "99.98%". */
export function formatUptime(ratio: number): string {
  const pct = ratio * 100
  // Avoid "100.00%" when a rounded value reaches 100.
  return pct >= 99.995 ? '100%' : `${pct.toFixed(2)}%`
}

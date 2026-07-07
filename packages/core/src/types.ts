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

import type { Severity } from './types'

/** Lifecycle state of an incident, mirrored by `incident_updates.state` in D1. */
export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved'

/**
 * One post in an incident's timeline (a row of `incident_updates`). Each update
 * moves — or reaffirms — the lifecycle state and carries a human-readable body.
 */
export interface IncidentUpdate {
  id: number
  /** FK to the owning {@link Incident}. */
  incidentId: number
  state: IncidentState
  /** Operator message shown to readers. */
  body: string
  /** ISO-8601 timestamp of when the update was posted. */
  createdAt: string
}

/**
 * An incident and its timeline (a row of `incidents` plus its `incident_updates`).
 * `resolvedAt` is `null` while the incident is ongoing.
 */
export interface Incident {
  id: number
  /** Slug of the affected site (matches `SiteSummary.slug`). */
  slug: string
  title: string
  /** Display severity, reusing the page's severity palette. */
  severity: Severity
  /** ISO-8601 timestamp of when the incident began. */
  startedAt: string
  /** ISO-8601 timestamp of resolution, or `null` while ongoing. */
  resolvedAt: string | null
  updates: IncidentUpdate[]
}

/** An incident's updates in chronological order (oldest → newest), non-mutating. */
export function orderedUpdates(incident: Incident): IncidentUpdate[] {
  // Defensive against a KV payload missing `updates` (only type-asserted, not
  // validated) — a bad record must not crash the SSR render.
  return [...(incident.updates ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

/** The most recent update, or `undefined` when the incident has none. */
export function latestUpdate(incident: Incident): IncidentUpdate | undefined {
  return orderedUpdates(incident).at(-1)
}

/**
 * The incident's current lifecycle state: the state of its latest update, or —
 * when it has no updates — `resolved` if `resolvedAt` is set, else `investigating`.
 */
export function latestState(incident: Incident): IncidentState {
  const last = latestUpdate(incident)
  if (last) {
    return last.state
  }
  return incident.resolvedAt !== null ? 'resolved' : 'investigating'
}

/** True while the incident is ongoing (not yet resolved). */
export function isActive(incident: Incident): boolean {
  return incident.resolvedAt === null && latestState(incident) !== 'resolved'
}

/**
 * Format an ISO timestamp as a short relative string (e.g. "5m ago", "3h ago").
 * `now` is injectable so callers and tests stay deterministic.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) {
    return iso
  }
  const diffSec = Math.floor((now - ts) / 1000)
  if (diffSec < 60) {
    return 'just now'
  }
  const min = Math.floor(diffSec / 60)
  if (min < 60) {
    return `${min}m ago`
  }
  const hr = Math.floor(min / 60)
  if (hr < 24) {
    return `${hr}h ago`
  }
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

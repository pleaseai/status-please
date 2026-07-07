import type { Incident, IncidentState, Severity } from '@status-please/core'
import { isActive, orderedUpdates, relativeTime } from '@status-please/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const SEVERITY = {
  operational: { label: 'Operational', badge: 'border-status-operational/40 text-status-operational' },
  degraded: { label: 'Degraded', badge: 'border-status-degraded/40 text-status-degraded' },
  partial_outage: { label: 'Partial Outage', badge: 'border-status-partial/40 text-status-partial' },
  major_outage: { label: 'Major Outage', badge: 'border-status-major/40 text-status-major' },
  maintenance: { label: 'Maintenance', badge: 'border-status-maintenance/40 text-status-maintenance' },
} satisfies Record<Severity, { label: string, badge: string }>

const STATE = {
  investigating: { label: 'Investigating', badge: 'border-status-major/40 text-status-major' },
  identified: { label: 'Identified', badge: 'border-status-partial/40 text-status-partial' },
  monitoring: { label: 'Monitoring', badge: 'border-status-maintenance/40 text-status-maintenance' },
  resolved: { label: 'Resolved', badge: 'border-status-operational/40 text-status-operational' },
} satisfies Record<IncidentState, { label: string, badge: string }>

/** Sort incidents by recency: active ones by start, resolved ones by resolution. */
function byRecency(a: Incident, b: Incident): number {
  const at = new Date(a.resolvedAt ?? a.startedAt).getTime()
  const bt = new Date(b.resolvedAt ?? b.startedAt).getTime()
  return bt - at
}

/** One incident card: title + severity badge, then its chronological updates. */
function IncidentCard({ incident }: { incident: Incident }) {
  const sev = SEVERITY[incident.severity]
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{incident.title}</CardTitle>
          <Badge variant="outline" className={cn('shrink-0', sev.badge)}>
            {sev.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4 border-l border-border pl-4">
          {orderedUpdates(incident).map((u) => {
            const state = STATE[u.state]
            return (
              <li key={u.id}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={state.badge}>
                    {state.label}
                  </Badge>
                  <time className="text-xs tabular-nums text-muted-foreground" dateTime={u.createdAt}>
                    {relativeTime(u.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{u.body}</p>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * Incident timeline: active incidents surface first, recently resolved ones
 * below a muted divider. Each card lists the incident's updates in chronological
 * order (state badge + body + relative time). Static — it renders to HTML with
 * 0 JS (relative times are computed at edge render). Calm empty state when none.
 */
export function IncidentList({ incidents }: { incidents: Incident[] }) {
  const active = incidents.filter(isActive).sort(byRecency)
  const resolved = incidents.filter(i => !isActive(i)).sort(byRecency)

  if (active.length === 0 && resolved.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No incidents reported in the last 90 days.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {active.map(incident => (
        <IncidentCard key={incident.id} incident={incident} />
      ))}

      {resolved.length > 0 && (
        <>
          {active.length > 0 && (
            <p className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Recently resolved
            </p>
          )}
          {resolved.map(incident => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </>
      )}
    </div>
  )
}

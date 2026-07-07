import type { Dict, Incident, IncidentState, Locale, Severity } from '@status-please/core'
import { getDict, isActive, orderedUpdates, relativeTime } from '@status-please/core'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Status-token styling; label text comes from the locale dict.
const SEVERITY_BADGE = {
  operational: 'border-status-operational/40 text-status-operational',
  degraded: 'border-status-degraded/40 text-status-degraded',
  partial_outage: 'border-status-partial/40 text-status-partial',
  major_outage: 'border-status-major/40 text-status-major',
  maintenance: 'border-status-maintenance/40 text-status-maintenance',
} satisfies Record<Severity, string>

const STATE_BADGE = {
  investigating: 'border-status-major/40 text-status-major',
  identified: 'border-status-partial/40 text-status-partial',
  monitoring: 'border-status-maintenance/40 text-status-maintenance',
  resolved: 'border-status-operational/40 text-status-operational',
} satisfies Record<IncidentState, string>

/** Sort incidents by recency: active ones by start, resolved ones by resolution. */
function byRecency(a: Incident, b: Incident): number {
  const at = new Date(a.resolvedAt ?? a.startedAt).getTime()
  const bt = new Date(b.resolvedAt ?? b.startedAt).getTime()
  return bt - at
}

/** One incident card: title + severity badge, then its chronological updates. */
function IncidentCard({ incident, locale, t }: Readonly<{ incident: Incident, locale: Locale, t: Dict }>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{incident.title}</CardTitle>
          <Badge variant="outline" className={cn('shrink-0', SEVERITY_BADGE[incident.severity])}>
            {t.severity[incident.severity]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4 border-l border-border pl-4">
          {orderedUpdates(incident).map((u) => {
            return (
              <li key={u.id}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={STATE_BADGE[u.state]}>
                    {t.state[u.state]}
                  </Badge>
                  <time className="text-xs tabular-nums text-muted-foreground" dateTime={u.createdAt}>
                    {relativeTime(u.createdAt, undefined, locale)}
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
export function IncidentList({ incidents, locale }: Readonly<{ incidents: Incident[], locale: Locale }>) {
  const t = getDict(locale)
  const active = incidents.filter(isActive).sort(byRecency)
  const resolved = incidents.filter(i => !isActive(i)).sort(byRecency)

  if (active.length === 0 && resolved.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t.incidents.none}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {active.map(incident => (
        <IncidentCard key={incident.id} incident={incident} locale={locale} t={t} />
      ))}

      {resolved.length > 0 && (
        <>
          {active.length > 0 && (
            <p className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t.incidents.recentlyResolved}
            </p>
          )}
          {resolved.map(incident => (
            <IncidentCard key={incident.id} incident={incident} locale={locale} t={t} />
          ))}
        </>
      )}
    </div>
  )
}

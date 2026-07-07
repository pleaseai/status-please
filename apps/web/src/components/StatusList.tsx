import type { SiteSummary } from '@status-please/core'
import { formatUptime, toSeverity, windowUptime } from '@status-please/core'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { UptimeTimeline } from './UptimeTimeline'

const SEVERITY = {
  operational: { label: 'Operational', dot: 'bg-status-operational', badge: 'border-status-operational/40 text-status-operational' },
  degraded: { label: 'Degraded', dot: 'bg-status-degraded', badge: 'border-status-degraded/40 text-status-degraded' },
  partial_outage: { label: 'Partial Outage', dot: 'bg-status-partial', badge: 'border-status-partial/40 text-status-partial' },
  major_outage: { label: 'Major Outage', dot: 'bg-status-major', badge: 'border-status-major/40 text-status-major' },
  maintenance: { label: 'Maintenance', dot: 'bg-status-maintenance', badge: 'border-status-maintenance/40 text-status-maintenance' },
} as const

/**
 * Per-component status cards: name + rolled-up badge, a 90-day uptime timeline,
 * and the 90-day uptime figure (hover for the 24h/7d/30d breakdown). Interactive
 * (the breakdown tooltip), so it hydrates as a React island.
 */
export function StatusList({ summary }: { summary: SiteSummary[] }) {
  return (
    <TooltipProvider delay={100}>
      <Card className="gap-0 divide-y divide-border overflow-hidden py-0">
        {summary.map((site) => {
          const meta = SEVERITY[toSeverity(site.status)]
          return (
            <div key={site.slug} className="px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={cn('inline-block size-2.5 rounded-full', meta.dot)} />
                  <span className="font-medium">{site.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Tooltip>
                    <TooltipTrigger
                      render={(
                        <span
                          tabIndex={0}
                          className="cursor-default rounded-sm text-sm tabular-nums text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      )}
                    >
                      {formatUptime(windowUptime(site.history))}
                    </TooltipTrigger>
                    <TooltipContent>
                      24h
                      {' '}
                      {site.uptimeDay}
                      {' '}
                      · 7d
                      {' '}
                      {site.uptimeWeek}
                      {' '}
                      · 30d
                      {' '}
                      {site.uptimeMonth}
                    </TooltipContent>
                  </Tooltip>
                  <Badge variant="outline" className={meta.badge}>
                    {meta.label}
                  </Badge>
                </div>
              </div>
              <div className="mt-3">
                <UptimeTimeline history={site.history} />
              </div>
            </div>
          )
        })}
      </Card>
    </TooltipProvider>
  )
}

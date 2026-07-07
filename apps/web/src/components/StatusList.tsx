import type { SiteSummary } from '@status-please/core'
import { toSeverity } from '@status-please/core'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SEVERITY = {
  operational: { label: 'Operational', dot: 'bg-status-operational', badge: 'border-status-operational/40 text-status-operational' },
  degraded: { label: 'Degraded', dot: 'bg-status-degraded', badge: 'border-status-degraded/40 text-status-degraded' },
  partial_outage: { label: 'Partial Outage', dot: 'bg-status-partial', badge: 'border-status-partial/40 text-status-partial' },
  major_outage: { label: 'Major Outage', dot: 'bg-status-major', badge: 'border-status-major/40 text-status-major' },
  maintenance: { label: 'Maintenance', dot: 'bg-status-maintenance', badge: 'border-status-maintenance/40 text-status-maintenance' },
} as const

/**
 * Component rows for the status page. Interactive (uptime tooltips), so it
 * hydrates as a React island; the rest of the page stays static.
 */
export function StatusList({ summary }: { summary: SiteSummary[] }) {
  return (
    <TooltipProvider delay={100}>
      <Card className="gap-0 divide-y divide-border overflow-hidden py-0">
        {summary.map((site) => {
          const meta = SEVERITY[toSeverity(site.status)]
          return (
            <div key={site.slug} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <span className={cn('inline-block size-2.5 rounded-full', meta.dot)} />
                <span className="font-medium">{site.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="cursor-default text-sm tabular-nums text-muted-foreground" />
                    }
                  >
                    {site.uptimeMonth}
                  </TooltipTrigger>
                  <TooltipContent>
                    30-day uptime · avg
                    {' '}
                    {site.responseTime}
                    {' '}
                    ms
                  </TooltipContent>
                </Tooltip>
                <Badge variant="outline" className={meta.badge}>
                  {meta.label}
                </Badge>
              </div>
            </div>
          )
        })}
      </Card>
    </TooltipProvider>
  )
}

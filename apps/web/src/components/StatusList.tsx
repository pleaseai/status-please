import type { SiteSummary } from '@status-please/core'
import { formatUptime, toSeverity, windowUptime } from '@status-please/core'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ResponseChart } from './ResponseChart'
import { UptimeTimeline } from './UptimeTimeline'

const SEVERITY = {
  operational: { label: 'Operational', dot: 'bg-status-operational', badge: 'border-status-operational/40 text-status-operational' },
  degraded: { label: 'Degraded', dot: 'bg-status-degraded', badge: 'border-status-degraded/40 text-status-degraded' },
  partial_outage: { label: 'Partial Outage', dot: 'bg-status-partial', badge: 'border-status-partial/40 text-status-partial' },
  major_outage: { label: 'Major Outage', dot: 'bg-status-major', badge: 'border-status-major/40 text-status-major' },
  maintenance: { label: 'Maintenance', dot: 'bg-status-maintenance', badge: 'border-status-maintenance/40 text-status-maintenance' },
} as const

/**
 * One status card row: name + rolled-up badge, a 90-day uptime timeline, and an
 * expandable response-time sparkline. Interactive (the breakdown tooltip and the
 * expand toggle), so it lives in the hydrated island.
 */
function StatusRow({ site }: { site: SiteSummary }) {
  const [open, setOpen] = useState(false)
  const meta = SEVERITY[toSeverity(site.status)]
  // Guard against stale KV snapshots written before these fields existed.
  const history = site.history ?? []
  const responseHistory = site.responseHistory ?? []
  const uptime90 = formatUptime(windowUptime(history))
  const breakdown = `Today ${site.uptimeDay} · 7d ${site.uptimeWeek} · 30d ${site.uptimeMonth} · 90d ${uptime90}`
  return (
    <div className="px-5 py-4">
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
              {uptime90}
            </TooltipTrigger>
            <TooltipContent>{breakdown}</TooltipContent>
          </Tooltip>
          <Badge variant="outline" className={meta.badge}>
            {meta.label}
          </Badge>
        </div>
      </div>
      <div className="mt-3">
        <UptimeTimeline history={history} />
      </div>
      {responseHistory.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-sm text-xs tabular-nums text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            <span>Response time</span>
            <span>
              ·
              {' '}
              {site.responseTime}
              {' '}
              ms
            </span>
          </button>
          {open && (
            <div className="mt-2">
              <ResponseChart data={responseHistory} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Per-component status cards. Interactive (uptime tooltips + expandable
 * response-time charts), so it hydrates as a React island.
 */
export function StatusList({ summary }: { summary: SiteSummary[] }) {
  return (
    <TooltipProvider delay={100}>
      <Card className="gap-0 divide-y divide-border overflow-hidden py-0">
        {summary.map(site => (
          <StatusRow key={site.slug} site={site} />
        ))}
      </Card>
    </TooltipProvider>
  )
}

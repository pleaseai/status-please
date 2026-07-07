import type { DayStat } from '@status-please/core'
import { formatUptime, windowUptime } from '@status-please/core'
import { cn } from '@/lib/utils'

const DAY = {
  up: { color: 'bg-status-operational', label: 'Operational' },
  degraded: { color: 'bg-status-degraded', label: 'Degraded' },
  down: { color: 'bg-status-major', label: 'Outage' },
  nodata: { color: 'bg-status-nodata', label: 'No data' },
} as const

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format an ISO `YYYY-MM-DD` (UTC) as e.g. "Jul 5, 2026" without a date lib. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/**
 * 90-day uptime bar timeline. Each bar carries a native `title` for per-day
 * detail — cheap and accessible for a dense strip, and it needs no JS, so the
 * timeline renders as static HTML. Bars flex to fill the width and shrink on
 * narrow viewports (adaptive), so the full window fits without a scrollbar.
 */
export function UptimeTimeline({ history }: { history: DayStat[] }) {
  const uptime = formatUptime(windowUptime(history))
  return (
    <div>
      <div
        className="flex h-9 items-stretch gap-px"
        role="img"
        aria-label={`90-day uptime history — ${uptime} uptime`}
      >
        {history.map((d) => {
          const meta = DAY[d.status ?? 'nodata']
          return (
            <div
              key={d.date}
              title={`${formatDate(d.date)} — ${meta.label} · ${formatUptime(d.uptime)}`}
              className={cn(
                'min-w-[2px] flex-1 rounded-[1px] transition-opacity hover:opacity-70',
                meta.color,
              )}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

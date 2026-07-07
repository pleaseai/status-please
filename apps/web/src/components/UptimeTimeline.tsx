import type { DayStat, Locale } from '@status-please/core'
import { formatDay, formatUptime, getDict, windowUptime } from '@status-please/core'
import { cn } from '@/lib/utils'

const DAY_COLOR = {
  up: 'bg-status-operational',
  degraded: 'bg-status-degraded',
  down: 'bg-status-major',
  nodata: 'bg-status-nodata',
} as const

/**
 * 90-day uptime bar timeline. Each bar carries a native `title` for per-day
 * detail — cheap and accessible for a dense strip, and it needs no JS, so the
 * timeline renders as static HTML. Bars flex to fill the width and shrink on
 * narrow viewports (adaptive), so the full window fits without a scrollbar.
 */
export function UptimeTimeline({ history, locale }: { history: DayStat[], locale: Locale }) {
  const t = getDict(locale)
  const uptime = formatUptime(windowUptime(history))
  return (
    <div>
      <div
        className="flex h-9 items-stretch gap-px"
        role="img"
        aria-label={t.timeline.ariaUptime(uptime)}
      >
        {history.map((d) => {
          const key = d.status ?? 'nodata'
          return (
            <div
              key={d.date}
              title={`${formatDay(d.date, locale)} — ${t.day[key]}${d.status !== null ? ` · ${formatUptime(d.uptime)}` : ''}`}
              className={cn(
                'min-w-[2px] flex-1 rounded-[1px] transition-opacity hover:opacity-70',
                DAY_COLOR[key],
              )}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{t.timeline.windowStart(90)}</span>
        <span>{t.timeline.today}</span>
      </div>
    </div>
  )
}

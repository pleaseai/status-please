import type { Locale, ResponsePoint } from '@statusbeam/core'
import type { ChartConfig } from '@/components/ui/chart'
import { averageResponse, getDict, percentileResponse } from '@statusbeam/core'
import { useId } from 'react'
import { Area, AreaChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

/** Format an ISO timestamp as a short local `HH:MM` for the tooltip header. */
function formatTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Compact response-time sparkline (area chart) over the recent window, with
 * avg/p95 summary figures. Recharts needs the DOM, so this renders in a React
 * island; it themes through the shadcn ChartContainer CSS vars.
 */
export function ResponseChart({
  data,
  locale,
  className,
}: Readonly<{
  data: ResponsePoint[]
  locale: Locale
  className?: string
}>) {
  const t = getDict(locale)
  // A single series keyed by `ms`. The color is a status token that already
  // adapts across light/dark via `light-dark()`, so the chart reads in both.
  const config = {
    ms: {
      label: t.chart.responseTime,
      color: 'var(--status-maintenance)',
    },
  } satisfies ChartConfig
  // useId() yields `:r0:`; colons are invalid in an SVG/XML id (NCName), so
  // strip them — matching the ChartContainer convention in chart.tsx.
  const fillId = `fill-${useId().replace(/:/g, '')}`
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t.chart.noData}</p>
    )
  }
  const avg = averageResponse(data)
  const p95 = percentileResponse(data, 0.95)
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-4 text-xs tabular-nums text-muted-foreground">
        <span>
          {t.chart.avg}
          {' '}
          <span className="font-medium text-foreground">
            {avg}
            {' '}
            {t.unit.ms}
          </span>
        </span>
        <span>
          {t.chart.p95}
          {' '}
          <span className="font-medium text-foreground">
            {p95}
            {' '}
            {t.unit.ms}
          </span>
        </span>
      </div>
      <ChartContainer config={config} className="aspect-auto h-20 w-full">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ms)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-ms)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="at" hide />
          <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
          <ChartTooltip
            cursor={false}
            content={(
              <ChartTooltipContent
                nameKey="ms"
                labelFormatter={label => formatTime(String(label), locale)}
                formatter={value => (
                  <span className="text-muted-foreground">
                    {t.chart.responseTime}
                    {' '}
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {value}
                      {' '}
                      {t.unit.ms}
                    </span>
                  </span>
                )}
              />
            )}
          />
          <Area
            dataKey="ms"
            type="monotone"
            stroke="var(--color-ms)"
            strokeWidth={2}
            fill={`url(#${fillId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

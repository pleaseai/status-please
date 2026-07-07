import type { Severity } from '@status-please/core'
import { CircleCheck, CircleX, TriangleAlert, Wrench } from 'lucide-react'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

const META = {
  operational: { label: 'All Systems Operational', Icon: CircleCheck, tint: 'border-status-operational/30 bg-status-operational/10 text-status-operational' },
  degraded: { label: 'Degraded Performance', Icon: TriangleAlert, tint: 'border-status-degraded/30 bg-status-degraded/10 text-status-degraded' },
  partial_outage: { label: 'Partial System Outage', Icon: TriangleAlert, tint: 'border-status-partial/30 bg-status-partial/10 text-status-partial' },
  major_outage: { label: 'Major System Outage', Icon: CircleX, tint: 'border-status-major/30 bg-status-major/10 text-status-major' },
  maintenance: { label: 'Under Maintenance', Icon: Wrench, tint: 'border-status-maintenance/30 bg-status-maintenance/10 text-status-maintenance' },
} satisfies Record<Severity, { label: string, Icon: typeof CircleCheck, tint: string }>

/**
 * Overall-status banner: one calm, unambiguous line rolled up from the worst
 * component state. Static (no interactivity), so it renders to HTML with 0 JS.
 * Color is paired with an icon + text for color-blind accessibility.
 */
export function StatusBanner({ severity }: { severity: Severity }) {
  const { label, Icon, tint } = META[severity]
  return (
    <Alert className={cn('items-center', tint)}>
      <Icon />
      <AlertTitle className="text-2xl font-semibold tracking-tight">{label}</AlertTitle>
    </Alert>
  )
}

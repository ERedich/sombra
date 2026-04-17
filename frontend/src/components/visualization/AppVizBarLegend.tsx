import type { ReactNode } from 'react'
import { visualizationBarCssVars } from '../../utils/visualizationBarStyle'

export type AppVizBarLegendItem = {
  id: string
  label: ReactNode
  /** Any CSS colour (`#hex`, `var(--blue-500)`, …) — sets `--app-viz-accent` for swatches. */
  accent: string
}

export type AppVizBarLegendProps = {
  title: ReactNode
  items: AppVizBarLegendItem[]
  className?: string
  /** `aria-label` on the group; defaults to `title` when it is a string. */
  ariaLabel?: string
  /** When `items` is empty, render this after the title (e.g. help text). */
  empty?: ReactNode
}

/**
 * Horizontal legend using `.app-viz-bar-swatch` (Guidelines → Visualization → Bars).
 * Same pattern as shift planner presence legend; reusable for WO types etc.
 */
export function AppVizBarLegend({
  title,
  items,
  className,
  ariaLabel,
  empty,
}: AppVizBarLegendProps) {
  const aria =
    ariaLabel ?? (typeof title === 'string' ? title : undefined)
  const rootClass = ['app-viz-legend', className].filter(Boolean).join(' ')

  if (items.length === 0) {
    if (empty == null) return null
    return (
      <div className={rootClass} role="group" aria-label={aria}>
        <span className="app-viz-legend__title text-xs font-medium text-color-secondary white-space-nowrap">
          {title}
        </span>
        {empty}
      </div>
    )
  }

  return (
    <div className={rootClass} role="group" aria-label={aria}>
      <span className="app-viz-legend__title text-xs font-medium text-color-secondary white-space-nowrap">
        {title}
      </span>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex align-items-center gap-2 white-space-nowrap min-w-0"
        >
          <span
            className="app-viz-legend-swatch app-viz-bar-swatch flex-shrink-0"
            style={visualizationBarCssVars(item.accent)}
            aria-hidden
          />
          <span
            className="text-xs line-height-3 overflow-hidden text-overflow-ellipsis"
            style={{ maxWidth: '14rem' }}
            title={typeof item.label === 'string' ? item.label : undefined}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

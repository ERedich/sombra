import type { CSSProperties } from 'react'

/** Sets `--app-viz-accent` for `.app-viz-bar` / `.app-viz-bar-swatch` (see Guidelines → Visualization → Bars). */
export function visualizationBarCssVars(accent: string): CSSProperties {
  return {
    '--app-viz-accent': accent,
  } as CSSProperties
}

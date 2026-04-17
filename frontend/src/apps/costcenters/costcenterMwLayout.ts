import type { CSSProperties } from 'react'
import type { MwLayoutJsonCostcenter } from '@sombra/shared'

export function ccFieldStyle(
  id: string,
  layout: MwLayoutJsonCostcenter,
): CSSProperties {
  const idx = layout.fields.findIndex((f) => f.id === id)
  const f = idx >= 0 ? layout.fields[idx] : undefined
  return {
    order: idx >= 0 ? idx : 99,
    ...(f?.hidden ? { display: 'none' } : {}),
  }
}

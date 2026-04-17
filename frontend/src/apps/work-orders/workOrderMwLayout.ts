import type { CSSProperties } from 'react'
import type { MwLayoutJsonWorkOrder } from '@sombra/shared'

export function tabFieldOrderMap(
  layout: MwLayoutJsonWorkOrder,
  tabId: string,
): Map<string, { order: number; hidden: boolean }> {
  const m = new Map<string, { order: number; hidden: boolean }>()
  const tab = layout.tabs.find((t) => t.tabId === tabId)
  if (tab) {
    tab.fields.forEach((f, i) => {
      m.set(f.id, { order: i, hidden: f.hidden === true })
    })
  }
  return m
}

export function mwFieldStyle(
  id: string,
  m: Map<string, { order: number; hidden: boolean }>,
): CSSProperties {
  const o = m.get(id)
  return {
    order: o?.order ?? 999,
    ...(o?.hidden ? { display: 'none' } : {}),
  }
}

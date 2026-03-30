/**
 * Virtualized tree table for large hierarchies. Scroll viewport height grows
 * with visible row count (expands as you open nodes), capped so very large
 * trees still scroll inside the viewport (@tanstack/react-virtual).
 */
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TreeNode } from 'primereact/treenode'
import { flattenVisibleTreeNodes } from './flattenVisibleTree'
import type { TreeRowData } from './treeStructureTypes'

/** Matches .app-tree-structure-treetable tbody td padding + line-height. */
export const VIRTUAL_TREE_ROW_HEIGHT_PX = 40

/** Header row approximate height (sticky thead). */
const THEAD_HEIGHT_PX = 44
/** Cap scroll area at this fraction of the window (remaining rows scroll inside). */
const VIEWPORT_MAX_VH = 0.65

function useGrowViewportHeightPx(visibleRowCount: number): number {
  const [maxCapPx, setMaxCapPx] = useState(() =>
    typeof window !== 'undefined'
      ? Math.floor(window.innerHeight * VIEWPORT_MAX_VH)
      : 800,
  )

  useEffect(() => {
    const update = () => {
      setMaxCapPx(Math.floor(window.innerHeight * VIEWPORT_MAX_VH))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return useMemo(() => {
    const minPx = THEAD_HEIGHT_PX + VIRTUAL_TREE_ROW_HEIGHT_PX
    const natural =
      visibleRowCount === 0
        ? minPx
        : THEAD_HEIGHT_PX + visibleRowCount * VIRTUAL_TREE_ROW_HEIGHT_PX
    return Math.min(Math.max(natural, minPx), maxCapPx)
  }, [visibleRowCount, maxCapPx])
}

type TogglerOptions = {
  onClick: (e: SyntheticEvent) => void
  containerClassName: string
  expanded: boolean
  buttonStyle: CSSProperties
}

export type VirtualizedAssetTreeTableProps = {
  nodes: TreeNode[]
  expandedKeys: Record<string, boolean>
  onExpandedKeysChange: (keys: Record<string, boolean>) => void
  selectionKey: string | null
  onSelectionChange: (key: string | null) => void
  getRowClassName: (node: TreeNode) => string
  /** Called after expansion state changes (true = expanded, false = collapsed). */
  onRowExpandToggled: (node: TreeNode, nowExpanded: boolean) => void
  togglerTemplate: (node: TreeNode, options: TogglerOptions) => ReactNode
  renderKeyColumnBody: (node: TreeNode) => ReactNode
  renderDocumentsBody: (node: TreeNode) => ReactNode
  /** Double-click a row (e.g. open asset edit on Asset management). */
  onRowDoubleClick?: (node: TreeNode) => void
  /** Right-click a row (e.g. CRUD context menu). */
  onRowContextMenu?: (event: MouseEvent<HTMLTableRowElement>, node: TreeNode) => void
  className?: string
  style?: CSSProperties
  emptyMessage: string
  /**
   * Optional fixed CSS height for the scroll viewport (e.g. `"400px"`).
   * If omitted, height grows with visible row count up to ~65vh then scrolls internally.
   */
  scrollHeight?: string
}

function VirtualizedAssetTreeTableInner({
  nodes,
  expandedKeys,
  onExpandedKeysChange,
  selectionKey,
  onSelectionChange,
  getRowClassName,
  onRowExpandToggled,
  togglerTemplate,
  renderKeyColumnBody,
  renderDocumentsBody,
  onRowDoubleClick,
  onRowContextMenu,
  className,
  style,
  emptyMessage,
  scrollHeight,
}: VirtualizedAssetTreeTableProps) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  const flat = useMemo(
    () => flattenVisibleTreeNodes(nodes, expandedKeys),
    [nodes, expandedKeys],
  )

  const growHeightPx = useGrowViewportHeightPx(flat.length)
  const viewportHeightStyle: CSSProperties =
    scrollHeight != null && scrollHeight !== ''
      ? { height: scrollHeight, maxHeight: scrollHeight }
      : { height: `${growHeightPx}px`, maxHeight: `${growHeightPx}px` }

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VIRTUAL_TREE_ROW_HEIGHT_PX,
    overscan: 20,
  })

  useLayoutEffect(() => {
    virtualizer.measure()
  }, [virtualizer, growHeightPx, flat.length])

  const items = virtualizer.getVirtualItems()
  const paddingTop = items.length > 0 ? items[0].start : 0
  const paddingBottom =
    items.length > 0
      ? virtualizer.getTotalSize() - items[items.length - 1].end
      : 0

  function toggleExpanded(node: TreeNode) {
    const k = node.key
    if (k === undefined || k === null) return
    const key = String(k)
    const next = { ...expandedKeys }
    const was = !!next[key]
    if (was) {
      delete next[key]
      onExpandedKeysChange(next)
      onRowExpandToggled(node, false)
    } else {
      next[key] = true
      onExpandedKeysChange(next)
      onRowExpandToggled(node, true)
    }
  }

  return (
    <div
      className={[
        'p-treetable p-treetable-selectable app-tree-structure-treetable w-full min-w-0',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <div
        ref={scrollRef}
        className="app-tree-virtual-scroll p-treetable-wrapper overflow-auto w-full"
        style={{
          width: '100%',
          ...viewportHeightStyle,
        }}
        tabIndex={0}
        aria-label={t('tree.aria_tree')}
      >
        <table
          className="p-treetable-table w-full"
          role="treegrid"
          style={{ minWidth: '100%', tableLayout: 'fixed' }}
        >
          <thead className="p-treetable-thead">
            <tr>
              <th className="p-treetable-header-cell">{t('common.col_key')}</th>
              <th className="p-treetable-header-cell">{t('common.col_name')}</th>
              <th
                className="p-treetable-header-cell text-center"
                style={{ width: '6rem' }}
              >
                <span
                  className="inline-flex align-items-center justify-content-center gap-1"
                  title={t('tree.title_documents')}
                >
                  <i className="pi pi-file" aria-hidden />
                  <span className="p-hidden-accessible">
                    {t('tree.title_documents')}
                  </span>
                </span>
              </th>
              <th
                className="p-treetable-header-cell text-center"
                style={{ width: '6rem' }}
              >
                <span
                  className="inline-flex align-items-center justify-content-center gap-1"
                  title={t('tree.title_work_orders')}
                >
                  <i className="pi pi-cog" aria-hidden />
                  <span className="p-hidden-accessible">
                    {t('tree.title_work_orders')}
                  </span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="p-treetable-tbody">
            {flat.length === 0 ? (
              <tr className="p-treetable-emptymessage">
                <td colSpan={4} className="p-treetable-emptymessage">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 ? (
                  <tr className="p-treetable-virtual-spacer" aria-hidden>
                    <td
                      colSpan={4}
                      style={{
                        height: paddingTop,
                        padding: 0,
                        border: 'none',
                        lineHeight: 0,
                      }}
                    />
                  </tr>
                ) : null}
                {items.map((vi) => {
                  const { node, depth } = flat[vi.index]!
                  const d = node.data as TreeRowData
                  const nk = String(node.key ?? '')
                  const hasChildren = !!(node.children && node.children.length > 0)
                  const expanded = hasChildren && !!expandedKeys[nk]
                  const selected = selectionKey === nk
                  const rowClass = [
                    getRowClassName(node),
                    selected ? 'p-highlight' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <tr
                      key={nk}
                      data-index={vi.index}
                      data-p-highlight={selected || undefined}
                      className={rowClass}
                      role="row"
                      aria-level={depth + 1}
                      aria-expanded={hasChildren ? expanded : undefined}
                      aria-selected={selected}
                      tabIndex={0}
                      style={{ height: vi.size }}
                      onClick={() => {
                        onSelectionChange(selected ? null : nk)
                      }}
                      onDoubleClick={(e) => {
                        if (!onRowDoubleClick) return
                        e.preventDefault()
                        onRowDoubleClick(node)
                      }}
                      onContextMenu={(e) => {
                        if (!onRowContextMenu) return
                        e.preventDefault()
                        onRowContextMenu(e, node)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectionChange(selected ? null : nk)
                        }
                      }}
                    >
                      <td
                        className="p-treetable-toggler-cell"
                        style={{
                          paddingLeft: `calc(${depth} * 1.25rem + 0.5rem)`,
                        }}
                      >
                        <div className="flex align-items-center gap-1 min-w-0">
                          {hasChildren ? (
                            togglerTemplate(node, {
                              onClick: (ev) => {
                                ev.stopPropagation()
                                toggleExpanded(node)
                              },
                              containerClassName: 'p-treetable-toggler',
                              expanded,
                              buttonStyle: {},
                            })
                          ) : (
                            <span
                              className="inline-block flex-shrink-0"
                              style={{
                                width: '1.5rem',
                                marginInlineEnd: '0.125rem',
                              }}
                              aria-hidden
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            {renderKeyColumnBody(node)}
                          </div>
                        </div>
                      </td>
                      <td className="white-space-nowrap overflow-hidden text-overflow-ellipsis">
                        {d.name}
                      </td>
                      <td className="text-center">
                        {renderDocumentsBody(node)}
                      </td>
                      <td className="text-center">{d.workOrders}</td>
                    </tr>
                  )
                })}
                {paddingBottom > 0 ? (
                  <tr className="p-treetable-virtual-spacer" aria-hidden>
                    <td
                      colSpan={4}
                      style={{
                        height: paddingBottom,
                        padding: 0,
                        border: 'none',
                        lineHeight: 0,
                      }}
                    />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export const VirtualizedAssetTreeTable = memo(VirtualizedAssetTreeTableInner)

import {
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  type SyntheticEvent,
} from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Badge } from 'primereact/badge'
import { Button } from 'primereact/button'
import { Ripple } from 'primereact/ripple'
import type { TreeNode } from 'primereact/treenode'
import { VirtualizedAssetTreeTable } from './VirtualizedAssetTreeTable'
import { collectExpandableKeys } from './flattenVisibleTree'
import {
  EXPAND_ANIM_MAX_CHILDREN,
  TREE_ANIM_MS,
} from './treeStructureConstants'
import type { ExpandAnimState, SiteAssetGroup, TreeRowData } from './treeStructureTypes'
import {
  ASSET_TYPE_ICON_COLOR,
  ASSET_TYPE_ICONS,
  ASSET_TYPE_LABELS,
  assetTypeRowBackgroundCssVarsStyle,
  type AssetType,
} from '../asset-management/assetTypes'

function siteSectionHeading(
  siteKey: string,
  siteName: string,
  siteColour: string,
) {
  const colour =
    typeof siteColour === 'string' && siteColour.trim() !== ''
      ? siteColour.trim()
      : '#94a3b8'
  return (
    <div className="flex align-items-center gap-2">
      <span
        className="border-round border-1 border-300 flex-shrink-0"
        style={{
          width: '1.25rem',
          height: '1.25rem',
          backgroundColor: colour,
        }}
        title={colour}
      />
      <span className="text-sm font-semibold text-color">
        {siteKey} — {siteName}
      </span>
    </div>
  )
}

function assetTypeIcon(node: TreeNode) {
  const t = (node.data as { asset_type?: AssetType }).asset_type
  const icon =
    t && ASSET_TYPE_ICONS[t] ? ASSET_TYPE_ICONS[t] : 'pi-question-circle'
  const label =
    t && ASSET_TYPE_LABELS[t] ? ASSET_TYPE_LABELS[t] : 'Unknown type'
  const color =
    t && ASSET_TYPE_ICON_COLOR[t] ? ASSET_TYPE_ICON_COLOR[t] : undefined
  return (
    <span
      className="inline-flex align-items-center justify-content-center flex-shrink-0"
      title={label}
    >
      <i
        className={`pi ${icon} text-lg`}
        style={color ? { color } : undefined}
        aria-hidden
      />
      <span className="p-hidden-accessible">{label}</span>
    </span>
  )
}

function keyColumnBody(node: TreeNode) {
  const d = node.data as TreeRowData
  return (
    <span className="inline-flex align-items-center gap-2 min-w-0">
      {assetTypeIcon(node)}
      <span className="min-w-0">{d.key}</span>
    </span>
  )
}

function docCompositeKey(siteId: string, nodeKey: string): string {
  return `${siteId}:${nodeKey}`
}

function renderDocumentsCell(
  node: TreeNode,
  siteId: string,
  simulatedDocCountsByAsset: Record<string, number>,
  tr: TFunction,
) {
  const d = node.data as TreeRowData
  const nodeKey = String(node.key ?? '')
  const v = d.documents
  const em = tr('common.em_dash')
  const hasReal =
    v != null && typeof v === 'string' && v.trim() !== '' && v !== em

  if (hasReal) {
    return <span>{v}</span>
  }

  const simCount =
    simulatedDocCountsByAsset[docCompositeKey(siteId, nodeKey)]

  if (simCount != null) {
    const label = tr('tree.doc_simulated', { count: simCount })
    return (
      <span
        className="inline-flex align-items-center justify-content-center gap-2 w-full flex-wrap"
        title={label}
      >
        <i className="pi pi-file" style={{ opacity: 1 }} aria-hidden />
        <Badge value={simCount} severity="info" />
        <span className="p-hidden-accessible">{label}</span>
      </span>
    )
  }

  const noDoc = tr('tree.doc_no_title')
  return (
    <span
      className="inline-flex align-items-center justify-content-center w-full"
      title={noDoc}
    >
      <i className="pi pi-file" style={{ opacity: 0.5 }} aria-hidden />
      <span className="p-hidden-accessible">{noDoc}</span>
    </span>
  )
}

type SiteTreeTableSectionProps = {
  group: SiteAssetGroup
  filteredNodes: TreeNode[]
  expandAnim: ExpandAnimState | null
  setExpandAnim: Dispatch<SetStateAction<ExpandAnimState | null>>
  selectionKey: string | null
  expandedKeys: Record<string, boolean>
  setExpandedKeysBySite: Dispatch<
    SetStateAction<Record<string, Record<string, boolean>>>
  >
  setSelectionBySite: Dispatch<
    SetStateAction<Record<string, string | null>>
  >
  simulatedDocCountsByAsset: Record<string, number>
  search: string
  /** Opens Asset management edit dialog for this asset (e.g. row double-click). */
  onAssetDoubleClick?: (assetId: string) => void
  /** Right-click on a row (CRUD context menu at app level). */
  onAssetRowContextMenu?: (
    event: MouseEvent<HTMLTableRowElement>,
    siteId: string,
    assetId: string,
  ) => void
}

function SiteTreeTableSectionInner({
  group,
  filteredNodes,
  expandAnim,
  setExpandAnim,
  selectionKey,
  expandedKeys,
  setExpandedKeysBySite,
  setSelectionBySite,
  simulatedDocCountsByAsset,
  search,
  onAssetDoubleClick,
  onAssetRowContextMenu,
}: SiteTreeTableSectionProps) {
  const { t } = useTranslation()
  const siteId = group.site_id

  const togglerTemplate = useCallback(
    (
      _node: TreeNode,
      options: {
        onClick: (e: SyntheticEvent) => void
        containerClassName: string
        expanded: boolean
        buttonStyle: CSSProperties
      },
    ) => {
      const expanded = options.expanded
      return (
        <button
          type="button"
          className={`${options.containerClassName} p-unselectable-text`}
          style={options.buttonStyle}
          onClick={options.onClick}
          tabIndex={-1}
          aria-expanded={expanded}
          aria-label={
            expanded ? t('tree.toggler_collapse') : t('tree.toggler_expand')
          }
        >
          <span
            className="app-tree-structure-toggler-chevron inline-flex align-items-center justify-content-center"
            aria-hidden
          >
            <i
              className="pi pi-chevron-right"
              style={{
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
          </span>
          <Ripple />
        </button>
      )
    },
    [t],
  )

  const treeTableStyle = useMemo(
    () =>
      ({
        ...assetTypeRowBackgroundCssVarsStyle(),
        '--app-tree-anim-ms': `${TREE_ANIM_MS}ms`,
      }) as CSSProperties,
    [],
  )

  const onExpandedKeysChange = useCallback(
    (keys: Record<string, boolean>) => {
      setExpandedKeysBySite((prev) => ({ ...prev, [siteId]: keys }))
    },
    [siteId, setExpandedKeysBySite],
  )

  const onSelectionChange = useCallback(
    (key: string | null) => {
      setSelectionBySite((prev) => ({ ...prev, [siteId]: key }))
    },
    [siteId, setSelectionBySite],
  )

  const onExpandAll = useCallback(() => {
    setExpandedKeysBySite((prev) => ({
      ...prev,
      [siteId]: collectExpandableKeys(filteredNodes),
    }))
  }, [siteId, filteredNodes, setExpandedKeysBySite])

  const onCollapseAll = useCallback(() => {
    setExpandedKeysBySite((prev) => ({ ...prev, [siteId]: {} }))
  }, [siteId, setExpandedKeysBySite])

  const onRowExpandToggled = useCallback(
    (node: TreeNode, nowExpanded: boolean) => {
      if (!nowExpanded) {
        setExpandAnim(null)
        return
      }
      const k = node.key
      if (k === undefined || k === null) {
        setExpandAnim(null)
        return
      }
      const childCount = node.children?.length ?? 0
      if (childCount > EXPAND_ANIM_MAX_CHILDREN) {
        setExpandAnim(null)
        return
      }
      setExpandAnim({
        parentKey: String(k),
        childCount,
      })
    },
    [setExpandAnim],
  )

  const getRowClassName = useCallback(
    (node: TreeNode) => {
      const d = node.data as TreeRowData
      const parts: string[] = []
      if (d.asset_type) {
        parts.push(`app-tree-row-type-${d.asset_type}`)
      } else {
        parts.push('app-tree-row-no-type')
      }
      if (
        expandAnim != null &&
        d.parentKey === expandAnim.parentKey
      ) {
        parts.push('app-tree-row-expand-enter')
      }
      return parts.join(' ')
    },
    [expandAnim],
  )

  const renderDocumentsBody = useCallback(
    (node: TreeNode) =>
      renderDocumentsCell(
        node,
        siteId,
        simulatedDocCountsByAsset,
        t,
      ),
    [siteId, simulatedDocCountsByAsset, t],
  )

  const emptyMessage =
    search.trim() !== ''
      ? t('tree.empty_search')
      : t('tree.empty_site')

  const handleRowDoubleClick = useCallback(
    (node: TreeNode) => {
      if (!onAssetDoubleClick) return
      const id = node.key != null ? String(node.key) : ''
      if (!id) return
      onAssetDoubleClick(id)
    },
    [onAssetDoubleClick],
  )

  const handleRowContextMenu = useCallback(
    (e: MouseEvent<HTMLTableRowElement>, node: TreeNode) => {
      if (!onAssetRowContextMenu) return
      const id = node.key != null ? String(node.key) : ''
      if (!id) return
      onAssetRowContextMenu(e, siteId, id)
    },
    [onAssetRowContextMenu, siteId],
  )

  return (
    <div className="w-full min-w-0">
      <div className="mb-2">
        {siteSectionHeading(group.site_key, group.site_name, group.site_colour)}
      </div>
      <div className="flex justify-content-between align-items-center gap-3 flex-wrap mb-2 w-full">
        <div className="flex flex-wrap align-items-center gap-2">
          <Button
            type="button"
            label={t('tree.expand_all')}
            icon="pi pi-angle-double-down"
            outlined
            size="small"
            aria-label={t('tree.aria_expand')}
            onClick={onExpandAll}
          />
          <Button
            type="button"
            label={t('tree.collapse_all')}
            icon="pi pi-angle-double-up"
            outlined
            size="small"
            aria-label={t('tree.aria_collapse')}
            onClick={onCollapseAll}
          />
        </div>
      </div>
      <div className="w-[calc(100%+0.5rem)] md:w-[calc(100%+1rem)] app-page-mw-none -mx-1 md:-mx-2">
        <VirtualizedAssetTreeTable
          className="app-tree-structure-treetable"
          style={treeTableStyle}
          nodes={filteredNodes}
          expandedKeys={expandedKeys}
          onExpandedKeysChange={onExpandedKeysChange}
          togglerTemplate={togglerTemplate}
          onRowExpandToggled={onRowExpandToggled}
          selectionKey={selectionKey}
          onSelectionChange={onSelectionChange}
          getRowClassName={getRowClassName}
          renderKeyColumnBody={keyColumnBody}
          renderDocumentsBody={renderDocumentsBody}
          emptyMessage={emptyMessage}
          onRowDoubleClick={
            onAssetDoubleClick ? handleRowDoubleClick : undefined
          }
          onRowContextMenu={
            onAssetRowContextMenu ? handleRowContextMenu : undefined
          }
        />
      </div>
    </div>
  )
}

export const SiteTreeTableSection = memo(SiteTreeTableSectionInner)

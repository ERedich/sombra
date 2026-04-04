/**
 * Asset hierarchy per site: virtualized tree table (key with type icon, name,
 * documents, work orders) in a fixed-height scroll viewport for large trees.
 * Double-click opens the same edit dialog as Asset management. Documents / work orders
 * are placeholders until wired to real data.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Card } from 'primereact/card'
import { ContextMenu } from 'primereact/contextmenu'
import { IconField } from 'primereact/iconfield'
import { InputIcon } from 'primereact/inputicon'
import { InputText } from 'primereact/inputtext'
import type { TreeNode } from 'primereact/treenode'
import { ApiError, apiJson } from '../../api'
import { getStoredUser } from '../../auth'
import { AppShell } from '../../layout/AppShell'
import {
  buildCrudContextMenuModel,
  CRUD_CONTEXT_MENU_PROPS,
  rowAuditSnapshot,
} from '../../layout/crudContextMenuItems'
import { useRegisterAppToolbarSearch } from '../../layout/AppToolbarSearchFocus'
import { AssetEditDialog } from '../asset-management/AssetEditDialog'
import type { Asset } from '../asset-management/assetTypes'
import { SiteTreeTableSection } from './SiteTreeTableSection'
import { TREE_ANIM_MS, EMPTY_EXPANDED_KEYS } from './treeStructureConstants'
import type {
  ExpandAnimState,
  SiteAssetGroup,
  TreeRowData,
} from './treeStructureTypes'

type AssetsListResponse = { assets: Asset[] }

function sortAssetsByNameKey(a: Asset, b: Asset): number {
  const n = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  if (n !== 0) return n
  return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' })
}

/** Delay between each direct child’s expand animation (cascade). */
const TREE_STAGGER_STEP_MS = 52
/** Cap sibling index used for stagger so delays do not grow unbounded. */
const STAGGER_SIBLING_CAP = 48

/** Build a forest from flat assets (same site); roots have no parent or parent outside the set. */
function buildAssetTreeNodes(assets: Asset[]): TreeNode[] {
  const ids = new Set(assets.map((a) => a.id))

  function childrenOf(parentId: string): Asset[] {
    return assets.filter((a) => a.parent_asset_id === parentId)
  }

  function toNode(
    a: Asset,
    parentKey: string | null,
    siblingIndex: number,
  ): TreeNode {
    const kids = [...childrenOf(a.id)].sort(sortAssetsByNameKey)
    const staggerIdx = Math.min(siblingIndex, STAGGER_SIBLING_CAP)
    const node: TreeNode = {
      key: a.id,
      style: {
        '--app-tree-stagger-delay': `${staggerIdx * TREE_STAGGER_STEP_MS}ms`,
      } as CSSProperties,
      data: {
        key: a.key,
        name: a.name,
        asset_type: a.asset_type,
        documents: null,
        workOrders: '—',
        parentKey,
      },
    }
    if (kids.length > 0) {
      node.children = kids.map((kid, i) => toNode(kid, a.id, i))
    }
    return node
  }

  const roots = assets.filter((a) => {
    const p = a.parent_asset_id
    return !p || !ids.has(p)
  })
  return [...roots].sort(sortAssetsByNameKey).map((a, i) => toNode(a, null, i))
}

function groupAssetsBySite(assets: Asset[]): SiteAssetGroup[] {
  const map = new Map<string, SiteAssetGroup>()
  for (const a of assets) {
    let g = map.get(a.site_id)
    if (!g) {
      g = {
        site_id: a.site_id,
        site_key: a.site_key,
        site_name: a.site_name,
        site_colour: a.site_colour,
        assets: [],
      }
      map.set(a.site_id, g)
    }
    g.assets.push(a)
  }
  return [...map.values()].sort((a, b) =>
    a.site_name.localeCompare(b.site_name, undefined, { sensitivity: 'base' }),
  )
}

/** Filter tree by key/name (case-insensitive): keep matches and ancestor paths to matches. */
function filterTreeNodes(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  function walk(n: TreeNode): TreeNode | null {
    const d = n.data as TreeRowData
    const selfMatch =
      (d.key ?? '').toLowerCase().includes(q) ||
      (d.name ?? '').toLowerCase().includes(q)

    if (selfMatch) {
      return { ...n }
    }

    const filteredChildren = n.children
      ? (n.children.map(walk).filter(Boolean) as TreeNode[])
      : undefined

    if (filteredChildren?.length) {
      return { ...n, children: filteredChildren }
    }
    return null
  }

  return nodes.map(walk).filter(Boolean) as TreeNode[]
}

function treeContainsKey(nodes: TreeNode[], key: string): boolean {
  for (const n of nodes) {
    if (String(n.key) === key) return true
    if (n.children?.length && treeContainsKey(n.children, key)) return true
  }
  return false
}

export default function TreeStructureAppPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const toolbarSearchRef = useRegisterAppToolbarSearch()
  const crudContextMenuRef = useRef<ContextMenu>(null)
  const [contextMenuAssetId, setContextMenuAssetId] = useState<string | null>(
    null,
  )
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  /** Parent node key whose direct children play the staggered expand animation. */
  const [expandAnim, setExpandAnim] = useState<ExpandAnimState | null>(null)
  /** Selected row key per site table (single selection). */
  const [selectionBySite, setSelectionBySite] = useState<
    Record<string, string | null>
  >({})
  /** Controlled expansion per site tree (key: node key string → expanded). */
  const [expandedKeysBySite, setExpandedKeysBySite] = useState<
    Record<string, Record<string, boolean>>
  >({})
  /** In-place edit dialog (double-click row). */
  const [editAsset, setEditAsset] = useState<Asset | null>(null)

  /** Stable per-asset simulated doc counts (UI demo; key: siteId:assetId). */
  const simulatedDocCountsByAsset = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of assets) {
      map[`${a.site_id}:${a.id}`] = Math.floor(Math.random() * 20) + 1
    }
    return map
  }, [assets])

  useEffect(() => {
    if (expandAnim == null) return
    const clearMs =
      Math.max(0, expandAnim.childCount - 1) * TREE_STAGGER_STEP_MS +
      TREE_ANIM_MS
    const t = window.setTimeout(() => setExpandAnim(null), clearMs)
    return () => window.clearTimeout(t)
  }, [expandAnim])

  const cardSubTitle = useMemo(() => {
    const user = getStoredUser()
    if (user?.role === 'admin') {
      return t('tree.subtitle_admin')
    }
    const n = user?.accessible_site_ids?.length ?? 0
    if (n === 0) {
      return t('tree.subtitle_no_sites')
    }
    return t('tree.subtitle_default')
  }, [t])

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<AssetsListResponse>('/api/assets')
      setAssets(data.assets ?? [])
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message)
      } else {
        setError(t('assets.load_fail'))
      }
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  const siteGroups = useMemo(() => groupAssetsBySite(assets), [assets])

  /** Rebuild only when assets or search change — not on selection/expand UI state. */
  const siteFilteredTrees = useMemo(
    () =>
      siteGroups.map((g) => ({
        group: g,
        filteredNodes: filterTreeNodes(buildAssetTreeNodes(g.assets), search),
      })),
    [siteGroups, search],
  )

  const onAssetDoubleClick = useCallback((assetId: string) => {
    const a = assets.find((x) => x.id === assetId)
    if (a) setEditAsset(a)
  }, [assets])

  const handleAssetRowContextMenu = useCallback(
    (
      e: MouseEvent<HTMLTableRowElement>,
      siteId: string,
      assetId: string,
    ) => {
      setContextMenuAssetId(assetId)
      setSelectionBySite((prev) => ({ ...prev, [siteId]: assetId }))
      crudContextMenuRef.current?.show(e)
    },
    [],
  )

  const crudContextMenuItems = useMemo(() => {
    const asset = contextMenuAssetId
      ? assets.find((x) => x.id === contextMenuAssetId)
      : undefined
    const isAdmin = getStoredUser()?.role === 'admin'
    return buildCrudContextMenuModel(
      {
        onCreate: () => navigate('/assets'),
        onEdit: () => {
          if (asset) setEditAsset(asset)
        },
        onDelete: () => {},
        disableDelete: true,
        disableEdit: !asset,
      },
      t,
      {
        audit: asset ? rowAuditSnapshot(asset) : undefined,
        auditHistory: {
          visible: isAdmin === true && !!contextMenuAssetId,
          onNavigate: () =>
            navigate(
              `/audit-log?resource_type=asset&resource_id=${encodeURIComponent(contextMenuAssetId!)}`,
            ),
        },
      },
    )
  }, [contextMenuAssetId, assets, navigate, t])

  const handleAssetSaved = useCallback((updated: Asset) => {
    setAssets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
  }, [])

  useEffect(() => {
    setSelectionBySite((prev) => {
      let changed = false
      const next = { ...prev }
      for (const { group, filteredNodes } of siteFilteredTrees) {
        const sel = next[group.site_id]
        if (sel != null && !treeContainsKey(filteredNodes, sel)) {
          next[group.site_id] = null
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [siteFilteredTrees])

  const treeHeader = (
    <div className="app-card-hero flex align-items-start gap-3 p-4 md:p-5">
      <span
        className="app-card-hero-icon flex align-items-center justify-content-center flex-shrink-0"
        aria-hidden
      >
        <i className="pi pi-list text-xl" />
      </span>
      <div className="min-w-0 pt-0">
        <h1 className="app-card-hero-title">{t('tree.title')}</h1>
        <p className="app-card-hero-desc">{cardSubTitle}</p>
      </div>
    </div>
  )

  return (
    <AppShell>
      <ContextMenu
        ref={crudContextMenuRef}
        model={crudContextMenuItems}
        onHide={() => setContextMenuAssetId(null)}
        {...CRUD_CONTEXT_MENU_PROPS}
      />
      <div className="p-4 app-page-mw-lg flex flex-column gap-3">
        <Card
          className="shadow-1 border-round-xl overflow-hidden"
          pt={{ header: { className: 'p-0 border-none' } }}
          header={treeHeader}
        >
          <div className="px-1 md:px-2">
            <p className="text-sm text-color-secondary mt-0 mb-3">
              {t('tree.help_intro')}
            </p>

            {!loading && !error && siteGroups.length > 0 ? (
              <div className="flex justify-content-end mb-3">
                <IconField
                  iconPosition="left"
                  className="app-crud-toolbar-search flex-shrink-0"
                  style={{ width: 'min(20rem, 100%)' }}
                >
                  <InputIcon className="pi pi-search" />
                  <InputText
                    ref={toolbarSearchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('common.search_ellipsis')}
                    aria-label={t('tree.search_aria')}
                    className="w-full"
                  />
                </IconField>
              </div>
            ) : null}

            {loading ? (
              <p className="text-color-secondary m-0 mb-3">
                {t('tree.loading_assets')}
              </p>
            ) : null}
            {error ? (
              <p className="text-color-secondary m-0 mb-3">{error}</p>
            ) : null}
            {!loading && !error && assets.length === 0 ? (
              <p className="text-color-secondary m-0">
                {t('tree.no_assets_display')}
              </p>
            ) : null}

            {!loading && !error && siteGroups.length > 0 ? (
              <div className="flex flex-column gap-4">
                {siteFilteredTrees.map(({ group, filteredNodes }) => (
                  <SiteTreeTableSection
                    key={group.site_id}
                    group={group}
                    filteredNodes={filteredNodes}
                    expandAnim={expandAnim}
                    setExpandAnim={setExpandAnim}
                    selectionKey={selectionBySite[group.site_id] ?? null}
                    expandedKeys={
                      expandedKeysBySite[group.site_id] ?? EMPTY_EXPANDED_KEYS
                    }
                    setExpandedKeysBySite={setExpandedKeysBySite}
                    setSelectionBySite={setSelectionBySite}
                    simulatedDocCountsByAsset={simulatedDocCountsByAsset}
                    search={search}
                    onAssetDoubleClick={onAssetDoubleClick}
                    onAssetRowContextMenu={handleAssetRowContextMenu}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
      <AssetEditDialog
        asset={editAsset}
        open={editAsset != null}
        onClose={() => setEditAsset(null)}
        allAssets={assets}
        onSaved={handleAssetSaved}
      />
    </AppShell>
  )
}

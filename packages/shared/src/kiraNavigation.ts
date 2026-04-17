/**
 * Kira client navigation: logical app ids, validation, and route builders.
 * Keep in sync with frontend/src/navigation/registeredApps.ts (paths, adminOnly).
 */

export const KIRA_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isKiraUuid(s: string): boolean {
  return KIRA_UUID_RE.test(s.trim())
}

/** Inline tokens in assistant/user text → deep links (see system prompt). */
export const KIRA_ENTITY_LINK_RE =
  /\[\[(asset|workgroup|work_order):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\]/gi

export type KiraEntityLinkKind = 'asset' | 'workgroup' | 'work_order'

export type KiraParsedSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; entity: KiraEntityLinkKind; id: string }

/** Split assistant/user text into plain segments and entity deep-link tokens. */
export function parseKiraEntitySegments(text: string): KiraParsedSegment[] {
  const re = new RegExp(KIRA_ENTITY_LINK_RE.source, 'gi')
  const out: KiraParsedSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', value: text.slice(last, m.index) })
    }
    const rawKind = m[1]?.toLowerCase()
    const id = m[2] ?? ''
    if (
      (rawKind === 'asset' ||
        rawKind === 'workgroup' ||
        rawKind === 'work_order') &&
      id
    ) {
      out.push({ kind: 'link', entity: rawKind, id })
    } else {
      out.push({ kind: 'text', value: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) })
  }
  return out
}

export type KiraNavAppId =
  | 'home'
  | 'assets'
  | 'workgroups'
  | 'work_orders'
  | 'costcenters'
  | 'work_types'
  | 'categories'
  | 'employees'
  | 'asset_classifications'
  | 'tree_structure'
  | 'monitoring'
  | 'transactions'
  | 'work_planning'
  | 'month_scheduler'
  | 'shift_planner'
  | 'capacity_planner'
  | 'users'
  | 'user_groups'
  | 'sites'
  | 'hotkeys'
  | 'translations'
  | 'template_app'
  | 'shifts'
  | 'app_parameters'
  | 'mw_template_editor'
  | 'audit_log'

type NavMeta = {
  webPath: string
  adminOnly?: boolean
  /** Query param name when entityId is set */
  entityQueryKey?: 'assetId' | 'workgroupId' | 'workOrderId'
}

/** Logical id → web path + optional deep-link query key. */
export const KIRA_NAV_META: Record<KiraNavAppId, NavMeta> = {
  home: { webPath: '/' },
  assets: { webPath: '/assets', entityQueryKey: 'assetId' },
  workgroups: { webPath: '/workgroups', entityQueryKey: 'workgroupId' },
  work_orders: { webPath: '/work-orders', entityQueryKey: 'workOrderId' },
  costcenters: { webPath: '/costcenters' },
  work_types: { webPath: '/work-types' },
  categories: { webPath: '/categories' },
  employees: { webPath: '/employees' },
  asset_classifications: { webPath: '/asset-classifications' },
  tree_structure: { webPath: '/tree-structure' },
  monitoring: { webPath: '/monitoring' },
  transactions: { webPath: '/transactions' },
  work_planning: { webPath: '/work-planning' },
  month_scheduler: { webPath: '/month-scheduler' },
  shift_planner: { webPath: '/shift-planner' },
  capacity_planner: { webPath: '/capacity-planner' },
  users: { webPath: '/users' },
  user_groups: { webPath: '/user-groups' },
  sites: { webPath: '/sites' },
  hotkeys: { webPath: '/hotkeys' },
  translations: { webPath: '/translations' },
  template_app: { webPath: '/template-app' },
  shifts: { webPath: '/shifts' },
  app_parameters: { webPath: '/app-parameters', adminOnly: true },
  mw_template_editor: { webPath: '/mw-template-editor', adminOnly: true },
  audit_log: { webPath: '/audit-log', adminOnly: true },
}

export const KIRA_NAV_APP_IDS = Object.keys(KIRA_NAV_META) as KiraNavAppId[]

export type ClientNavigateAction = {
  type: 'navigate'
  app: KiraNavAppId
  entityId?: string
  /** When true, close Kira after navigation. Omit or false keeps Kira open. */
  closeKira?: boolean
}

export type ClientShellAction = {
  type: 'shell'
  action: 'open_kira'
}

export type ClientAction = ClientNavigateAction | ClientShellAction

export function isKiraNavAppId(s: string): s is KiraNavAppId {
  return s in KIRA_NAV_META
}

export function buildWebPath(
  app: KiraNavAppId,
  entityId?: string,
): { pathname: string; search: string } {
  const meta = KIRA_NAV_META[app]
  const pathname = meta.webPath
  let search = ''
  const id = entityId?.trim()
  if (id && meta.entityQueryKey && isKiraUuid(id)) {
    const q = new URLSearchParams()
    q.set(meta.entityQueryKey, id)
    search = `?${q.toString()}`
  }
  return { pathname, search }
}

/**
 * Expo Router hrefs. Returns null when no mobile screen exists (caller shows plain text).
 * Workgroups: no mobile tab — return null for deep links; list-only could use a future route.
 */
export function buildMobileHref(
  app: KiraNavAppId,
  entityId?: string,
): string | null {
  const id = entityId?.trim()
  if (id && !isKiraUuid(id)) return null

  switch (app) {
    case 'home':
      return '/'
    case 'assets':
      if (id) return `/assets/${id}`
      return '/assets'
    case 'work_orders':
      if (id) return `/work-orders/${id}`
      return '/work-orders'
    case 'workgroups':
      // No workgroups stack in mobile app yet.
      return null
    default:
      return null
  }
}

export type ValidateNavigationResult =
  | { ok: true; action: ClientAction }
  | { ok: false; error: string }

/**
 * Validate tool arguments for `request_client_navigation`.
 * Pushes at most one ClientAction on success (shell or navigate).
 */
export function validateClientNavigationToolInput(args: {
  app?: unknown
  entity_id?: unknown
  close_kira?: unknown
  shell_action?: unknown
  isAdmin: boolean
}): ValidateNavigationResult {
  const shell = args.shell_action
  const hasShell = shell != null && shell !== undefined
  const hasApp = args.app != null && args.app !== undefined
  if (hasShell && hasApp) {
    return { ok: false, error: 'Pass either shell_action or app, not both.' }
  }
  if (hasShell) {
    if (typeof shell !== 'string' || shell !== 'open_kira') {
      return { ok: false, error: 'shell_action must be "open_kira" if set.' }
    }
    return { ok: true, action: { type: 'shell', action: 'open_kira' } }
  }

  const appRaw = args.app
  if (typeof appRaw !== 'string' || !isKiraNavAppId(appRaw)) {
    return {
      ok: false,
      error: `Invalid or missing app. Allowed: ${KIRA_NAV_APP_IDS.join(', ')}`,
    }
  }

  const meta = KIRA_NAV_META[appRaw]
  if (meta.adminOnly && !args.isAdmin) {
    return { ok: false, error: 'This app requires administrator role.' }
  }

  let entityId: string | undefined
  const ent = args.entity_id
  if (ent != null && ent !== undefined) {
    if (typeof ent !== 'string' || !ent.trim()) {
      return { ok: false, error: 'entity_id must be a non-empty string when set.' }
    }
    const tid = ent.trim()
    if (!isKiraUuid(tid)) {
      return { ok: false, error: 'entity_id must be a valid UUID.' }
    }
    if (!meta.entityQueryKey) {
      return {
        ok: false,
        error: `App "${appRaw}" does not support entity_id deep links.`,
      }
    }
    entityId = tid
  }

  const ck = args.close_kira
  let closeKira: boolean | undefined
  if (typeof ck === 'boolean') {
    closeKira = ck
  } else if (ck != null && ck !== undefined) {
    return { ok: false, error: 'close_kira must be a boolean when set.' }
  }

  const action: ClientNavigateAction = {
    type: 'navigate',
    app: appRaw,
    ...(entityId ? { entityId } : {}),
    ...(closeKira !== undefined ? { closeKira } : {}),
  }
  return { ok: true, action }
}

/** Map token kind from message parser to KiraNavAppId */
export function entityLinkKindToApp(kind: KiraEntityLinkKind): KiraNavAppId {
  switch (kind) {
    case 'asset':
      return 'assets'
    case 'workgroup':
      return 'workgroups'
    case 'work_order':
      return 'work_orders'
  }
}

/** MW (modal window) form layout: shared types + validation for API and web. */

export const MW_FORM_SHELL_KEYS = ['costcenter', 'work_order'] as const
export type MwFormShellKey = (typeof MW_FORM_SHELL_KEYS)[number]

export function isMwFormShellKey(s: string): s is MwFormShellKey {
  return (MW_FORM_SHELL_KEYS as readonly string[]).includes(s)
}

export type MwFieldLayoutItem = {
  id: string
  colSpan?: number
  hidden?: boolean
}

export type MwLayoutJsonCostcenter = {
  version: 1
  fields: MwFieldLayoutItem[]
}

export type MwLayoutJsonWorkOrderTab = {
  tabId: string
  fields: MwFieldLayoutItem[]
}

export type MwLayoutJsonWorkOrder = {
  version: 1
  tabs: MwLayoutJsonWorkOrderTab[]
}

export type MwLayoutJson = MwLayoutJsonCostcenter | MwLayoutJsonWorkOrder

export const MW_COSTCENTER_FIELD_IDS = ['key', 'name'] as const

export const MW_WORK_ORDER_TAB_IDS = [
  'general',
  'instructions',
  'work_plan',
  'planning',
  'feedback',
] as const

export const MW_WORK_ORDER_FIELDS_BY_TAB: Record<
  (typeof MW_WORK_ORDER_TAB_IDS)[number],
  readonly string[]
> = {
  general: [
    'voice_assist',
    'wo_key',
    'short_text',
    'asset',
    'cost_center_hint',
    'work_plan_key_readonly',
    'work_type',
    'category',
    'instruction',
    'started_employee',
    'continued_employee',
  ],
  instructions: ['work_instructions'],
  work_plan: [
    'work_plan_interval_count',
    'work_plan_interval_type',
    'work_plan_next_due',
    'work_plan_open_button',
  ],
  planning: ['workgroup', 'plan_start', 'planned_duration', 'plan_end'],
  feedback: [
    'feedback_self',
    'feedback_target_status',
    'feedback_done_checkbox',
    'feedback_hold_reason',
    'feedback_capture_date',
    'feedback_done_at',
    'feedback_done_by',
    'feedback_problem',
    'feedback_cause',
    'feedback_remedy',
    'feedback_extra',
    'feedback_submit',
    'transactions',
  ],
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseFieldItem(raw: unknown): MwFieldLayoutItem | null {
  if (!isPlainObject(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id || id.length > 80) return null
  const hidden = raw.hidden === true
  let colSpan: number | undefined
  if (typeof raw.colSpan === 'number' && Number.isInteger(raw.colSpan)) {
    if (raw.colSpan >= 1 && raw.colSpan <= 12) colSpan = raw.colSpan
  }
  return { id, hidden, colSpan }
}

export function defaultMwLayoutJson(shell: MwFormShellKey): MwLayoutJson {
  if (shell === 'costcenter') {
    return {
      version: 1,
      fields: MW_COSTCENTER_FIELD_IDS.map((id) => ({ id })),
    }
  }
  return {
    version: 1,
    tabs: MW_WORK_ORDER_TAB_IDS.map((tabId) => ({
      tabId,
      fields: [...MW_WORK_ORDER_FIELDS_BY_TAB[tabId]].map((id) => ({ id })),
    })),
  }
}

/** Merge saved layout onto defaults: unknown ids dropped; missing ids appended in default order. */
export function mergeMwLayoutJson(
  shell: MwFormShellKey,
  saved: unknown,
): MwLayoutJson {
  const base = defaultMwLayoutJson(shell)
  if (shell === 'costcenter') {
    const b = base as MwLayoutJsonCostcenter
    if (!isPlainObject(saved) || saved.version !== 1 || !Array.isArray(saved.fields)) {
      return b
    }
    const allowed = new Set(MW_COSTCENTER_FIELD_IDS as readonly string[])
    const parsed: MwFieldLayoutItem[] = []
    for (const row of saved.fields) {
      const it = parseFieldItem(row)
      if (it && allowed.has(it.id)) parsed.push(it)
    }
    const seen = new Set(parsed.map((p) => p.id))
    for (const id of MW_COSTCENTER_FIELD_IDS) {
      if (!seen.has(id)) parsed.push({ id })
    }
    return { version: 1, fields: parsed }
  }

  const b = base as MwLayoutJsonWorkOrder
  if (
    !isPlainObject(saved) ||
    saved.version !== 1 ||
    !Array.isArray((saved as MwLayoutJsonWorkOrder).tabs)
  ) {
    return b
  }
  const tabsIn = (saved as MwLayoutJsonWorkOrder).tabs
  const byTab = new Map<string, MwFieldLayoutItem[]>()
  for (const t of tabsIn) {
    if (!isPlainObject(t) || typeof t.tabId !== 'string') continue
    const tabId = t.tabId.trim()
    if (!(MW_WORK_ORDER_TAB_IDS as readonly string[]).includes(tabId)) continue
    const allowed = new Set(
      MW_WORK_ORDER_FIELDS_BY_TAB[tabId as keyof typeof MW_WORK_ORDER_FIELDS_BY_TAB],
    )
    const parsed: MwFieldLayoutItem[] = []
    if (Array.isArray(t.fields)) {
      for (const row of t.fields) {
        const it = parseFieldItem(row)
        if (it && allowed.has(it.id)) parsed.push(it)
      }
    }
    const seen = new Set(parsed.map((p) => p.id))
    for (const id of MW_WORK_ORDER_FIELDS_BY_TAB[
      tabId as keyof typeof MW_WORK_ORDER_FIELDS_BY_TAB
    ]) {
      if (!seen.has(id)) parsed.push({ id })
    }
    byTab.set(tabId, parsed)
  }
  const outTabs: MwLayoutJsonWorkOrderTab[] = []
  for (const tabId of MW_WORK_ORDER_TAB_IDS) {
    outTabs.push({
      tabId,
      fields: byTab.get(tabId) ?? [...MW_WORK_ORDER_FIELDS_BY_TAB[tabId]].map((id) => ({ id })),
    })
  }
  return { version: 1, tabs: outTabs }
}

export function validateMwLayoutJson(
  shell: MwFormShellKey,
  raw: unknown,
): { ok: true; layout: MwLayoutJson } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'layout_json must be an object.' }
  }
  if (raw.version !== 1) {
    return { ok: false, error: 'layout_json.version must be 1.' }
  }
  if (shell === 'costcenter') {
    if (!Array.isArray(raw.fields)) {
      return { ok: false, error: 'layout_json.fields must be an array.' }
    }
    const allowed = new Set(MW_COSTCENTER_FIELD_IDS as readonly string[])
    const seen = new Set<string>()
    for (const row of raw.fields) {
      const it = parseFieldItem(row)
      if (!it) {
        return { ok: false, error: 'Invalid field entry in layout_json.fields.' }
      }
      if (!allowed.has(it.id)) {
        return { ok: false, error: `Unknown field id for costcenter: ${it.id}` }
      }
      if (seen.has(it.id)) {
        return { ok: false, error: `Duplicate field id: ${it.id}` }
      }
      seen.add(it.id)
    }
    for (const id of MW_COSTCENTER_FIELD_IDS) {
      if (!seen.has(id)) {
        return { ok: false, error: `Missing required field id: ${id}` }
      }
    }
    return { ok: true, layout: raw as MwLayoutJsonCostcenter }
  }

  if (!Array.isArray(raw.tabs)) {
    return { ok: false, error: 'layout_json.tabs must be an array.' }
  }
  const tabSeen = new Set<string>()
  for (const t of raw.tabs) {
    if (!isPlainObject(t)) {
      return { ok: false, error: 'Each tab must be an object.' }
    }
    const tabId = typeof t.tabId === 'string' ? t.tabId.trim() : ''
    if (!(MW_WORK_ORDER_TAB_IDS as readonly string[]).includes(tabId)) {
      return { ok: false, error: `Unknown tabId: ${tabId}` }
    }
    if (tabSeen.has(tabId)) {
      return { ok: false, error: `Duplicate tabId: ${tabId}` }
    }
    tabSeen.add(tabId)
    if (!Array.isArray(t.fields)) {
      return { ok: false, error: `tabs[${tabId}].fields must be an array.` }
    }
    const allowed = new Set(
      MW_WORK_ORDER_FIELDS_BY_TAB[tabId as keyof typeof MW_WORK_ORDER_FIELDS_BY_TAB],
    )
    const fSeen = new Set<string>()
    for (const row of t.fields) {
      const it = parseFieldItem(row)
      if (!it) {
        return { ok: false, error: `Invalid field in tab ${tabId}.` }
      }
      if (!allowed.has(it.id)) {
        return { ok: false, error: `Unknown field id in tab ${tabId}: ${it.id}` }
      }
      if (fSeen.has(it.id)) {
        return { ok: false, error: `Duplicate field id in tab ${tabId}: ${it.id}` }
      }
      fSeen.add(it.id)
    }
    for (const id of MW_WORK_ORDER_FIELDS_BY_TAB[
      tabId as keyof typeof MW_WORK_ORDER_FIELDS_BY_TAB
    ]) {
      if (!fSeen.has(id)) {
        return { ok: false, error: `Missing field id in tab ${tabId}: ${id}` }
      }
    }
  }
  if (tabSeen.size !== MW_WORK_ORDER_TAB_IDS.length) {
    return { ok: false, error: 'layout_json.tabs must include every tab exactly once.' }
  }
  return { ok: true, layout: raw as MwLayoutJsonWorkOrder }
}

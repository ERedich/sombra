import type { Pool } from 'pg'
import type {
  AiAssetDraft,
  AiRefItem,
  AiWorkOrderDraft,
} from './suggestTypes.js'
import { rankRefMatches } from './suggestCandidates.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ASSET_TYPES = new Set([
  'location',
  'building',
  'group',
  'maintenance_object',
])

async function assetInSite(
  pool: Pool,
  siteId: string,
  assetId: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM assets WHERE id = $1::uuid AND site_id = $2::uuid`,
    [assetId, siteId],
  )
  return r.rows.length > 0
}

async function workTypeInSite(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM work_types WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rows.length > 0
}

async function workgroupInSite(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM workgroups WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rows.length > 0
}

async function categoryInSite(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM categories WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rows.length > 0
}

async function costcenterInSite(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM costcenters WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rows.length > 0
}

async function classificationInSite(
  pool: Pool,
  siteId: string,
  id: string,
): Promise<boolean> {
  const r = await pool.query<{ c: string }>(
    `SELECT 1 AS c FROM asset_classifications WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rows.length > 0
}

function clipStr(s: string | null, max: number): string | null {
  if (s == null) return null
  const t = s.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

export async function validateAndResolveWorkOrderDraft(
  pool: Pool,
  siteId: string,
  transcript: string,
  raw: Partial<AiWorkOrderDraft>,
  context: { assets?: AiRefItem[]; work_types?: AiRefItem[]; workgroups?: AiRefItem[]; categories?: AiRefItem[] },
): Promise<{
  validated: AiWorkOrderDraft
  unresolved: string[]
  candidates: Record<string, import('./suggestTypes.js').AiCandidate[]>
}> {
  const candidates: Record<string, import('./suggestTypes.js').AiCandidate[]> =
    {}
  const unresolved: string[] = []

  const short_text = clipStr(raw.short_text ?? null, 200)
  let instruction_text = clipStr(raw.instruction_text ?? null, 2000)

  let asset_id: string | null = null
  if (raw.asset_id && UUID_RE.test(raw.asset_id)) {
    if (await assetInSite(pool, siteId, raw.asset_id)) {
      asset_id = raw.asset_id
    }
  }
  if (!asset_id) {
    unresolved.push('asset_id')
    candidates.asset_id = rankRefMatches(transcript, context.assets, 8)
  }

  let work_type_id: string | null = null
  if (raw.work_type_id && UUID_RE.test(raw.work_type_id)) {
    if (await workTypeInSite(pool, siteId, raw.work_type_id)) {
      work_type_id = raw.work_type_id
    }
  }
  if (!work_type_id) {
    unresolved.push('work_type_id')
    candidates.work_type_id = rankRefMatches(
      transcript,
      context.work_types,
      8,
    )
  }

  let workgroup_id: string | null = null
  if (raw.workgroup_id && UUID_RE.test(raw.workgroup_id)) {
    if (await workgroupInSite(pool, siteId, raw.workgroup_id)) {
      workgroup_id = raw.workgroup_id
    }
  }
  if (!workgroup_id) {
    unresolved.push('workgroup_id')
    candidates.workgroup_id = rankRefMatches(
      transcript,
      context.workgroups,
      8,
    )
  }

  let category_id: string | null = null
  if (raw.category_id && UUID_RE.test(raw.category_id)) {
    if (await categoryInSite(pool, siteId, raw.category_id)) {
      category_id = raw.category_id
    }
  } else if (raw.category_id === null || raw.category_id === undefined) {
    category_id = null
  } else {
    category_id = null
  }

  const rawPlanned =
    (raw as { planned_duration?: unknown }).planned_duration ??
    (raw as { duration?: unknown }).duration
  let planned_duration: number | null =
    typeof rawPlanned === 'number' &&
    Number.isFinite(rawPlanned) &&
    rawPlanned >= 0
      ? rawPlanned
      : null
  if (planned_duration === null) {
    unresolved.push('planned_duration')
  }

  let plan_start: string | null = null
  if (typeof raw.plan_start === 'string' && raw.plan_start.trim()) {
    const d = new Date(raw.plan_start)
    if (!Number.isNaN(d.getTime())) {
      plan_start = d.toISOString()
    }
  }

  if (!short_text) unresolved.push('short_text')
  if (!instruction_text) {
    const fromTranscript = transcript.trim().slice(0, 2000)
    if (fromTranscript) {
      instruction_text = fromTranscript
    } else {
      unresolved.push('instruction_text')
    }
  }

  const validated: AiWorkOrderDraft = {
    short_text,
    instruction_text,
    asset_id,
    work_type_id,
    workgroup_id,
    category_id,
    planned_duration,
    plan_start,
  }

  return { validated, unresolved: [...new Set(unresolved)], candidates }
}

export async function validateAndResolveAssetDraft(
  pool: Pool,
  siteId: string,
  transcript: string,
  raw: Partial<AiAssetDraft>,
  context: {
    assets?: AiRefItem[]
    costcenters?: AiRefItem[]
    asset_classifications?: AiRefItem[]
  },
): Promise<{
  validated: AiAssetDraft
  unresolved: string[]
  candidates: Record<string, import('./suggestTypes.js').AiCandidate[]>
}> {
  const candidates: Record<string, import('./suggestTypes.js').AiCandidate[]> =
    {}
  const unresolved: string[] = []

  const key = clipStr(raw.key ?? null, 200)
  const name = clipStr(raw.name ?? null, 500)

  let asset_type: AiAssetDraft['asset_type'] = null
  if (
    typeof raw.asset_type === 'string' &&
    ASSET_TYPES.has(raw.asset_type)
  ) {
    asset_type = raw.asset_type as AiAssetDraft['asset_type']
  }
  if (!asset_type) {
    unresolved.push('asset_type')
  }

  let parent_asset_id: string | null = null
  if (raw.parent_asset_id && UUID_RE.test(raw.parent_asset_id)) {
    if (await assetInSite(pool, siteId, raw.parent_asset_id)) {
      parent_asset_id = raw.parent_asset_id
    }
  } else if (raw.parent_asset_id === null || raw.parent_asset_id === '') {
    parent_asset_id = null
  }

  let costcenter_id: string | null = null
  if (raw.costcenter_id && UUID_RE.test(raw.costcenter_id)) {
    if (await costcenterInSite(pool, siteId, raw.costcenter_id)) {
      costcenter_id = raw.costcenter_id
    }
  } else if (raw.costcenter_id === null || raw.costcenter_id === '') {
    costcenter_id = null
  }

  let asset_classification_id: string | null = null
  if (raw.asset_classification_id && UUID_RE.test(raw.asset_classification_id)) {
    if (await classificationInSite(pool, siteId, raw.asset_classification_id)) {
      asset_classification_id = raw.asset_classification_id
    }
  } else if (
    raw.asset_classification_id === null ||
    raw.asset_classification_id === ''
  ) {
    asset_classification_id = null
  }

  const equipment_number = clipStr(raw.equipment_number ?? null, 200)
  const serial_no = clipStr(raw.serial_no ?? null, 200)

  let build_year: number | null = null
  if (
    typeof raw.build_year === 'number' &&
    Number.isInteger(raw.build_year) &&
    raw.build_year >= 1800 &&
    raw.build_year <= 2100
  ) {
    build_year = raw.build_year
  }

  let warranty_end: string | null = null
  if (typeof raw.warranty_end === 'string' && raw.warranty_end.trim()) {
    const d = new Date(raw.warranty_end)
    if (!Number.isNaN(d.getTime())) {
      warranty_end = d.toISOString().slice(0, 10)
    }
  }

  let priority: number | null = null
  if (
    typeof raw.priority === 'number' &&
    Number.isInteger(raw.priority) &&
    raw.priority >= 1 &&
    raw.priority <= 5
  ) {
    priority = raw.priority
  }

  if (!key) {
    unresolved.push('key')
  }
  if (!name) unresolved.push('name')

  const validated: AiAssetDraft = {
    key: key ?? '',
    name: name ?? '',
    asset_type,
    parent_asset_id,
    costcenter_id,
    asset_classification_id,
    equipment_number,
    serial_no,
    build_year,
    warranty_end,
    priority,
  }

  return { validated, unresolved: [...new Set(unresolved)], candidates }
}

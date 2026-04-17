import type { Pool } from 'pg'
import type { IntervalTimeType } from '../services/intervalUtc.js'
import { parseWorkInstructionsInput } from '../routes/work-orders.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseIntervalType(v: unknown): IntervalTimeType | 'invalid' {
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim().toLowerCase()
  if (s === 'day' || s === 'week' || s === 'month' || s === 'year') return s
  return 'invalid'
}

function parseDueDate(v: unknown): Date | 'invalid' {
  if (typeof v !== 'string') return 'invalid'
  const s = v.trim()
  if (!s) return 'invalid'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

function parseCategoryIdFromFields(
  category_id: unknown,
): string | null | 'invalid' {
  if (category_id === null || category_id === undefined) return null
  if (typeof category_id !== 'string') return 'invalid'
  const s = category_id.trim()
  if (!s) return null
  if (!UUID_RE.test(s)) return 'invalid'
  return s
}

export type CopilotWorkPlanValidateResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Validates a POST /api/work-plans body shape (same rules as work-plans router).
 */
export async function validateWorkPlanCreateForCopilot(
  pool: Pool,
  siteId: string,
  o: Record<string, unknown>,
): Promise<CopilotWorkPlanValidateResult> {
  const planKey =
    typeof o.plan_key === 'string' ? o.plan_key.trim() : ''
  const shortText =
    typeof o.short_text === 'string' ? o.short_text.trim() : ''
  const instructionText =
    typeof o.instruction_text === 'string' ? o.instruction_text : ''
  const assetIdRaw = typeof o.asset_id === 'string' ? o.asset_id.trim() : ''

  const intervalParsed = parseIntervalType(o.interval_time_type)
  if (intervalParsed === 'invalid') {
    return {
      ok: false,
      error: 'interval_time_type must be day, week, month, or year.',
    }
  }

  const intervalCountRaw = o.interval_count
  const intervalCount =
    typeof intervalCountRaw === 'number'
      ? intervalCountRaw
      : typeof intervalCountRaw === 'string'
        ? Number(intervalCountRaw)
        : NaN
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    return { ok: false, error: 'interval_count must be an integer >= 1.' }
  }

  const dueParsed = parseDueDate(o.due_date)
  if (dueParsed === 'invalid') {
    return { ok: false, error: 'due_date is required (ISO timestamp).' }
  }

  const leadRaw = o.lead_time_days
  const leadNum =
    leadRaw === undefined || leadRaw === null
      ? 0
      : typeof leadRaw === 'number'
        ? leadRaw
        : typeof leadRaw === 'string'
          ? Number(leadRaw)
          : NaN
  if (!Number.isInteger(leadNum) || leadNum < 0) {
    return {
      ok: false,
      error: 'lead_time_days must be a non-negative integer.',
    }
  }

  const durRaw =
    (o as { planned_duration?: unknown }).planned_duration ??
    (o as { duration_hours?: unknown }).duration_hours
  const durNum =
    durRaw === undefined || durRaw === null
      ? 0
      : typeof durRaw === 'number'
        ? durRaw
        : typeof durRaw === 'string'
          ? Number(durRaw)
          : NaN
  if (!Number.isFinite(durNum) || durNum < 0) {
    return {
      ok: false,
      error: 'planned_duration must be a non-negative number.',
    }
  }

  if (!planKey || !shortText) {
    return { ok: false, error: 'plan_key and short_text are required.' }
  }
  const instructionTrimmed = instructionText.trim()
  if (!instructionTrimmed) {
    return { ok: false, error: 'Instruction text cannot be empty.' }
  }
  if (instructionTrimmed.length > 2000) {
    return {
      ok: false,
      error: 'Instruction text must be at most 2000 characters.',
    }
  }
  if (!assetIdRaw || !UUID_RE.test(assetIdRaw)) {
    return { ok: false, error: 'A valid asset_id is required.' }
  }
  const catParsed = parseCategoryIdFromFields(o.category_id)
  if (catParsed === 'invalid') {
    return { ok: false, error: 'category_id must be a valid UUID or null.' }
  }

  const wiBody = { work_instructions: o.work_instructions }
  const wiParsed = parseWorkInstructionsInput(wiBody)
  if (!wiParsed.ok) {
    return { ok: false, error: wiParsed.error }
  }

  const ar = await pool.query<{ site_id: string }>(
    `SELECT site_id FROM assets WHERE id = $1`,
    [assetIdRaw],
  )
  const assetRow = ar.rows[0]
  if (!assetRow || assetRow.site_id !== siteId) {
    return {
      ok: false,
      error: 'Asset not found or not in your working site.',
    }
  }

  if (catParsed !== null) {
    const cr = await pool.query<{ id: string }>(
      `SELECT id FROM categories WHERE id = $1 AND site_id = $2`,
      [catParsed, siteId],
    )
    if (cr.rows.length === 0) {
      return {
        ok: false,
        error: 'category_id must reference a category for your working site.',
      }
    }
  }

  const payload: Record<string, unknown> = {
    plan_key: planKey.slice(0, 200),
    short_text: shortText.slice(0, 200),
    instruction_text: instructionTrimmed,
    asset_id: assetIdRaw,
    interval_count: intervalCount,
    interval_time_type: intervalParsed,
    due_date: dueParsed.toISOString(),
    lead_time_days: leadNum,
    planned_duration: durNum,
    category_id: catParsed,
  }
  if (wiParsed.items.length > 0) {
    payload.work_instructions = wiParsed.items
  }
  return { ok: true, payload }
}

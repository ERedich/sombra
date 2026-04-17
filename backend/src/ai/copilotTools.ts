import { randomUUID } from 'node:crypto'
import type { ClientAction } from '@sombra/shared'
import {
  KIRA_NAV_APP_IDS,
  isKiraUuid,
  validateClientNavigationToolInput,
} from '@sombra/shared'
import type { Pool } from 'pg'
import { runAiSuggest } from './suggestOrchestrator.js'
import type {
  AiAssetDraft,
  AiSuggestResponse,
  AiWorkOrderDraft,
} from './suggestTypes.js'
import {
  validateAndResolveAssetDraft,
  validateAndResolveWorkOrderDraft,
} from './suggestValidate.js'
import {
  getAssetDetailsForSite,
  getSiteReferenceCounts,
  getWorkingSiteDetailsForCopilot,
  getWorkOrderDetailsForSite,
  getWorkPlanDetailsForSite,
  isCopilotWorkOrderStatus,
  listOpenWorkOrdersBrief,
  listWorkTypesForSite,
  loadAiSuggestContextForSite,
  searchAssetsForSite,
  searchWorkOrdersForSite,
  searchWorkPlansForSite,
  type CopilotWorkOrderStatus,
} from './copilotContext.js'
import {
  fetchCopilotSchedulingSnapshot,
  listShiftDefinitionsForSite,
  parseOptionalWorkgroupId,
  resolveCopilotSchedulingDateParam,
  validateCopilotSchedulingDates,
  COPILOT_SCHEDULING_MAX_RANGE_DAYS,
} from './copilotSchedulingSnapshot.js'
import { analyzeSchedulingSnapshot } from './schedulingInsights.js'
import { computeCapacityKpis } from './copilotCapacityKpis.js'
import { findAssignableEmployees } from './copilotAssignableEmployees.js'
import { validateWorkPlanCreateForCopilot } from './copilotWorkPlanPayload.js'
import type { CopilotConfirmable } from './copilotTypes.js'

export const COPILOT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'suggest_work_order_draft',
      description:
        'Propose a **work order (WO)** draft from free text — not a recurring **work plan (WP / Arbeitsplan)**. Use for one-off repairs, breakdowns, or tasks. For Arbeitsplan / WP / recurring preventive schedules, use `prepare_create_work_plan` instead; do not use this tool.',
      parameters: {
        type: 'object',
        properties: {
          user_request: { type: 'string', description: 'What the user wants' },
        },
        required: ['user_request'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'suggest_asset_draft',
      description:
        'Propose a new asset draft from free text using site reference lists.',
      parameters: {
        type: 'object',
        properties: {
          user_request: { type: 'string' },
        },
        required: ['user_request'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_assets',
      description:
        'Search assets on the user\'s **current working site** only (key or name, case-insensitive). Empty matches may still leave `total_assets_on_working_site` > 0.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', description: '1–50, default 15' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_working_site',
      description:
        'Return the **current working site** row: id (UUID), key, name, colour, is_plant. Same scope as all other Kira tools. Use when the user asks which site/plant they are on, the site key or name, or Arbeitsstätte / Standort details.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_asset_details',
      description:
        'Load audit metadata for one asset on the **current working site**: created/updated timestamps, creator and last updater (display name and login when available). Use when the user asks who created the asset, when it was created, or similar; requires the asset UUID (from search_assets or pasted by the user).',
      parameters: {
        type: 'object',
        properties: {
          asset_id: {
            type: 'string',
            description: 'Asset UUID on the working site',
          },
        },
        required: ['asset_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_open_work_orders',
      description:
        'List recent **open** work orders on the **current working site**. Each row includes id, wo_key, short_text, status, asset (id, key, name), work_type_key, workgroup (id, key), optional work_plan (id, key), plan_start / plan_end (ISO), and planned_duration_hours (numeric string, hours). Use `get_work_order_details` for a full single WO, or `search_work_orders` to filter by text / status.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: '1–50, default 15' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_work_orders',
      description:
        'Search / filter work orders on the **current working site** by text and/or status. Matches `wo_key` (as text), `short_text`, asset `key` or `name` (ILIKE). Status filter accepts exactly one of: `open`, `in_progress`, `on_hold`, `done`, `closed`, `cancelled`. Returns the same brief shape as `list_open_work_orders` (incl. `planned_duration_hours`, `plan_start`, `plan_end`). Use `get_work_order_details` after this for full fields including instruction_text, assigned employees, and work instructions.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional substring on wo_key, short_text, asset key or name (empty = no text filter).',
          },
          status: {
            type: 'string',
            description:
              'Optional single status filter: open | assigned | started | continued | on_hold | done | closed.',
          },
          limit: { type: 'integer', description: '1–50, default 20' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_work_order_details',
      description:
        'Load one work order on the **current working site** by UUID (`work_order_id`) or numeric `wo_key`. Returns the full WO row: id, wo_key, short_text, instruction_text, status, hold_reason, asset (id, key, name), work_type (id, key, name), workgroup (id, key, name), category, costcenter, source work plan (id, key, if generated from a WP), plan_start / plan_end (ISO), **planned_duration_hours** (numeric string, hours), audit fields (created_at, updated_at, created_by / updated_by login + display name), the list of assigned employees ({id, key, name}), and up to 120 work instruction lines (sort_nr, instruction_text, done). Use this whenever the user asks about planned duration, planned work time, schedule, assignees, or instructions of a specific WO.',
      parameters: {
        type: 'object',
        properties: {
          work_order_id: {
            type: 'string',
            description: 'WO UUID on the working site (preferred if available).',
          },
          wo_key: {
            type: 'integer',
            description:
              'Numeric wo_key on the working site. Either `work_order_id` or `wo_key` must be provided.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_work_types',
      description:
        'List all work order types (work_types: id, key, name, colour) on the **current working site** — used when creating work orders (WO type / PM-CM-BD style keys).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_work_plans',
      description:
        'Search maintenance work plans (WP) on the **current working site**: plan_key, short_text, linked asset, interval (count + day|week|month|year), next_due_at, category, instruction row count. Empty query lists plans ordered by next due. Work plans are preventive schedules; work orders generated from a plan by the due generator always use work type PM (see product rules in the system prompt).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Substring match on plan_key, short_text, asset key or name (optional; empty = all)',
          },
          limit: { type: 'integer', description: '1–50, default 20' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_work_plan_details',
      description:
        'Load one work plan by UUID on the working site: header fields plus up to 80 work instruction lines (sort order, text, done). Use after search_work_plans or when the user provides a plan id.',
      parameters: {
        type: 'object',
        properties: {
          work_plan_id: {
            type: 'string',
            description: 'Work plan UUID on the working site',
          },
        },
        required: ['work_plan_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_scheduling_snapshot',
      description:
        'Read capacity / shift context for the **current working site** only: slim work orders with plan windows overlapping the date range, shift assignments, capacity allocations, and used hours per employee per day. Same overlap rules as the capacity planner UI. Use `request_client_navigation` with app `capacity_planner`, `shift_planner`, or `shifts` to send the user to the matching screen. Date range inclusive: max ' +
        String(COPILOT_SCHEDULING_MAX_RANGE_DAYS) +
        ' days. Output is read-only; changing plans requires user action in the app. **Dates:** pass `YYYY-MM-DD` (ISO). The server also accepts common German forms (`DD.MM.YYYY`, `17. Apr. 2026`) and normalizes them — still convert mentally from the user message so you do not mix up month/day or invent unrelated years.',
      parameters: {
        type: 'object',
        properties: {
          date_from: {
            type: 'string',
            description:
              'Range start: prefer `YYYY-MM-DD`. German users often say DD.MM.YYYY or "17. Apr. 2026" → use `2026-04-17` (never random past years).',
          },
          date_to: {
            type: 'string',
            description:
              'Range end inclusive: same rules as date_from (`YYYY-MM-DD` preferred).',
          },
          workgroup_id: {
            type: 'string',
            description: 'Optional UUID; filter WOs, assignments, and allocations to this workgroup',
          },
          max_work_orders: {
            type: 'integer',
            description: 'Cap on WO rows returned (default 200, max 500)',
          },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_scheduling_issues',
      description:
        'Run deterministic checks on the same scheduling snapshot as `get_scheduling_snapshot`: employee planned hours vs shift length × SPC %, overlapping WO plan windows (same asset / workgroup / shared assigned employee), and capacity-allocation gaps vs planned work order duration. Use when the user asks to run a check, find bottlenecks, collisions, or staffing risks for a date range. Results are **advisory** — cite issue ids; do not imply schedules were changed. Use the **same strict date rules** as `get_scheduling_snapshot` (`YYYY-MM-DD`; align with the user\'s stated calendar, do not substitute 2023 or other unrelated years).',
      parameters: {
        type: 'object',
        properties: {
          date_from: {
            type: 'string',
            description: 'Same as get_scheduling_snapshot date_from (`YYYY-MM-DD` preferred).',
          },
          date_to: {
            type: 'string',
            description: 'Same as get_scheduling_snapshot date_to.',
          },
          workgroup_id: {
            type: 'string',
            description: 'Optional workgroup UUID filter',
          },
          max_work_orders: {
            type: 'integer',
            description: 'Same cap as get_scheduling_snapshot (default 200, max 500)',
          },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_capacity_kpis',
      description:
        'Return aggregated capacity KPIs for the **current working site** over the given date range: `tcp_raw_shift_hours` (sum of planned shift hours), `tcp_effective_hours` = TCP after SPC %, `tpd_hours` (sum of planned_duration of active WOs overlapping the range), `tpd_allocated_hours` (sum of capacity_allocations.planned_hours in range), `tpc_hours = tcp_effective_hours - tpd_hours`, `utilization_pct`, and (optional) per-day breakdown. **Call this before suggesting a new plan_start / plan_end for a postpone or reschedule**, so the answer respects the target week\'s remaining capacity. Negative `tpc_hours` means the target range is already overloaded — warn the user and offer alternatives. Same date rules and `workgroup_id` filter as `get_scheduling_snapshot`.',
      parameters: {
        type: 'object',
        properties: {
          date_from: {
            type: 'string',
            description:
              'Range start: prefer `YYYY-MM-DD`. For a weekly check, pass the Monday of the target week.',
          },
          date_to: {
            type: 'string',
            description:
              'Range end inclusive: prefer `YYYY-MM-DD`. For a weekly check, pass the Sunday of the target week.',
          },
          workgroup_id: {
            type: 'string',
            description:
              'Optional workgroup UUID — restrict TCP / TPD / TPC to that workgroup. Use when the WO being moved belongs to a single team.',
          },
          include_per_day: {
            type: 'boolean',
            description:
              'If true, include a `per_day` array with shift_hours / effective_hours / allocated_hours per date so you can spot the bottleneck day inside the window.',
          },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_assignable_employees',
      description:
        'Return the employees on the current working site who are actually at work during a specific WO plan window, based on their `shift_assignments`. **A `shift_assignments` row IS the plan for that day:** an employee with no row on date D is **not** at work that day — never propose them as "available because nothing is assigned". The WO window `[plan_start, plan_end]` must fit inside the employee\'s shift window on the affected UTC day(s); overnight shifts (e.g. 20:00-06:00 on date D) cover D 20:00 → D+1 06:00 UTC as one continuous window. Presence statuses counted as at-work: `scheduled`, `present` (absences drop the employee with reason `absent`). Response: `{ assignable: [...], partial: [...], excluded_no_shift: [...] }`. Call this before suggesting any assignee for a work order; propose only `assignable` (propose `partial` only if the user accepts splitting/resizing the WO).',
      parameters: {
        type: 'object',
        properties: {
          plan_start: {
            type: 'string',
            description:
              'WO window start, ISO instant (prefer UTC `...Z`). Required unless `work_order_id` / `wo_key` is supplied — in which case the handler reads the WO\'s plan_start.',
          },
          plan_end: {
            type: 'string',
            description:
              'WO window end, ISO instant. Required unless `work_order_id` / `wo_key` is supplied.',
          },
          workgroup_id: {
            type: 'string',
            description:
              'Optional workgroup UUID; restricts employees to that workgroup. Use when one team owns the WO.',
          },
          work_order_id: {
            type: 'string',
            description:
              'Optional WO UUID. If supplied and plan_start / plan_end are missing, the handler reads them from the WO; workgroup_id defaults to the WO\'s workgroup_id when not set.',
          },
          wo_key: {
            type: 'integer',
            description:
              'Optional numeric wo_key (fallback when UUID is not known). Same derivation as work_order_id.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_shift_definitions',
      description:
        'List shift **templates** on the working site (key, name, default time window, weekdays). Not dated assignments — use `get_scheduling_snapshot` for who is scheduled when. Optional navigation: app `shifts`.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'prepare_create_work_order',
      description:
        'Validate fields and register a confirmable payload for POST /api/work-orders (**single WO / Arbeitsauftrag**). Do **not** use for **work plans (WP / Arbeitsplan)** — use `prepare_create_work_plan` for those. Only call when required fields are known (or can be inferred). Does not create the record.',
      parameters: {
        type: 'object',
        properties: {
          short_text: { type: 'string' },
          instruction_text: { type: 'string' },
          asset_id: { type: 'string' },
          work_type_id: { type: 'string' },
          workgroup_id: { type: 'string' },
          category_id: {
            type: 'string',
            description: 'UUID or empty string for none',
          },
          planned_duration: { type: 'number' },
          plan_start: {
            type: 'string',
            description: 'ISO date/time or empty for none',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'prepare_update_work_order',
      description:
        'Register a confirmable **PATCH** payload for an existing work order on the working site (PATCH /api/work-orders/:id). **Use this for postponing / rescheduling / changing a WO** (plan_start, plan_end, planned_duration, status change, retyping, reassigning workgroup, etc.) — **not** `prepare_create_work_order`, which creates a brand-new WO. Identify the WO by `work_order_id` (UUID) or `wo_key` (integer). Only fields you include are patched; omit fields that should stay unchanged. Dates must be ISO 8601 (prefer UTC `...Z`); for a postpone, **set both** `plan_start` and `plan_end` to keep duration consistent, or set `planned_duration` (hours) alongside. Returns a confirmable; the user must tap Confirm in the app to apply the change.',
      parameters: {
        type: 'object',
        properties: {
          work_order_id: {
            type: 'string',
            description: 'WO UUID on the working site (preferred).',
          },
          wo_key: {
            type: 'integer',
            description:
              'Numeric wo_key on the working site. Provide either work_order_id or wo_key.',
          },
          short_text: { type: 'string', description: 'New short title.' },
          instruction_text: {
            type: 'string',
            description: 'New main instruction text (max 2000 chars).',
          },
          asset_id: { type: 'string', description: 'New asset UUID on the working site.' },
          work_type_id: {
            type: 'string',
            description: 'New work type UUID on the working site.',
          },
          workgroup_id: {
            type: 'string',
            description: 'New workgroup UUID on the working site.',
          },
          category_id: {
            type: 'string',
            description: 'New category UUID (empty string to clear).',
          },
          plan_start: {
            type: 'string',
            description:
              'New start (ISO 8601, prefer UTC `...Z`). Empty string to clear. For pure postpone, include plan_end too.',
          },
          plan_end: {
            type: 'string',
            description:
              'New end (ISO 8601, prefer UTC `...Z`). Empty string to clear.',
          },
          planned_duration: {
            type: 'number',
            description:
              'New planned duration in hours (>= 0). Can be used alone (keep start) or together with plan_start/plan_end.',
          },
          status: {
            type: 'string',
            description:
              'New status: one of open | assigned | started | continued | on_hold | done | closed.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'prepare_create_work_plan',
      description:
        'Validate fields and register a confirmable payload for POST /api/work-plans (**maintenance plan / WP / DE Arbeitsplan**: recurring schedule on an asset). Requires plan_key, short_text, instruction_text, asset_id, interval_count, interval_time_type (day|week|month|year), due_date (ISO). Optional: lead_time_days (default 0), planned_duration (default 0), category_id (UUID or omit), work_instructions (checklist lines). Does not create the record.',
      parameters: {
        type: 'object',
        properties: {
          plan_key: {
            type: 'string',
            description: 'Unique key for this plan on the site (e.g. PM-PUMP-01)',
          },
          short_text: { type: 'string', description: 'Short title' },
          instruction_text: {
            type: 'string',
            description: 'Main plan instructions (required; max 2000 chars)',
          },
          asset_id: { type: 'string', description: 'Asset UUID on the site' },
          interval_count: {
            type: 'integer',
            description: 'Repeat every N intervals (integer >= 1)',
          },
          interval_time_type: {
            type: 'string',
            enum: ['day', 'week', 'month', 'year'],
          },
          due_date: {
            type: 'string',
            description: 'First/next due instant as ISO 8601',
          },
          lead_time_days: {
            type: 'integer',
            description: 'Optional; default 0',
          },
          planned_duration: {
            type: 'number',
            description: 'Optional; default 0',
          },
          category_id: {
            type: 'string',
            description: 'Optional category UUID; omit or empty for none',
          },
          work_instructions: {
            type: 'array',
            description:
              'Optional checklist lines; each instruction_text max 200 chars',
            items: {
              type: 'object',
              properties: {
                sort_nr: { type: 'integer' },
                instruction_text: { type: 'string' },
              },
              required: ['sort_nr', 'instruction_text'],
            },
          },
        },
        required: [
          'plan_key',
          'short_text',
          'instruction_text',
          'asset_id',
          'interval_count',
          'interval_time_type',
          'due_date',
        ],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'prepare_create_asset',
      description:
        'Validate fields and register a confirmable payload for POST /api/assets. Does not create the record.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          asset_type: {
            type: 'string',
            enum: [
              'location',
              'building',
              'group',
              'maintenance_object',
            ],
          },
          parent_asset_id: { type: 'string', description: 'UUID or empty' },
          costcenter_id: { type: 'string', description: 'UUID or empty' },
          asset_classification_id: {
            type: 'string',
            description: 'UUID or empty',
          },
          equipment_number: { type: 'string' },
          serial_no: { type: 'string' },
          build_year: { type: 'integer' },
          warranty_end: { type: 'string', description: 'YYYY-MM-DD or empty' },
          priority: { type: 'integer', description: '1–5 or omit' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'request_client_navigation',
      description:
        'Open a CMMS screen in the user\'s browser or mobile app. Validated server-side; optional entity_id deep-links assets, workgroups, or work orders. Kira stays open by default; set close_kira true only if the user wants the assistant closed. Use shell_action open_kira only when the user should open the assistant from elsewhere (rare).',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            enum: [...KIRA_NAV_APP_IDS],
            description:
              'Logical app id (e.g. assets, work_orders, workgroups, home). Omit when using shell_action.',
          },
          entity_id: {
            type: 'string',
            description:
              'Optional UUID for deep link; only for apps that support it (assets, workgroups, work_orders).',
          },
          close_kira: {
            type: 'boolean',
            description:
              'If true, close Kira after navigating. Default false — Kira stays open so the user can keep chatting.',
          },
          shell_action: {
            type: 'string',
            enum: ['open_kira'],
            description:
              'Open Kira modal instead of routing. Do not pass together with app.',
          },
        },
      },
    },
  },
] as const

export type CopilotToolContext = {
  pool: Pool
  siteId: string
  /** UI / auth locale (e.g. de, en); used to parse scheduling date strings). */
  locale: string
  confirmables: CopilotConfirmable[]
  clientActions: ClientAction[]
  isAdmin: boolean
}

function parseSchedulingToolDateRange(
  o: Record<string, unknown>,
  locale: string,
):
  | { ok: true; date_from: string; date_to: string }
  | { ok: false; error: string } {
  const rawFrom =
    typeof o.date_from === 'string' ? o.date_from.trim() : ''
  const rawTo = typeof o.date_to === 'string' ? o.date_to.trim() : ''
  if (!rawFrom || !rawTo) {
    return { ok: false, error: 'date_from and date_to are required strings.' }
  }
  const rFrom = resolveCopilotSchedulingDateParam(rawFrom, locale)
  if (!rFrom.ok) {
    return {
      ok: false,
      error: `date_from: ${rFrom.error} (received ${JSON.stringify(rawFrom)}).`,
    }
  }
  const rTo = resolveCopilotSchedulingDateParam(rawTo, locale)
  if (!rTo.ok) {
    return {
      ok: false,
      error: `date_to: ${rTo.error} (received ${JSON.stringify(rawTo)}).`,
    }
  }
  const dr = validateCopilotSchedulingDates({
    date_from: rFrom.iso,
    date_to: rTo.iso,
  })
  if (!dr.ok) {
    return { ok: false, error: dr.error }
  }
  return { ok: true, date_from: dr.date_from, date_to: dr.date_to }
}

function summarizeSuggestResponse(r: AiSuggestResponse): Record<string, unknown> {
  const candSummary: Record<string, { id: string; label: string }[]> = {}
  for (const [k, arr] of Object.entries(r.candidates)) {
    candSummary[k] = arr.slice(0, 6).map((c) => ({
      id: c.id,
      label: c.label,
    }))
  }
  return {
    kind: r.kind,
    unresolved: r.unresolved,
    validated: r.validated,
    candidate_preview: candSummary,
    warnings: r.warnings,
  }
}

function workOrderPayloadReady(v: AiWorkOrderDraft): boolean {
  return Boolean(
    v.short_text?.trim() &&
      v.instruction_text?.trim() &&
      v.asset_id &&
      v.work_type_id &&
      v.workgroup_id &&
      v.planned_duration != null &&
      Number.isFinite(v.planned_duration) &&
      v.planned_duration >= 0,
  )
}

function assetPayloadReady(v: AiAssetDraft): boolean {
  return Boolean(v.key?.trim() && v.name?.trim() && v.asset_type)
}

function transcriptForRanking(parts: string[]): string {
  return parts
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 8000)
}

const WORK_ORDER_PATCH_STATUSES = new Set<string>([
  'open',
  'assigned',
  'started',
  'continued',
  'on_hold',
  'done',
  'closed',
])

function parseIsoOrEmpty(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'Must be ISO 8601 string or empty.' }
  const s = v.trim()
  if (!s) return { ok: true, value: null }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'Must be a valid ISO 8601 date/time.' }
  }
  return { ok: true, value: d.toISOString() }
}

type ExecCtx = {
  pool: Pool
  siteId: string
  locale: string
  confirmables: CopilotConfirmable[]
  clientActions: ClientAction[]
  isAdmin: boolean
}

async function isAssetOnSite(pool: Pool, siteId: string, assetId: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM assets WHERE id = $1::uuid AND site_id = $2::uuid`,
    [assetId, siteId],
  )
  return r.rowCount === 1
}

async function isWorkTypeOnSite(pool: Pool, siteId: string, id: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM work_types WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rowCount === 1
}

async function isWorkgroupOnSite(pool: Pool, siteId: string, id: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM workgroups WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rowCount === 1
}

async function isCategoryOnSite(pool: Pool, siteId: string, id: string): Promise<boolean> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM categories WHERE id = $1::uuid AND site_id = $2::uuid`,
    [id, siteId],
  )
  return r.rowCount === 1
}

async function preparePatchWorkOrder(
  ctx: ExecCtx,
  o: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const idRaw = o.work_order_id
  const keyRaw = o.wo_key
  const idIn = typeof idRaw === 'string' ? idRaw.trim() : ''
  const woKey =
    typeof keyRaw === 'number' && Number.isFinite(keyRaw)
      ? Math.trunc(keyRaw)
      : typeof keyRaw === 'string' && /^\d+$/.test(keyRaw.trim())
        ? Number.parseInt(keyRaw.trim(), 10)
        : null
  if (!idIn && (woKey === null || woKey <= 0)) {
    return {
      ok: false,
      error: 'Provide work_order_id (UUID) or wo_key (positive integer).',
    }
  }
  if (idIn && !isKiraUuid(idIn)) {
    return { ok: false, error: 'work_order_id must be a valid UUID.' }
  }

  const before = await getWorkOrderDetailsForSite(ctx.pool, ctx.siteId, {
    id: idIn || null,
    wo_key: woKey,
  })
  if (!before) {
    return {
      ok: false,
      error:
        'Work order not found on this working site. Check wo_key / id or switch site.',
    }
  }

  const patch: Record<string, unknown> = {}
  const changes: Record<string, { before: unknown; after: unknown }> = {}

  if (typeof o.short_text === 'string') {
    const v = o.short_text.trim()
    if (!v) return { ok: false, error: 'short_text cannot be empty.' }
    if (v !== before.short_text) {
      patch.short_text = v
      changes.short_text = { before: before.short_text, after: v }
    }
  }

  if (typeof o.instruction_text === 'string') {
    const v = o.instruction_text.trim()
    if (!v) return { ok: false, error: 'instruction_text cannot be empty.' }
    if (v.length > 2000) {
      return { ok: false, error: 'instruction_text must be at most 2000 chars.' }
    }
    if (v !== before.instruction_text) {
      patch.instruction_text = v
      changes.instruction_text = { before: before.instruction_text, after: v }
    }
  }

  if (typeof o.asset_id === 'string' && o.asset_id.trim()) {
    const v = o.asset_id.trim()
    if (!isKiraUuid(v)) return { ok: false, error: 'asset_id must be a valid UUID.' }
    if (!(await isAssetOnSite(ctx.pool, ctx.siteId, v))) {
      return { ok: false, error: 'asset_id is not on the current working site.' }
    }
    if (v !== before.asset_id) {
      patch.asset_id = v
      changes.asset_id = { before: before.asset_id, after: v }
    }
  }

  if (typeof o.work_type_id === 'string' && o.work_type_id.trim()) {
    const v = o.work_type_id.trim()
    if (!isKiraUuid(v)) return { ok: false, error: 'work_type_id must be a valid UUID.' }
    if (!(await isWorkTypeOnSite(ctx.pool, ctx.siteId, v))) {
      return { ok: false, error: 'work_type_id is not on the current working site.' }
    }
    if (v !== before.work_type_id) {
      patch.work_type_id = v
      changes.work_type_id = { before: before.work_type_id, after: v }
    }
  }

  if (typeof o.workgroup_id === 'string' && o.workgroup_id.trim()) {
    const v = o.workgroup_id.trim()
    if (!isKiraUuid(v)) return { ok: false, error: 'workgroup_id must be a valid UUID.' }
    if (!(await isWorkgroupOnSite(ctx.pool, ctx.siteId, v))) {
      return { ok: false, error: 'workgroup_id is not on the current working site.' }
    }
    if (v !== before.workgroup_id) {
      patch.workgroup_id = v
      changes.workgroup_id = { before: before.workgroup_id, after: v }
    }
  }

  if ('category_id' in o) {
    const raw = o.category_id
    let next: string | null = null
    if (typeof raw === 'string' && raw.trim()) {
      const v = raw.trim()
      if (!isKiraUuid(v)) return { ok: false, error: 'category_id must be a valid UUID or empty.' }
      if (!(await isCategoryOnSite(ctx.pool, ctx.siteId, v))) {
        return { ok: false, error: 'category_id is not on the current working site.' }
      }
      next = v
    }
    if (next !== before.category_id) {
      patch.category_id = next
      changes.category_id = { before: before.category_id, after: next }
    }
  }

  if ('plan_start' in o) {
    const p = parseIsoOrEmpty(o.plan_start)
    if (!p.ok) return { ok: false, error: `plan_start: ${p.error}` }
    if (p.value !== before.plan_start) {
      patch.plan_start = p.value
      changes.plan_start = { before: before.plan_start, after: p.value }
    }
  }

  if ('plan_end' in o) {
    const p = parseIsoOrEmpty(o.plan_end)
    if (!p.ok) return { ok: false, error: `plan_end: ${p.error}` }
    if (p.value !== before.plan_end) {
      patch.plan_end = p.value
      changes.plan_end = { before: before.plan_end, after: p.value }
    }
  }

  if ('planned_duration' in o) {
    const raw = o.planned_duration
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : NaN
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'planned_duration must be a non-negative number (hours).' }
    }
    const beforeNum = Number(before.planned_duration_hours)
    if (!Number.isFinite(beforeNum) || beforeNum !== n) {
      patch.planned_duration = n
      changes.planned_duration = {
        before: before.planned_duration_hours,
        after: n,
      }
    }
  }

  if (typeof o.status === 'string' && o.status.trim()) {
    const v = o.status.trim()
    if (!WORK_ORDER_PATCH_STATUSES.has(v)) {
      return {
        ok: false,
        error:
          'status must be one of: open, assigned, started, continued, on_hold, done, closed.',
      }
    }
    if (v !== before.status) {
      patch.status = v
      changes.status = { before: before.status, after: v }
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error:
        'No changes detected: the provided fields already match the work order. Include at least one different field.',
    }
  }

  const confId = randomUUID()
  ctx.confirmables.push({
    id: confId,
    type: 'update_work_order',
    work_order_id: before.id,
    wo_key: before.wo_key,
    payload: patch,
    summary: { short_text: before.short_text, changes },
  })

  return {
    ok: true,
    confirmable_id: confId,
    message:
      'Patch validated. The user must tap Confirm in the app to apply the change to the work order.',
    work_order: {
      id: before.id,
      wo_key: before.wo_key,
      short_text: before.short_text,
    },
    changes,
  }
}

export async function executeCopilotTool(args: {
  name: string
  argumentsJson: string
  ctx: CopilotToolContext
}): Promise<string> {
  const { name, ctx } = args
  let parsed: unknown
  try {
    parsed = args.argumentsJson?.trim()
      ? (JSON.parse(args.argumentsJson) as unknown)
      : {}
  } catch {
    return JSON.stringify({ ok: false, error: 'Invalid JSON arguments.' })
  }
  const o = typeof parsed === 'object' && parsed !== null ? parsed : {}

  try {
    switch (name) {
      case 'suggest_work_order_draft': {
        const user_request =
          typeof (o as { user_request?: unknown }).user_request === 'string'
            ? (o as { user_request: string }).user_request.trim()
            : ''
        if (!user_request) {
          return JSON.stringify({ ok: false, error: 'user_request required.' })
        }
        const context = await loadAiSuggestContextForSite(ctx.pool, ctx.siteId)
        const missingAssets = !context.assets?.length
        const missingWt = !context.work_types?.length
        const missingWg = !context.workgroups?.length
        if (missingAssets || missingWt || missingWg) {
          const counts = await getSiteReferenceCounts(ctx.pool, ctx.siteId)
          const parts: string[] = []
          if (missingAssets) parts.push('assets')
          if (missingWt) parts.push('work_types')
          if (missingWg) parts.push('workgroups')
          return JSON.stringify({
            ok: false,
            error: `Cannot draft work orders: this working site has no reference rows for: ${parts.join(', ')}.`,
            counts_on_working_site: counts,
            hint:
              'If the user sees assets elsewhere in the app, their **working site** may differ from that plant — they should switch working site and retry.',
          })
        }
        const r = await runAiSuggest({
          pool: ctx.pool,
          siteId: ctx.siteId,
          kind: 'work_order',
          transcript: user_request,
          context,
        })
        return JSON.stringify({ ok: true, ...summarizeSuggestResponse(r) })
      }
      case 'suggest_asset_draft': {
        const user_request =
          typeof (o as { user_request?: unknown }).user_request === 'string'
            ? (o as { user_request: string }).user_request.trim()
            : ''
        if (!user_request) {
          return JSON.stringify({ ok: false, error: 'user_request required.' })
        }
        const context = await loadAiSuggestContextForSite(ctx.pool, ctx.siteId)
        const r = await runAiSuggest({
          pool: ctx.pool,
          siteId: ctx.siteId,
          kind: 'asset',
          transcript: user_request,
          context,
        })
        return JSON.stringify({ ok: true, ...summarizeSuggestResponse(r) })
      }
      case 'search_assets': {
        const query =
          typeof (o as { query?: unknown }).query === 'string'
            ? (o as { query: string }).query
            : ''
        const limit =
          typeof (o as { limit?: unknown }).limit === 'number'
            ? (o as { limit: number }).limit
            : 15
        const rows = await searchAssetsForSite(ctx.pool, ctx.siteId, query, limit)
        if (rows.length === 0) {
          const counts = await getSiteReferenceCounts(ctx.pool, ctx.siteId)
          return JSON.stringify({
            ok: true,
            assets: rows,
            total_assets_on_working_site: counts.assets,
          })
        }
        return JSON.stringify({ ok: true, assets: rows })
      }
      case 'get_working_site': {
        const site = await getWorkingSiteDetailsForCopilot(
          ctx.pool,
          ctx.siteId,
        )
        if (!site) {
          return JSON.stringify({
            ok: false,
            error: 'Working site not found for this session.',
          })
        }
        return JSON.stringify({ ok: true, site })
      }
      case 'get_asset_details': {
        const asset_id =
          typeof (o as { asset_id?: unknown }).asset_id === 'string'
            ? (o as { asset_id: string }).asset_id.trim()
            : ''
        if (!asset_id) {
          return JSON.stringify({ ok: false, error: 'asset_id required.' })
        }
        const detail = await getAssetDetailsForSite(
          ctx.pool,
          ctx.siteId,
          asset_id,
        )
        if (!detail) {
          return JSON.stringify({
            ok: false,
            error:
              'Asset not found on this working site, or asset_id is not a valid UUID.',
          })
        }
        return JSON.stringify({ ok: true, asset: detail })
      }
      case 'list_open_work_orders': {
        const limit =
          typeof (o as { limit?: unknown }).limit === 'number'
            ? (o as { limit: number }).limit
            : 15
        const rows = await listOpenWorkOrdersBrief(
          ctx.pool,
          ctx.siteId,
          limit,
        )
        return JSON.stringify({ ok: true, work_orders: rows })
      }
      case 'search_work_orders': {
        const query =
          typeof (o as { query?: unknown }).query === 'string'
            ? (o as { query: string }).query
            : ''
        const statusRaw = (o as { status?: unknown }).status
        let status: CopilotWorkOrderStatus | null = null
        if (typeof statusRaw === 'string' && statusRaw.trim()) {
          if (!isCopilotWorkOrderStatus(statusRaw.trim())) {
            return JSON.stringify({
              ok: false,
              error:
                'status must be one of: open, in_progress, on_hold, done, closed, cancelled.',
            })
          }
          status = statusRaw.trim() as CopilotWorkOrderStatus
        }
        const limit =
          typeof (o as { limit?: unknown }).limit === 'number'
            ? (o as { limit: number }).limit
            : 20
        const rows = await searchWorkOrdersForSite(
          ctx.pool,
          ctx.siteId,
          query,
          status,
          limit,
        )
        return JSON.stringify({ ok: true, work_orders: rows })
      }
      case 'get_work_order_details': {
        const idRaw = (o as { work_order_id?: unknown }).work_order_id
        const keyRaw = (o as { wo_key?: unknown }).wo_key
        const id = typeof idRaw === 'string' ? idRaw.trim() : ''
        const woKey =
          typeof keyRaw === 'number' && Number.isFinite(keyRaw)
            ? Math.trunc(keyRaw)
            : typeof keyRaw === 'string' && /^\d+$/.test(keyRaw.trim())
              ? Number.parseInt(keyRaw.trim(), 10)
              : null
        if (!id && (woKey === null || woKey <= 0)) {
          return JSON.stringify({
            ok: false,
            error: 'Provide work_order_id (UUID) or wo_key (positive integer).',
          })
        }
        const detail = await getWorkOrderDetailsForSite(ctx.pool, ctx.siteId, {
          id: id || null,
          wo_key: woKey,
        })
        if (!detail) {
          return JSON.stringify({
            ok: false,
            error:
              'Work order not found on this working site (check wo_key / id and working site).',
          })
        }
        return JSON.stringify({ ok: true, work_order: detail })
      }
      case 'list_work_types': {
        const rows = await listWorkTypesForSite(ctx.pool, ctx.siteId)
        return JSON.stringify({ ok: true, work_types: rows })
      }
      case 'search_work_plans': {
        const query =
          typeof (o as { query?: unknown }).query === 'string'
            ? (o as { query: string }).query
            : ''
        const limit =
          typeof (o as { limit?: unknown }).limit === 'number'
            ? (o as { limit: number }).limit
            : 20
        const rows = await searchWorkPlansForSite(
          ctx.pool,
          ctx.siteId,
          query,
          limit,
        )
        return JSON.stringify({ ok: true, work_plans: rows })
      }
      case 'get_work_plan_details': {
        const work_plan_id =
          typeof (o as { work_plan_id?: unknown }).work_plan_id === 'string'
            ? (o as { work_plan_id: string }).work_plan_id.trim()
            : ''
        if (!work_plan_id) {
          return JSON.stringify({ ok: false, error: 'work_plan_id required.' })
        }
        const detail = await getWorkPlanDetailsForSite(
          ctx.pool,
          ctx.siteId,
          work_plan_id,
        )
        if (!detail) {
          return JSON.stringify({
            ok: false,
            error:
              'Work plan not found on this working site, or work_plan_id is not a valid UUID.',
          })
        }
        return JSON.stringify({ ok: true, work_plan: detail })
      }
      case 'get_scheduling_snapshot': {
        const range = parseSchedulingToolDateRange(o as Record<string, unknown>, ctx.locale)
        if (!range.ok) {
          return JSON.stringify({ ok: false, error: range.error })
        }
        const wg = parseOptionalWorkgroupId(
          (o as { workgroup_id?: unknown }).workgroup_id,
        )
        if (!wg.ok) {
          return JSON.stringify({ ok: false, error: wg.error })
        }
        const maxRaw = (o as { max_work_orders?: unknown }).max_work_orders
        const maxWo =
          typeof maxRaw === 'number' && Number.isFinite(maxRaw)
            ? Math.min(500, Math.max(1, Math.floor(maxRaw)))
            : undefined
        try {
          const snapshot = await fetchCopilotSchedulingSnapshot({
            pool: ctx.pool,
            siteId: ctx.siteId,
            dateFrom: range.date_from,
            dateTo: range.date_to,
            workgroupId: wg.workgroup_id,
            maxWorkOrders: maxWo,
          })
          return JSON.stringify({ ok: true, ...snapshot })
        } catch (e) {
          return JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      case 'analyze_scheduling_issues': {
        const range = parseSchedulingToolDateRange(o as Record<string, unknown>, ctx.locale)
        if (!range.ok) {
          return JSON.stringify({ ok: false, error: range.error })
        }
        const wg = parseOptionalWorkgroupId(
          (o as { workgroup_id?: unknown }).workgroup_id,
        )
        if (!wg.ok) {
          return JSON.stringify({ ok: false, error: wg.error })
        }
        const maxRaw = (o as { max_work_orders?: unknown }).max_work_orders
        const maxWo =
          typeof maxRaw === 'number' && Number.isFinite(maxRaw)
            ? Math.min(500, Math.max(1, Math.floor(maxRaw)))
            : undefined
        try {
          const snapshot = await fetchCopilotSchedulingSnapshot({
            pool: ctx.pool,
            siteId: ctx.siteId,
            dateFrom: range.date_from,
            dateTo: range.date_to,
            workgroupId: wg.workgroup_id,
            maxWorkOrders: maxWo,
          })
          const analysis = analyzeSchedulingSnapshot(snapshot)
          return JSON.stringify({
            ok: true,
            meta: snapshot.meta,
            issues: analysis.issues,
            summary: analysis.summary,
          })
        } catch (e) {
          return JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      case 'get_capacity_kpis': {
        const range = parseSchedulingToolDateRange(o as Record<string, unknown>, ctx.locale)
        if (!range.ok) {
          return JSON.stringify({ ok: false, error: range.error })
        }
        const wg = parseOptionalWorkgroupId(
          (o as { workgroup_id?: unknown }).workgroup_id,
        )
        if (!wg.ok) {
          return JSON.stringify({ ok: false, error: wg.error })
        }
        const includeRaw = (o as { include_per_day?: unknown }).include_per_day
        const includePerDay = includeRaw === true
        try {
          const snapshot = await fetchCopilotSchedulingSnapshot({
            pool: ctx.pool,
            siteId: ctx.siteId,
            dateFrom: range.date_from,
            dateTo: range.date_to,
            workgroupId: wg.workgroup_id,
          })
          const kpis = computeCapacityKpis(snapshot, {
            include_per_day: includePerDay,
          })
          return JSON.stringify({ ok: true, meta: snapshot.meta, kpis })
        } catch (e) {
          return JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      case 'find_assignable_employees': {
        const oo = o as {
          plan_start?: unknown
          plan_end?: unknown
          workgroup_id?: unknown
          work_order_id?: unknown
          wo_key?: unknown
        }
        let planStart =
          typeof oo.plan_start === 'string' && oo.plan_start.trim()
            ? oo.plan_start.trim()
            : null
        let planEnd =
          typeof oo.plan_end === 'string' && oo.plan_end.trim()
            ? oo.plan_end.trim()
            : null
        let workgroupId =
          typeof oo.workgroup_id === 'string' && oo.workgroup_id.trim()
            ? oo.workgroup_id.trim()
            : null

        if (!planStart || !planEnd) {
          const woIdRaw =
            typeof oo.work_order_id === 'string' && oo.work_order_id.trim()
              ? oo.work_order_id.trim()
              : null
          const woKeyRaw =
            typeof oo.wo_key === 'number' && Number.isFinite(oo.wo_key)
              ? Math.trunc(oo.wo_key)
              : null
          if (!woIdRaw && (woKeyRaw === null || woKeyRaw <= 0)) {
            return JSON.stringify({
              ok: false,
              error:
                'plan_start and plan_end are required unless work_order_id or wo_key is supplied.',
            })
          }
          const wo = await getWorkOrderDetailsForSite(ctx.pool, ctx.siteId, {
            id: woIdRaw,
            wo_key: woKeyRaw,
          })
          if (!wo) {
            return JSON.stringify({
              ok: false,
              error:
                'Work order not found on this working site, or the identifier is not valid.',
            })
          }
          if (!wo.plan_start || !wo.plan_end) {
            return JSON.stringify({
              ok: false,
              error: `Work order ${wo.wo_key} has no plan_start / plan_end set; cannot compute availability.`,
            })
          }
          planStart = planStart ?? wo.plan_start
          planEnd = planEnd ?? wo.plan_end
          if (!workgroupId) workgroupId = wo.workgroup_id ?? null
        }

        if (workgroupId) {
          const wg = parseOptionalWorkgroupId(workgroupId)
          if (!wg.ok) {
            return JSON.stringify({ ok: false, error: wg.error })
          }
          workgroupId = wg.workgroup_id
        }

        const startMs = Date.parse(planStart)
        const endMs = Date.parse(planEnd)
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
          return JSON.stringify({
            ok: false,
            error: 'Invalid plan_start / plan_end (must be ISO instants with plan_start < plan_end).',
          })
        }
        const dateFromMs = startMs - 86_400_000
        const dateFrom = new Date(dateFromMs).toISOString().slice(0, 10)
        const dateTo = new Date(endMs - 1).toISOString().slice(0, 10)

        try {
          const snapshot = await fetchCopilotSchedulingSnapshot({
            pool: ctx.pool,
            siteId: ctx.siteId,
            dateFrom,
            dateTo,
            workgroupId,
          })
          const res = findAssignableEmployees(snapshot, {
            plan_start: planStart,
            plan_end: planEnd,
            workgroup_id: workgroupId,
          })
          if (!res.ok) {
            return JSON.stringify({ ok: false, error: res.error })
          }
          return JSON.stringify({ ok: true, ...res.result })
        } catch (e) {
          return JSON.stringify({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      case 'list_shift_definitions': {
        const shifts = await listShiftDefinitionsForSite(ctx.pool, ctx.siteId)
        return JSON.stringify({ ok: true, shifts })
      }
      case 'prepare_create_work_order': {
        const catRaw = (o as { category_id?: unknown }).category_id
        const planRaw = (o as { plan_start?: unknown }).plan_start
        const raw: Partial<AiWorkOrderDraft> = {
          short_text:
            typeof (o as { short_text?: unknown }).short_text === 'string'
              ? (o as { short_text: string }).short_text
              : null,
          instruction_text:
            typeof (o as { instruction_text?: unknown }).instruction_text ===
            'string'
              ? (o as { instruction_text: string }).instruction_text
              : null,
          asset_id:
            typeof (o as { asset_id?: unknown }).asset_id === 'string'
              ? (o as { asset_id: string }).asset_id
              : null,
          work_type_id:
            typeof (o as { work_type_id?: unknown }).work_type_id === 'string'
              ? (o as { work_type_id: string }).work_type_id
              : null,
          workgroup_id:
            typeof (o as { workgroup_id?: unknown }).workgroup_id === 'string'
              ? (o as { workgroup_id: string }).workgroup_id
              : null,
          category_id:
            catRaw === null || catRaw === undefined
              ? null
              : typeof catRaw === 'string' && catRaw.trim()
                ? catRaw.trim()
                : null,
          planned_duration:
            typeof (o as { planned_duration?: unknown }).planned_duration ===
            'number'
              ? (o as { planned_duration: number }).planned_duration
              : typeof (o as { duration?: unknown }).duration === 'number'
                ? (o as { duration: number }).duration
                : typeof (o as { worktime?: unknown }).worktime === 'number'
                  ? (o as { worktime: number }).worktime
                  : null,
          plan_start:
            planRaw === null || planRaw === undefined
              ? null
              : typeof planRaw === 'string' && planRaw.trim()
                ? planRaw.trim()
                : null,
        }
        const context = await loadAiSuggestContextForSite(ctx.pool, ctx.siteId)
        const tx = transcriptForRanking([
          raw.short_text ?? '',
          raw.instruction_text ?? '',
        ])
        const { validated, unresolved } =
          await validateAndResolveWorkOrderDraft(
            ctx.pool,
            ctx.siteId,
            tx,
            raw,
            context,
          )
        if (!workOrderPayloadReady(validated)) {
          return JSON.stringify({
            ok: false,
            error: 'Required work order fields missing or invalid.',
            unresolved,
            validated,
          })
        }
        const id = randomUUID()
        const payload: Record<string, unknown> = {
          short_text: validated.short_text!.trim(),
          instruction_text: validated.instruction_text!.trim(),
          asset_id: validated.asset_id!,
          work_type_id: validated.work_type_id!,
          workgroup_id: validated.workgroup_id!,
          planned_duration: validated.planned_duration ?? 0,
          category_id: validated.category_id ?? null,
          plan_start: validated.plan_start ?? null,
        }
        ctx.confirmables.push({ id, type: 'create_work_order', payload })
        return JSON.stringify({
          ok: true,
          confirmable_id: id,
          message:
            'Payload validated. The user must tap Confirm in the app to create the work order.',
          summary: {
            short_text: payload.short_text,
            asset_id: payload.asset_id,
            work_type_id: payload.work_type_id,
          },
        })
      }
      case 'prepare_update_work_order': {
        const result = await preparePatchWorkOrder(ctx, o as Record<string, unknown>)
        return JSON.stringify(result)
      }
      case 'prepare_create_work_plan': {
        const validated = await validateWorkPlanCreateForCopilot(
          ctx.pool,
          ctx.siteId,
          o as Record<string, unknown>,
        )
        if (!validated.ok) {
          return JSON.stringify({
            ok: false,
            error: validated.error,
          })
        }
        const id = randomUUID()
        ctx.confirmables.push({
          id,
          type: 'create_work_plan',
          payload: validated.payload,
        })
        return JSON.stringify({
          ok: true,
          confirmable_id: id,
          message:
            'Payload validated. The user must tap Confirm in the app to create the work plan (maintenance plan).',
          summary: {
            plan_key: validated.payload.plan_key,
            short_text: validated.payload.short_text,
            asset_id: validated.payload.asset_id,
          },
        })
      }
      case 'prepare_create_asset': {
        const sOrEmpty = (v: unknown): string | null => {
          if (v === null || v === undefined) return null
          if (typeof v !== 'string') return null
          const t = v.trim()
          return t || null
        }
        const raw: Partial<AiAssetDraft> = {
          key:
            typeof (o as { key?: unknown }).key === 'string'
              ? (o as { key: string }).key
              : null,
          name:
            typeof (o as { name?: unknown }).name === 'string'
              ? (o as { name: string }).name
              : null,
          asset_type:
            typeof (o as { asset_type?: unknown }).asset_type === 'string'
              ? (o as { asset_type: string }).asset_type as AiAssetDraft['asset_type']
              : null,
          parent_asset_id: sOrEmpty(
            (o as { parent_asset_id?: unknown }).parent_asset_id,
          ),
          costcenter_id: sOrEmpty(
            (o as { costcenter_id?: unknown }).costcenter_id,
          ),
          asset_classification_id: sOrEmpty(
            (o as { asset_classification_id?: unknown })
              .asset_classification_id,
          ),
          equipment_number: sOrEmpty(
            (o as { equipment_number?: unknown }).equipment_number,
          ),
          serial_no: sOrEmpty((o as { serial_no?: unknown }).serial_no),
          build_year:
            typeof (o as { build_year?: unknown }).build_year === 'number'
              ? (o as { build_year: number }).build_year
              : null,
          warranty_end: sOrEmpty(
            (o as { warranty_end?: unknown }).warranty_end,
          ),
          priority:
            typeof (o as { priority?: unknown }).priority === 'number'
              ? (o as { priority: number }).priority
              : null,
        }
        const context = await loadAiSuggestContextForSite(ctx.pool, ctx.siteId)
        const tx = transcriptForRanking([raw.key ?? '', raw.name ?? ''])
        const { validated, unresolved } = await validateAndResolveAssetDraft(
          ctx.pool,
          ctx.siteId,
          tx,
          raw,
          context,
        )
        if (!assetPayloadReady(validated)) {
          return JSON.stringify({
            ok: false,
            error: 'Required asset fields missing or invalid.',
            unresolved,
            validated,
          })
        }
        const id = randomUUID()
        const payload: Record<string, unknown> = {
          key: validated.key!.trim(),
          name: validated.name!.trim(),
          asset_type: validated.asset_type!,
          parent_asset_id: validated.parent_asset_id,
          costcenter_id: validated.costcenter_id,
          asset_classification_id: validated.asset_classification_id,
          equipment_number: validated.equipment_number,
          serial_no: validated.serial_no,
          build_year: validated.build_year,
          warranty_end: validated.warranty_end,
          priority: validated.priority,
        }
        ctx.confirmables.push({ id, type: 'create_asset', payload })
        return JSON.stringify({
          ok: true,
          confirmable_id: id,
          message:
            'Payload validated. The user must tap Confirm in the app to create the asset.',
          summary: { key: payload.key, name: payload.name },
        })
      }
      case 'request_client_navigation': {
        const v = validateClientNavigationToolInput({
          app: (o as { app?: unknown }).app,
          entity_id: (o as { entity_id?: unknown }).entity_id,
          close_kira: (o as { close_kira?: unknown }).close_kira,
          shell_action: (o as { shell_action?: unknown }).shell_action,
          isAdmin: ctx.isAdmin,
        })
        if (!v.ok) {
          return JSON.stringify({ ok: false, error: v.error })
        }
        ctx.clientActions.push(v.action)
        return JSON.stringify({
          ok: true,
          message: 'Navigation queued for the client UI.',
        })
      }
      default:
        return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` })
    }
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

import { randomUUID } from 'node:crypto'
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
  listOpenWorkOrdersBrief,
  loadAiSuggestContextForSite,
  searchAssetsForSite,
} from './copilotContext.js'
import type { CopilotConfirmable } from './copilotTypes.js'

export const COPILOT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'suggest_work_order_draft',
      description:
        'Propose a work order draft from free text using site reference lists (OpenAI + validation). Use when the user describes a maintenance issue or task.',
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
        'Search assets in the working site by key or name (case-insensitive).',
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
      name: 'list_open_work_orders',
      description:
        'List recent open work orders (wo_key, short_text, status) for the site.',
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
      name: 'prepare_create_work_order',
      description:
        'Validate fields and register a confirmable payload for POST /api/work-orders. Only call when required fields are known (or can be inferred). Does not create the record.',
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
          worktime: { type: 'number' },
          duration: { type: 'number' },
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
] as const

export type CopilotToolContext = {
  pool: Pool
  siteId: string
  confirmables: CopilotConfirmable[]
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
      v.worktime != null &&
      Number.isFinite(v.worktime) &&
      v.worktime >= 0,
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
        if (
          !context.assets?.length ||
          !context.work_types?.length ||
          !context.workgroups?.length
        ) {
          return JSON.stringify({
            ok: false,
            error:
              'Site has no assets, work types, or workgroups — cannot draft work orders.',
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
        return JSON.stringify({ ok: true, assets: rows })
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
          worktime:
            typeof (o as { worktime?: unknown }).worktime === 'number'
              ? (o as { worktime: number }).worktime
              : null,
          duration:
            typeof (o as { duration?: unknown }).duration === 'number'
              ? (o as { duration: number }).duration
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
          worktime: validated.worktime!,
          duration: validated.duration ?? 0,
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

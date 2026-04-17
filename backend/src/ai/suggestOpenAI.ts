import { env } from '../env.js'
import { throwOpenAiHttpError } from './openAiErrors.js'
import type { AiAssetDraft, AiWorkOrderDraft } from './suggestTypes.js'
import type { AiSuggestContext } from './suggestTypes.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

type LmWorkOrderOut = {
  work_order?: Partial<AiWorkOrderDraft>
}

type LmAssetOut = {
  asset?: Partial<AiAssetDraft>
}

function buildUserPayload(
  kind: 'work_order' | 'asset',
  transcript: string,
  context: AiSuggestContext,
): string {
  const ctx = JSON.stringify(context)
  if (kind === 'work_order') {
    return `Transcript (user spoke):\n"""${transcript}"""\n\nReference lists (JSON, ids are authoritative; only use ids from these lists or null):\n${ctx}\n\nReturn JSON with key "work_order" only. Shape:\n{"work_order":{"short_text":string|null,"instruction_text":string|null,"asset_id":uuid|null,"work_type_id":uuid|null,"workgroup_id":uuid|null,"category_id":uuid|null,"planned_duration":number|null,"plan_start":iso8601 string|null}}\nInfer planned_duration in hours if mentioned; plan_start as ISO if a date/time is given else null.`
  }
  return `Transcript (user spoke):\n"""${transcript}"""\n\nReference lists (JSON):\n${ctx}\n\nReturn JSON with key "asset" only. Shape:\n{"asset":{"key":string|null,"name":string|null,"asset_type":"location"|"building"|"group"|"maintenance_object"|null,"parent_asset_id":uuid|null,"costcenter_id":uuid|null,"asset_classification_id":uuid|null,"equipment_number":string|null,"serial_no":string|null,"build_year":number|null,"warranty_end":"YYYY-MM-DD"|null,"priority":1-5|null}}\nUse null when unknown. Key should be a short unique code if inferable (e.g. from equipment number), else null.`
}

export async function openAiSuggestDraft(args: {
  kind: 'work_order' | 'asset'
  transcript: string
  context: AiSuggestContext
}): Promise<AiWorkOrderDraft | AiAssetDraft> {
  const key = env.OPENAI_API_KEY
  if (!key?.trim()) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const body = {
    model: env.OPENAI_SUGGEST_MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' as const },
    messages: [
      {
        role: 'system' as const,
        content:
          'You are a CMMS assistant. Output only valid JSON. Never invent UUIDs: use only ids present in the provided reference lists, or null.',
      },
      {
        role: 'user' as const,
        content: buildUserPayload(args.kind, args.transcript, args.context),
      },
    ],
  }

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const rawText = await res.text()
  if (!res.ok) {
    throwOpenAiHttpError(res.status, rawText)
  }

  type OpenAiChatResponse = {
    choices?: { message?: { content?: string } }[]
  }
  let parsed: OpenAiChatResponse
  try {
    parsed = JSON.parse(rawText) as OpenAiChatResponse
  } catch {
    throw new Error('OpenAI response was not JSON')
  }

  const content = parsed.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('OpenAI missing message content')
  }

  let inner: unknown
  try {
    inner = JSON.parse(content) as LmWorkOrderOut | LmAssetOut
  } catch {
    throw new Error('Model did not return valid JSON object')
  }

  if (args.kind === 'work_order') {
    const wo = (inner as LmWorkOrderOut).work_order ?? {}
    const plannedRaw = (wo as { planned_duration?: unknown }).planned_duration
    const legacyDur = (wo as { duration?: unknown }).duration
    const legacyWt = (wo as { worktime?: unknown }).worktime
    const planned_duration =
      typeof plannedRaw === 'number'
        ? plannedRaw
        : typeof legacyDur === 'number'
          ? legacyDur
          : typeof legacyWt === 'number'
            ? legacyWt
            : null
    return {
      short_text: (wo.short_text as string) ?? null,
      instruction_text: (wo.instruction_text as string) ?? null,
      asset_id: (wo.asset_id as string) ?? null,
      work_type_id: (wo.work_type_id as string) ?? null,
      workgroup_id: (wo.workgroup_id as string) ?? null,
      category_id: (wo.category_id as string) ?? null,
      planned_duration,
      plan_start: (wo.plan_start as string) ?? null,
    } satisfies AiWorkOrderDraft
  }

  const a = (inner as LmAssetOut).asset ?? {}
  const at = a.asset_type
  return {
    key: (a.key as string) ?? null,
    name: (a.name as string) ?? null,
    asset_type:
      at === 'location' ||
      at === 'building' ||
      at === 'group' ||
      at === 'maintenance_object'
        ? at
        : null,
    parent_asset_id: (a.parent_asset_id as string) ?? null,
    costcenter_id: (a.costcenter_id as string) ?? null,
    asset_classification_id:
      (a.asset_classification_id as string) ?? null,
    equipment_number: (a.equipment_number as string) ?? null,
    serial_no: (a.serial_no as string) ?? null,
    build_year: typeof a.build_year === 'number' ? a.build_year : null,
    warranty_end: (a.warranty_end as string) ?? null,
    priority: typeof a.priority === 'number' ? a.priority : null,
  } satisfies AiAssetDraft
}

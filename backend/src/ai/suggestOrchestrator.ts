import type { Pool } from 'pg'
import { env } from '../env.js'
import { openAiSuggestDraft } from './suggestOpenAI.js'
import type {
  AiRefItem,
  AiSuggestContext,
  AiSuggestResponse,
} from './suggestTypes.js'
import {
  validateAndResolveAssetDraft,
  validateAndResolveWorkOrderDraft,
} from './suggestValidate.js'

function truncateRefs(
  items: AiRefItem[] | undefined,
  max: number,
): { list: AiRefItem[]; truncated: boolean } {
  if (!items?.length) return { list: [], truncated: false }
  if (items.length <= max) return { list: items, truncated: false }
  return { list: items.slice(0, max), truncated: true }
}

function truncateContext(
  ctx: AiSuggestContext,
  maxPerList: number,
): { context: AiSuggestContext; warnings: string[] } {
  const warnings: string[] = []
  const context: AiSuggestContext = {}

  const a = truncateRefs(ctx.assets, maxPerList)
  context.assets = a.list
  if (a.truncated) warnings.push('assets list truncated for AI context')

  const wt = truncateRefs(ctx.work_types, maxPerList)
  context.work_types = wt.list
  if (wt.truncated) warnings.push('work_types list truncated for AI context')

  const wg = truncateRefs(ctx.workgroups, maxPerList)
  context.workgroups = wg.list
  if (wg.truncated) warnings.push('workgroups list truncated for AI context')

  const cat = truncateRefs(ctx.categories, maxPerList)
  context.categories = cat.list
  if (cat.truncated) warnings.push('categories list truncated for AI context')

  const cc = truncateRefs(ctx.costcenters, maxPerList)
  context.costcenters = cc.list
  if (cc.truncated) warnings.push('costcenters list truncated for AI context')

  const ac = truncateRefs(ctx.asset_classifications, maxPerList)
  context.asset_classifications = ac.list
  if (ac.truncated) {
    warnings.push('asset_classifications list truncated for AI context')
  }

  return { context, warnings }
}

export async function runAiSuggest(args: {
  pool: Pool
  siteId: string
  kind: 'work_order' | 'asset'
  transcript: string
  context: AiSuggestContext
}): Promise<AiSuggestResponse> {
  const max = env.AI_SUGGEST_MAX_CONTEXT_ITEMS
  const { context, warnings: tw } = truncateContext(args.context, max)
  const warnings = [...tw]

  const draftRaw = await openAiSuggestDraft({
    kind: args.kind,
    transcript: args.transcript,
    context,
  })

  if (args.kind === 'work_order') {
    const { validated, unresolved, candidates } =
      await validateAndResolveWorkOrderDraft(
        args.pool,
        args.siteId,
        args.transcript,
        draftRaw as import('./suggestTypes.js').AiWorkOrderDraft,
        context,
      )
    return {
      kind: 'work_order',
      transcript_echo: args.transcript.trim().slice(0, 8000),
      draft: draftRaw as import('./suggestTypes.js').AiWorkOrderDraft,
      validated,
      unresolved,
      candidates,
      warnings,
    }
  }

  const { validated, unresolved, candidates } =
    await validateAndResolveAssetDraft(
      args.pool,
      args.siteId,
      args.transcript,
      draftRaw as import('./suggestTypes.js').AiAssetDraft,
      context,
    )
  return {
    kind: 'asset',
    transcript_echo: args.transcript.trim().slice(0, 8000),
    draft: draftRaw as import('./suggestTypes.js').AiAssetDraft,
    validated,
    unresolved,
    candidates,
    warnings,
  }
}

/**
 * Athene RAG pipeline.
 *
 * 1. Embed the user query.
 * 2. Pull top-K candidate work orders from the pgvector index (site-scoped).
 * 3. Hydrate each candidate with the same text that went into its embedding
 *    (status, asset, hold reason, recent feedback) so the LLM sees the full
 *    picture, not just the title.
 * 4. Ask GPT to answer the question AND pick the relevant hits via a single
 *    forced function call `return_answer({ answer, hits: [{ id, reason }] })`.
 *    No multi-turn tool loop — the LLM is a filter/summariser, nothing else.
 *
 * The client gets back a prose answer plus a structured list of chosen hits,
 * each with GPT-generated `reason` text for display under the card.
 */
import type { Pool } from 'pg'
import { env } from '../../env.js'
import { throwOpenAiHttpError } from '../openAiErrors.js'
import { embedTexts, toPgVectorLiteral } from '../embeddings/openAiEmbed.js'
import {
  loadWorkOrderEmbedRow,
  type WorkOrderEmbedRow,
  type WorkOrderFeedbackEntry,
} from '../embeddings/workOrderEmbed.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
/** Candidate pool fetched from pgvector before GPT filters it down. */
const CANDIDATE_TOP_K = 30
/** Hard cap on how many picks we return regardless of what GPT emits. */
const MAX_HITS = 15

export type AtheneHit = {
  id: string
  wo_key: number
  short_text: string
  status: string
  /** Cosine similarity from pgvector (0..1, 1 = identical). */
  score: number
  /** GPT-generated one-liner explaining why this WO matches the query. */
  reason: string
}

export type AtheneAnswer = {
  answer: string
  hits: AtheneHit[]
  /** Diagnostic counts exposed to callers for logging / troubleshooting. */
  diagnostics: {
    siteId: string
    /** Total embedding rows stored for this site (before ANN). */
    embeddingsInSite: number
    /** Rows returned from the ANN top-K query (pre-GPT). */
    candidateCount: number
    /** Candidates that still existed after hydration (post-loader). */
    hydratedCount: number
  }
}

/* ── Candidate fetch + hydration ─────────────────────────────────── */

type CandidateRow = {
  id: string
  wo_key: number
  short_text: string
  status: string
  distance: string | number
}

function distanceToScore(distance: number): number {
  const sim = 1 - distance
  if (!Number.isFinite(sim)) return 0
  return Math.max(0, Math.min(1, sim))
}

async function fetchCandidates(
  pool: Pool,
  args: { siteId: string; query: string },
): Promise<Array<CandidateRow & { score: number }>> {
  const { vectors } = await embedTexts([args.query])
  const vec = vectors[0]
  if (!vec) return []
  const literal = toPgVectorLiteral(vec)

  // pgvector's IVFFlat index defaults to `probes = 1`, which scans a single
  // cluster (~rows/lists entries). Combined with a narrow WHERE filter (site_id)
  // this regularly returns 0 rows because the probed cluster contains no
  // rows for that site. Raising probes dramatically improves recall at a
  // small perf cost. Must be applied with SET LOCAL inside a transaction.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ivfflat.probes = ${env.AI_IVFFLAT_PROBES}`)
    const r = await client.query<CandidateRow>(
      `SELECT wo.id,
              wo.wo_key,
              wo.short_text,
              wo.status,
              (we.embedding <=> $1::vector) AS distance
         FROM work_order_embeddings we
         JOIN work_orders wo ON wo.id = we.work_order_id
        WHERE we.site_id = $2
        ORDER BY we.embedding <=> $1::vector
        LIMIT $3`,
      [literal, args.siteId, CANDIDATE_TOP_K],
    )
    await client.query('COMMIT')

    return r.rows.map((row) => {
      const distance =
        typeof row.distance === 'number' ? row.distance : Number(row.distance)
      return { ...row, score: distanceToScore(distance) }
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/* ── LLM prompt construction ─────────────────────────────────────── */

function formatFeedbackForPrompt(entries: WorkOrderFeedbackEntry[]): string {
  if (entries.length === 0) return '(no feedback)'
  const slice = entries.slice(0, 6) // keep prompt lean
  return slice
    .map((e) => {
      const h = e.hours ? `[${e.hours}h] ` : ''
      const body = e.feedback_text.trim().replace(/\s+/g, ' ').slice(0, 400)
      const pcrParts: string[] = []
      if (e.pcr_problem) pcrParts.push(`problem="${e.pcr_problem}"`)
      if (e.pcr_cause) pcrParts.push(`cause="${e.pcr_cause}"`)
      if (e.pcr_remedy) pcrParts.push(`remedy="${e.pcr_remedy}"`)
      const pcr = pcrParts.length ? ` [PCR ${pcrParts.join(', ')}]` : ''
      return `- ${h}${body}${pcr}`
    })
    .join('\n')
}

type HydratedCandidate = {
  id: string
  wo_key: number
  short_text: string
  status: string
  score: number
  row: WorkOrderEmbedRow
}

function formatCandidateBlock(
  c: HydratedCandidate,
  index: number,
): string {
  const asset = [c.row.asset_key, c.row.asset_name]
    .filter((s) => (s ?? '').trim().length > 0)
    .join(' ') || '(unknown)'
  const hold = (c.row.hold_reason ?? '').trim() || '(none)'
  return [
    `### Candidate ${index + 1}`,
    `id: ${c.id}`,
    `wo_key: #${c.wo_key}`,
    `title: ${c.short_text}`,
    `status: ${c.status}`,
    `asset: ${asset}`,
    `hold_reason: ${hold}`,
    `score: ${c.score.toFixed(3)}`,
    `feedback:`,
    formatFeedbackForPrompt(c.row.feedback_entries),
  ].join('\n')
}

const SYSTEM_PROMPT = [
  'You are Athene, an assistant that answers questions about work orders in a CMMS.',
  '',
  'You receive:',
  '- the user question',
  '- a candidate list of work orders retrieved from a pgvector similarity index scoped to the user\'s site',
  '',
  'Rules:',
  '- Only reference work orders from the candidate list. Never invent ids, wo_keys, or titles.',
  '- Always reference work orders by their wo_key, e.g. "#1234567".',
  '- If the user asks for "top N", return at most N hits.',
  '- Treat "breakdown", "issue", "problem", "fault", "failure" as asking for work orders whose status is `on_hold` OR that have non-empty feedback OR a hold_reason OR any PCR (problem/cause/remedy) entry. Candidates without any of these MUST be excluded from the hits list for such questions.',
  '- The similarity score alone is NOT sufficient — use the hydrated fields (status, hold_reason, feedback, PCR problem/cause/remedy) to decide relevance. A high score on a title-only match is not a breakdown.',
  '- The PCR (Problem / Cause / Remedy) tags attached to feedback entries are the structured classification of what went wrong and how it was fixed. Prefer them over free text when citing the root cause.',
  '- If nothing in the candidate list is actually relevant, say so plainly and return an empty hits array.',
  '- Keep the `answer` short and direct. Use markdown lists when enumerating items. Do not repeat every field — the UI shows the hits separately.',
  '- The `reason` on each hit must be a single short sentence explaining why that specific work order matches, grounded in its hydrated fields (e.g. "on_hold due to burned motor", "feedback mentions failed bearing").',
].join('\n')

/* ── OpenAI call ─────────────────────────────────────────────────── */

type ToolCall = {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type ChoiceMessage = {
  role?: string
  content?: string | null
  tool_calls?: ToolCall[]
}

type OpenAiChatResponse = {
  choices?: { message?: ChoiceMessage }[]
}

const RETURN_ANSWER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'return_answer',
    description:
      'Return the final answer to the user plus the selected candidate work orders.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: {
          type: 'string',
          description:
            'Prose answer to the user. May use short markdown lists. Do not invent facts.',
        },
        hits: {
          type: 'array',
          description:
            'Candidate work orders selected as relevant, ordered by relevance desc. Use the `id` from the candidate list verbatim.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              reason: {
                type: 'string',
                description:
                  'One short sentence explaining why this WO matches.',
              },
            },
            required: ['id', 'reason'],
          },
        },
      },
      required: ['answer', 'hits'],
    },
  },
}

async function callOpenAi(
  candidates: HydratedCandidate[],
  query: string,
): Promise<{ answer: string; picks: Array<{ id: string; reason: string }> }> {
  const key = env.OPENAI_API_KEY
  if (!key?.trim()) throw new Error('OPENAI_API_KEY not configured')
  const model =
    env.OPENAI_COPILOT_MODEL?.trim() || env.OPENAI_SUGGEST_MODEL

  const candidateBlocks = candidates
    .map((c, i) => formatCandidateBlock(c, i))
    .join('\n\n')

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          `User question: ${query}`,
          '',
          `Candidate work orders (${candidates.length} total, ordered by vector similarity):`,
          '',
          candidateBlocks,
        ].join('\n'),
      },
    ],
    tools: [RETURN_ANSWER_TOOL],
    tool_choice: {
      type: 'function' as const,
      function: { name: 'return_answer' },
    },
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

  let parsed: OpenAiChatResponse
  try {
    parsed = JSON.parse(rawText) as OpenAiChatResponse
  } catch {
    throw new Error('OpenAI response was not JSON')
  }

  const msg = parsed.choices?.[0]?.message
  const call = msg?.tool_calls?.[0]
  const argsStr = call?.function?.arguments
  if (typeof argsStr !== 'string' || !argsStr.trim()) {
    throw new Error('OpenAI did not return the expected tool call')
  }

  type ToolArgs = {
    answer?: unknown
    hits?: unknown
  }
  let toolArgs: ToolArgs
  try {
    toolArgs = JSON.parse(argsStr) as ToolArgs
  } catch {
    throw new Error('OpenAI tool arguments were not JSON')
  }

  const answer =
    typeof toolArgs.answer === 'string' ? toolArgs.answer.trim() : ''
  const hitsRaw = Array.isArray(toolArgs.hits) ? toolArgs.hits : []
  const picks: Array<{ id: string; reason: string }> = []
  for (const h of hitsRaw) {
    if (!h || typeof h !== 'object') continue
    const id = (h as { id?: unknown }).id
    const reason = (h as { reason?: unknown }).reason
    if (typeof id !== 'string' || !id.trim()) continue
    picks.push({
      id: id.trim(),
      reason: typeof reason === 'string' ? reason.trim() : '',
    })
  }

  return { answer, picks }
}

/* ── Public entry ────────────────────────────────────────────────── */

async function countEmbeddingsForSite(
  pool: Pool,
  siteId: string,
): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM work_order_embeddings WHERE site_id = $1`,
    [siteId],
  )
  return Number(r.rows[0]?.c ?? 0)
}

export async function runAtheneQuery(args: {
  pool: Pool
  siteId: string
  query: string
}): Promise<AtheneAnswer> {
  const diagnostics = {
    siteId: args.siteId,
    embeddingsInSite: 0,
    candidateCount: 0,
    hydratedCount: 0,
  }

  const query = args.query.trim()
  if (!query) {
    return { answer: '', hits: [], diagnostics }
  }

  diagnostics.embeddingsInSite = await countEmbeddingsForSite(
    args.pool,
    args.siteId,
  )

  const candidates = await fetchCandidates(args.pool, {
    siteId: args.siteId,
    query,
  })
  diagnostics.candidateCount = candidates.length

  if (candidates.length === 0) {
    const answer =
      diagnostics.embeddingsInSite === 0
        ? `No work-order embeddings exist for this site (site_id=${args.siteId}). Run the backfill script: \`npm run ai:backfill-wo-embeddings\` in backend/.`
        : 'The vector similarity search returned no matches for this query, even though the index has entries. Try rephrasing.'
    return { answer, hits: [], diagnostics }
  }

  // Hydrate every candidate from the same loader the embedder uses so the
  // prompt sees the exact context that went into the embedding.
  const hydrated: HydratedCandidate[] = []
  for (const c of candidates) {
    const row = await loadWorkOrderEmbedRow(args.pool, c.id)
    if (!row) continue
    hydrated.push({
      id: c.id,
      wo_key: c.wo_key,
      short_text: c.short_text,
      status: c.status,
      score: c.score,
      row,
    })
  }
  diagnostics.hydratedCount = hydrated.length

  if (hydrated.length === 0) {
    return {
      answer: 'No work orders found to answer this question.',
      hits: [],
      diagnostics,
    }
  }

  const { answer, picks } = await callOpenAi(hydrated, query)

  const candidateById = new Map(hydrated.map((h) => [h.id, h]))
  const seen = new Set<string>()
  const hits: AtheneHit[] = []
  for (const p of picks) {
    if (hits.length >= MAX_HITS) break
    if (seen.has(p.id)) continue
    const c = candidateById.get(p.id)
    if (!c) continue // GPT hallucinated an id outside the candidate list
    seen.add(p.id)
    hits.push({
      id: c.id,
      wo_key: c.wo_key,
      short_text: c.short_text,
      status: c.status,
      score: c.score,
      reason: p.reason,
    })
  }

  return { answer, hits, diagnostics }
}

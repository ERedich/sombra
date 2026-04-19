import { Router } from 'express'
import multer from 'multer'
import { env } from '../env.js'
import {
  OpenAiRequestError,
  throwOpenAiHttpError,
} from '../ai/openAiErrors.js'
import { runCopilotTurn } from '../ai/copilotRunTurn.js'
import { runAiSuggest } from '../ai/suggestOrchestrator.js'
import {
  searchSimilarByQuery,
  searchSimilarByWorkOrderId,
} from '../ai/embeddings/similarWorkOrders.js'
import { runAtheneQuery } from '../ai/athene/atheneRunQuery.js'
import type {
  AiRefItem,
  AiSuggestContext,
} from '../ai/suggestTypes.js'
import { loadUserDbWorkingSiteId } from '../auth/siteScope.js'
import { requireAuth } from '../middleware/auth.js'
import { pool } from '../db.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
})

function workingSiteIdOr403(
  res: import('express').Response,
  siteId: string | null | undefined,
): string | null {
  if (!siteId || !UUID_RE.test(siteId)) {
    res.status(403).json({
      error:
        'No working site is set. Sign out and sign in again, or pick a site at login.',
    })
    return null
  }
  return siteId
}

/** Working plant for AI tools: DB `users.working_site_id` (matches `/me` + UI), not JWT-only. */
async function aiWorkingSiteIdOr403(
  res: import('express').Response,
  userId: string,
): Promise<string | null> {
  const ws = await loadUserDbWorkingSiteId(pool, userId)
  return workingSiteIdOr403(res, ws)
}

/** Simple per-user sliding window rate limit (in-memory). */
function createAiRateLimiter() {
  const windowMs = 60_000
  const max = env.AI_RATE_LIMIT_PER_MINUTE
  const buckets = new Map<string, number[]>()

  return function check(userId: string): boolean {
    const now = Date.now()
    const cur = buckets.get(userId) ?? []
    const fresh = cur.filter((t) => now - t < windowMs)
    if (fresh.length >= max) {
      buckets.set(userId, fresh)
      return false
    }
    fresh.push(now)
    buckets.set(userId, fresh)
    return true
  }
}

const checkAiRate = createAiRateLimiter()

function parseRefList(raw: unknown): AiRefItem[] {
  if (!Array.isArray(raw)) return []
  const out: AiRefItem[] = []
  for (const el of raw) {
    if (typeof el !== 'object' || el === null) continue
    const id = (el as { id?: unknown }).id
    if (typeof id !== 'string' || !UUID_RE.test(id)) continue
    const key = (el as { key?: unknown }).key
    const name = (el as { name?: unknown }).name
    out.push({
      id,
      key: typeof key === 'string' ? key : undefined,
      name: typeof name === 'string' ? name : undefined,
    })
  }
  return out
}

function parseContext(raw: unknown): AiSuggestContext {
  if (typeof raw !== 'object' || raw === null) return {}
  const o = raw as Record<string, unknown>
  return {
    assets: parseRefList(o.assets),
    work_types: parseRefList(o.work_types),
    workgroups: parseRefList(o.workgroups),
    categories: parseRefList(o.categories),
    costcenters: parseRefList(o.costcenters),
    asset_classifications: parseRefList(o.asset_classifications),
  }
}

const router = Router()
router.use(requireAuth)

router.get('/status', (_req, res) => {
  res.json({ configured: Boolean(env.OPENAI_API_KEY?.trim()) })
})

router.post('/copilot/turn', async (req, res) => {
  const auth = req.authUser!
  if (!checkAiRate(auth.id)) {
    res.status(429).json({ error: 'Too many AI requests. Try again shortly.' })
    return
  }

  const siteId = await aiWorkingSiteIdOr403(res, auth.id)
  if (!siteId) return

  if (!env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }

  const locale =
    typeof auth.locale === 'string' && auth.locale.trim()
      ? auth.locale.trim()
      : 'en'

  const t0 = Date.now()
  try {
    const result = await runCopilotTurn({
      pool,
      siteId,
      locale,
      isAdmin: auth.role === 'admin',
      userId: auth.id,
      userLoginName: auth.login_name,
      userDisplayName: auth.name,
      messages: req.body?.messages,
    })
    req.log?.info?.(
      {
        aiCopilotMs: Date.now() - t0,
        userId: auth.id,
        confirmableCount: result.confirmable.length,
        clientActionCount: result.client_actions.length,
      },
      'ai_copilot_turn_ok',
    )
    res.json(result)
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : 'Copilot request failed.'
    req.log?.warn?.(
      { err: msg, userId: auth.id },
      'ai_copilot_turn_fail',
    )
    if (e instanceof OpenAiRequestError) {
      res.status(e.statusCode).json({ error: msg })
      return
    }
    const badRequest = msg.includes('messages must include')
    res.status(badRequest ? 400 : 502).json({ error: msg })
  }
})

router.post('/suggest', async (req, res) => {
  const auth = req.authUser!
  if (!checkAiRate(auth.id)) {
    res.status(429).json({ error: 'Too many AI requests. Try again shortly.' })
    return
  }

  const siteId = await aiWorkingSiteIdOr403(res, auth.id)
  if (!siteId) return

  const kind = req.body?.kind
  if (kind !== 'work_order' && kind !== 'asset') {
    res.status(400).json({ error: 'kind must be "work_order" or "asset".' })
    return
  }

  const transcript =
    typeof req.body?.transcript === 'string' ? req.body.transcript.trim() : ''
  if (!transcript || transcript.length > 8000) {
    res.status(400).json({
      error: 'transcript is required (1–8000 characters).',
    })
    return
  }

  if (!env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }

  const context = parseContext(req.body?.context)

  if (kind === 'work_order') {
    if (
      !context.assets?.length ||
      !context.work_types?.length ||
      !context.workgroups?.length
    ) {
      res.status(400).json({
        error:
          'context must include non-empty assets, work_types, and workgroups arrays for work_order.',
      })
      return
    }
  }

  const t0 = Date.now()
  try {
    const result = await runAiSuggest({
      pool,
      siteId,
      kind,
      transcript,
      context,
    })
    req.log?.info?.(
      {
        aiSuggestMs: Date.now() - t0,
        aiKind: kind,
        transcriptLen: transcript.length,
        userId: auth.id,
      },
      'ai_suggest_ok',
    )
    res.json(result)
  } catch (e) {
    const statusCode = e instanceof OpenAiRequestError ? e.statusCode : 502
    req.log?.warn?.(
      {
        err: e instanceof Error ? e.message : String(e),
        aiKind: kind,
        userId: auth.id,
      },
      'ai_suggest_fail',
    )
    res.status(statusCode).json({
      error:
        e instanceof Error ? e.message : 'AI suggestion failed.',
    })
  }
})

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  const auth = req.authUser!
  if (!checkAiRate(auth.id)) {
    res.status(429).json({ error: 'Too many AI requests. Try again shortly.' })
    return
  }

  const siteOk = await aiWorkingSiteIdOr403(res, auth.id)
  if (!siteOk) return

  if (!env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }

  const file = req.file
  if (!file?.buffer?.length) {
    res.status(400).json({ error: 'audio file is required (field name: audio).' })
    return
  }

  const form = new FormData()
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' })
  form.append('file', blob, file.originalname || 'audio.m4a')
  form.append('model', 'whisper-1')
  const whisperLang =
    typeof req.body?.language === 'string'
      ? req.body.language.trim().toLowerCase().slice(0, 5)
      : ''
  if (whisperLang === 'de' || whisperLang === 'en') {
    form.append('language', whisperLang)
  }

  const t0 = Date.now()
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`,
      },
      body: form,
    })
    const text = await r.text()
    if (!r.ok) {
      throwOpenAiHttpError(r.status, text)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text) as { text?: string }
    } catch {
      throw new Error('Whisper response was not JSON')
    }
    const transcript =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { text?: string }).text === 'string'
        ? (parsed as { text: string }).text.trim()
        : ''
    req.log?.info?.(
      {
        aiTranscribeMs: Date.now() - t0,
        userId: auth.id,
        audioBytes: file.buffer.length,
      },
      'ai_transcribe_ok',
    )
    res.json({ transcript })
  } catch (e) {
    const statusCode = e instanceof OpenAiRequestError ? e.statusCode : 502
    req.log?.warn?.(
      {
        err: e instanceof Error ? e.message : String(e),
        userId: auth.id,
      },
      'ai_transcribe_fail',
    )
    res.status(statusCode).json({
      error: e instanceof Error ? e.message : 'Transcription failed.',
    })
  }
})

router.post('/similar-work-orders', async (req, res) => {
  const auth = req.authUser!
  if (!checkAiRate(auth.id)) {
    res.status(429).json({ error: 'Too many AI requests. Try again shortly.' })
    return
  }

  const siteId = await aiWorkingSiteIdOr403(res, auth.id)
  if (!siteId) return

  if (!env.OPENAI_API_KEY?.trim()) {
    res.status(503).json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }

  const body = (req.body ?? {}) as {
    wo_id?: unknown
    query?: unknown
    limit?: unknown
  }

  const limitRaw = typeof body.limit === 'number' ? body.limit : 10
  const limit = Math.min(20, Math.max(1, Math.floor(limitRaw))) || 10

  const woIdRaw = typeof body.wo_id === 'string' ? body.wo_id.trim() : ''
  const queryRaw = typeof body.query === 'string' ? body.query.trim() : ''

  if (woIdRaw && !UUID_RE.test(woIdRaw)) {
    res.status(400).json({ error: 'wo_id must be a valid UUID.' })
    return
  }
  if (!woIdRaw && (!queryRaw || queryRaw.length > 2000)) {
    res.status(400).json({
      error: 'Provide wo_id (uuid) or query (1-2000 chars).',
    })
    return
  }

  const t0 = Date.now()
  try {
    const results = woIdRaw
      ? await searchSimilarByWorkOrderId(pool, {
          siteId,
          workOrderId: woIdRaw,
          limit,
        })
      : await searchSimilarByQuery(pool, {
          siteId,
          query: queryRaw,
          limit,
        })

    req.log?.info?.(
      {
        aiSimilarWoMs: Date.now() - t0,
        userId: auth.id,
        mode: woIdRaw ? 'wo_id' : 'query',
        resultCount: results.length,
      },
      'ai_similar_wo_ok',
    )
    res.json({ results })
  } catch (e) {
    const statusCode = e instanceof OpenAiRequestError ? e.statusCode : 502
    req.log?.warn?.(
      {
        err: e instanceof Error ? e.message : String(e),
        userId: auth.id,
      },
      'ai_similar_wo_fail',
    )
    res.status(statusCode).json({
      error:
        e instanceof Error ? e.message : 'Similar work orders lookup failed.',
    })
  }
})

/**
 * Athene RAG endpoint: embed the query, pull candidates from pgvector, hand
 * them to GPT which returns a prose answer + filtered picks with reasons.
 *
 * Unlike the raw `/similar-work-orders` endpoint, this route interprets the
 * user's intent (e.g. "top 5 breakdowns") and can exclude irrelevant hits.
 */
router.post('/athene/ask', async (req, res) => {
  const auth = req.authUser!
  if (!checkAiRate(auth.id)) {
    res.status(429).json({ error: 'Too many AI requests. Try again shortly.' })
    return
  }

  const siteId = await aiWorkingSiteIdOr403(res, auth.id)
  if (!siteId) return

  if (!env.OPENAI_API_KEY?.trim()) {
    res
      .status(503)
      .json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }

  const body = (req.body ?? {}) as { query?: unknown }
  const queryRaw = typeof body.query === 'string' ? body.query.trim() : ''
  if (!queryRaw || queryRaw.length > 2000) {
    res.status(400).json({ error: 'query is required (1-2000 chars).' })
    return
  }

  const t0 = Date.now()
  try {
    const result = await runAtheneQuery({
      pool,
      siteId,
      query: queryRaw,
    })
    req.log?.info?.(
      {
        aiAtheneMs: Date.now() - t0,
        userId: auth.id,
        hitCount: result.hits.length,
        siteId: result.diagnostics.siteId,
        embeddingsInSite: result.diagnostics.embeddingsInSite,
        candidateCount: result.diagnostics.candidateCount,
        hydratedCount: result.diagnostics.hydratedCount,
      },
      'ai_athene_ok',
    )
    // Diagnostics are server-only; strip before shipping to client.
    const { diagnostics: _d, ...payload } = result
    void _d
    res.json(payload)
  } catch (e) {
    const statusCode = e instanceof OpenAiRequestError ? e.statusCode : 502
    req.log?.warn?.(
      {
        err: e instanceof Error ? e.message : String(e),
        userId: auth.id,
      },
      'ai_athene_fail',
    )
    res.status(statusCode).json({
      error: e instanceof Error ? e.message : 'Athene query failed.',
    })
  }
})

export default router

import { Router } from 'express'
import multer from 'multer'
import { env } from '../env.js'
import {
  OpenAiRequestError,
  throwOpenAiHttpError,
} from '../ai/openAiErrors.js'
import { runCopilotTurn } from '../ai/copilotRunTurn.js'
import { runAiSuggest } from '../ai/suggestOrchestrator.js'
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

export default router

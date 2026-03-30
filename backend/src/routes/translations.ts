import { Router } from 'express'
import type { Pool, PoolClient } from 'pg'
import {
  fieldChanges,
  redactForAudit,
  writeAudit,
  serializeRowForAudit,
} from '../audit/auditLog.js'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

const MSG_KEY_RE = /^[a-z][a-z0-9._-]*$/

type UiTranslationRow = {
  locale: string
  msg_key: string
  value: string
  updated_at: Date
  updated_by: string | null
}

async function isLocaleEnabled(
  client: Pool | PoolClient,
  code: string,
): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT true AS ok FROM app_locales WHERE code = $1 AND enabled = true`,
    [code],
  )
  return Boolean(r.rows[0]?.ok)
}

/** Public: flat map for i18next (login page + app). */
router.get('/', async (req, res) => {
  const locale =
    typeof req.query.locale === 'string' ? req.query.locale.trim() : ''
  if (!locale) {
    res.status(400).json({ error: 'Query parameter locale is required.' })
    return
  }
  try {
    const ok = await isLocaleEnabled(pool, locale)
    if (!ok) {
      res.status(400).json({ error: 'Unknown or disabled locale.' })
      return
    }
    const r = await pool.query<{ msg_key: string; value: string }>(
      `SELECT msg_key, value FROM ui_translations WHERE locale = $1 ORDER BY msg_key ASC`,
      [locale],
    )
    const messages: Record<string, string> = {}
    for (const row of r.rows) {
      messages[row.msg_key] = row.value
    }
    res.json({ locale, messages })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load translations.' })
  }
})

/**
 * Authenticated: all keys with values per locale (for editor grid).
 */
router.get('/matrix', requireAuth, async (_req, res) => {
  try {
    const r = await pool.query<UiTranslationRow>(
      `SELECT locale, msg_key, value, updated_at, updated_by
       FROM ui_translations
       ORDER BY msg_key ASC, locale ASC`,
    )
    const keys = new Set<string>()
    const byLocale: Record<string, Record<string, string>> = {}
    for (const row of r.rows) {
      keys.add(row.msg_key)
      if (!byLocale[row.locale]) byLocale[row.locale] = {}
      byLocale[row.locale][row.msg_key] = row.value
    }
    const localeList = await pool.query<{ code: string }>(
      `SELECT code FROM app_locales WHERE enabled = true ORDER BY sort_order ASC, code ASC`,
    )
    res.json({
      msg_keys: [...keys].sort(),
      locale_codes: localeList.rows.map((x) => x.code),
      by_locale: byLocale,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load translation matrix.' })
  }
})

type PatchBody = {
  updates?: { locale: string; msg_key: string; value: string }[]
}

router.patch('/', requireAuth, async (req, res) => {
  const auth = req.authUser!
  const body = req.body as PatchBody
  const updates = Array.isArray(body?.updates) ? body.updates : []
  if (updates.length === 0) {
    res.status(400).json({ error: 'updates array is required.' })
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const u of updates) {
      const locale =
        typeof u.locale === 'string' ? u.locale.trim().toLowerCase() : ''
      const msg_key = typeof u.msg_key === 'string' ? u.msg_key.trim() : ''
      const value = typeof u.value === 'string' ? u.value : ''
      if (!locale || !msg_key || !MSG_KEY_RE.test(msg_key)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Invalid locale or msg_key in updates.' })
        return
      }
      const locOk = await isLocaleEnabled(client, locale)
      if (!locOk) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: `Locale not allowed: ${locale}` })
        return
      }

      const before = await client.query<UiTranslationRow>(
        `SELECT locale, msg_key, value, updated_at, updated_by
         FROM ui_translations WHERE locale = $1 AND msg_key = $2`,
        [locale, msg_key],
      )
      const prev = before.rows[0]

      await client.query(
        `INSERT INTO ui_translations (locale, msg_key, value, updated_at, updated_by)
         VALUES ($1, $2, $3, now(), $4::uuid)
         ON CONFLICT (locale, msg_key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
        [locale, msg_key, value, auth.id],
      )

      const after = await client.query<UiTranslationRow>(
        `SELECT locale, msg_key, value, updated_at, updated_by
         FROM ui_translations WHERE locale = $1 AND msg_key = $2`,
        [locale, msg_key],
      )
      const nextRow = after.rows[0]
      if (!nextRow) continue

      const afterRec = serializeRowForAudit(
        nextRow as unknown as Record<string, unknown>,
      )
      const beforeRec = prev
        ? serializeRowForAudit(prev as unknown as Record<string, unknown>)
        : null

      const rid = `${locale}:${msg_key}`
      await writeAudit(client, {
        actorUserId: auth.id,
        actorKey: auth.login_name,
        actorName: auth.name,
        operation: prev ? 'update' : 'create',
        resourceType: 'ui_translation',
        resourceId: rid,
        beforeState: prev
          ? redactForAudit('ui_translation', beforeRec)
          : null,
        afterState: redactForAudit('ui_translation', afterRec),
        fieldChanges:
          prev && beforeRec
            ? fieldChanges(beforeRec, afterRec)
            : null,
        httpMethod: req.method,
        path: `${req.baseUrl}${req.path}`,
      })
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(e)
    res.status(500).json({ error: 'Failed to save translations.' })
  } finally {
    client.release()
  }
})

export default router

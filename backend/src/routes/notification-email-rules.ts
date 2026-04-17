import { Router } from 'express'
import { pool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  isNotificationEventKind,
  NOTIFICATION_EVENT_KINDS,
  type SiteNotificationEmailRuleRow,
} from '../notifications/notificationEmailRules.js'
import { isValidEmailFormat } from '../validation/email.js'

const router = Router()
router.use(requireAuth)
router.use(requireAdmin)

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x === 'string' && x.trim()) out.push(x.trim())
  }
  return out
}

function parseUuidArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x === 'string' && UUID_RE.test(x.trim())) out.push(x.trim())
  }
  return out
}

function parseConditionJson(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('condition_json must be a JSON object.')
  }
  return raw as Record<string, unknown>
}

const MAX_MAIL_SUBJECT_LEN = 500
const MAX_MAIL_BODY_LEN = 100_000

/** Non-empty string or null. Throws if wrong type or too long. */
function parseMailTemplateField(raw: unknown, maxLen: number): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'string') {
    throw new Error('email_subject and email_body must be strings.')
  }
  const s = raw.trim()
  if (!s) return null
  if (s.length > maxLen) {
    throw new Error(`Text exceeds maximum length (${maxLen}).`)
  }
  return s
}

router.get('/', async (req, res) => {
  const siteId =
    typeof req.query.site_id === 'string' ? req.query.site_id.trim() : ''
  if (!UUID_RE.test(siteId)) {
    res.status(400).json({ error: 'site_id query parameter must be a UUID.' })
    return
  }
  const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId])
  if ((siteOk.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Site not found.' })
    return
  }
  const r = await pool.query<SiteNotificationEmailRuleRow>(
    `SELECT id, site_id, name, enabled, event_kind, condition_json,
            recipient_emails, recipient_user_ids, cooldown_seconds,
            email_subject, email_body,
            created_at, updated_at
     FROM site_notification_email_rules
     WHERE site_id = $1
     ORDER BY created_at ASC`,
    [siteId],
  )
  res.json({ rules: r.rows })
})

router.post('/', async (req, res) => {
  const body = req.body as Record<string, unknown>
  const siteId = typeof body.site_id === 'string' ? body.site_id.trim() : ''
  if (!UUID_RE.test(siteId)) {
    res.status(400).json({ error: 'site_id must be a UUID.' })
    return
  }
  const siteOk = await pool.query(`SELECT 1 FROM sites WHERE id = $1`, [siteId])
  if ((siteOk.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Site not found.' })
    return
  }
  const eventKind =
    typeof body.event_kind === 'string' ? body.event_kind.trim() : ''
  if (!isNotificationEventKind(eventKind)) {
    res.status(400).json({
      error: `event_kind must be one of: ${NOTIFICATION_EVENT_KINDS.join(', ')}`,
    })
    return
  }
  let conditionJson: Record<string, unknown>
  try {
    conditionJson = parseConditionJson(body.condition_json)
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad condition_json' })
    return
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const enabled = body.enabled === false ? false : true
  const recipientEmailsRaw = parseStringArray(body.recipient_emails)
  const recipientEmails: string[] = []
  for (const em of recipientEmailsRaw) {
    if (!isValidEmailFormat(em)) {
      res.status(400).json({ error: `Invalid email: ${em}` })
      return
    }
    recipientEmails.push(em.toLowerCase())
  }
  const recipientUserIds = parseUuidArray(body.recipient_user_ids)
  const cooldownRaw = body.cooldown_seconds
  const cooldownSeconds =
    typeof cooldownRaw === 'number' && Number.isInteger(cooldownRaw) && cooldownRaw >= 0
      ? Math.min(86400 * 365, cooldownRaw)
      : 3600

  let emailSubject: string | null
  let emailBody: string | null
  try {
    emailSubject = parseMailTemplateField(body.email_subject, MAX_MAIL_SUBJECT_LEN)
    emailBody = parseMailTemplateField(body.email_body, MAX_MAIL_BODY_LEN)
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid mail fields.' })
    return
  }

  const ins = await pool.query<SiteNotificationEmailRuleRow>(
    `INSERT INTO site_notification_email_rules (
       site_id, name, enabled, event_kind, condition_json,
       recipient_emails, recipient_user_ids, cooldown_seconds,
       email_subject, email_body
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7::uuid[], $8, $9, $10)
     RETURNING id, site_id, name, enabled, event_kind, condition_json,
               recipient_emails, recipient_user_ids, cooldown_seconds,
               email_subject, email_body,
               created_at, updated_at`,
    [
      siteId,
      name,
      enabled,
      eventKind,
      JSON.stringify(conditionJson),
      recipientEmails,
      recipientUserIds,
      cooldownSeconds,
      emailSubject,
      emailBody,
    ],
  )
  const row = ins.rows[0]
  if (!row) {
    res.status(500).json({ error: 'Insert failed.' })
    return
  }
  res.status(201).json({ rule: row })
})

router.put('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid id.' })
    return
  }
  const body = req.body as Record<string, unknown>
  const cur = await pool.query<SiteNotificationEmailRuleRow>(
    `SELECT id, site_id, name, enabled, event_kind, condition_json,
            recipient_emails, recipient_user_ids, cooldown_seconds,
            email_subject, email_body,
            created_at, updated_at
     FROM site_notification_email_rules WHERE id = $1`,
    [id],
  )
  const existing = cur.rows[0]
  if (!existing) {
    res.status(404).json({ error: 'Rule not found.' })
    return
  }

  const name =
    typeof body.name === 'string' ? body.name.trim() : existing.name
  const enabled =
    typeof body.enabled === 'boolean' ? body.enabled : existing.enabled
  const eventKindRaw =
    typeof body.event_kind === 'string' ? body.event_kind.trim() : existing.event_kind
  if (!isNotificationEventKind(eventKindRaw)) {
    res.status(400).json({ error: 'Invalid event_kind.' })
    return
  }
  let conditionJson: Record<string, unknown>
  if (body.condition_json !== undefined) {
    try {
      conditionJson = parseConditionJson(body.condition_json)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Bad condition_json' })
      return
    }
  } else {
    conditionJson = existing.condition_json
  }
  let recipientEmails: string[] =
    body.recipient_emails !== undefined ? [] : existing.recipient_emails
  if (body.recipient_emails !== undefined) {
    const raw = parseStringArray(body.recipient_emails)
    for (const em of raw) {
      if (!isValidEmailFormat(em)) {
        res.status(400).json({ error: `Invalid email: ${em}` })
        return
      }
      recipientEmails.push(em.toLowerCase())
    }
  }
  const recipientUserIds =
    body.recipient_user_ids !== undefined
      ? parseUuidArray(body.recipient_user_ids)
      : existing.recipient_user_ids
  let cooldownSeconds = existing.cooldown_seconds
  if (body.cooldown_seconds !== undefined) {
    const c = body.cooldown_seconds
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) {
      res.status(400).json({ error: 'cooldown_seconds must be a non-negative integer.' })
      return
    }
    cooldownSeconds = Math.min(86400 * 365, c)
  }

  let emailSubject: string | null = existing.email_subject ?? null
  let emailBody: string | null = existing.email_body ?? null
  if (body.email_subject !== undefined) {
    try {
      emailSubject = parseMailTemplateField(body.email_subject, MAX_MAIL_SUBJECT_LEN)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid email_subject.' })
      return
    }
  }
  if (body.email_body !== undefined) {
    try {
      emailBody = parseMailTemplateField(body.email_body, MAX_MAIL_BODY_LEN)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid email_body.' })
      return
    }
  }

  const upd = await pool.query<SiteNotificationEmailRuleRow>(
    `UPDATE site_notification_email_rules SET
       name = $2,
       enabled = $3,
       event_kind = $4,
       condition_json = $5::jsonb,
       recipient_emails = $6::text[],
       recipient_user_ids = $7::uuid[],
       cooldown_seconds = $8,
       email_subject = $9,
       email_body = $10,
       updated_at = now()
     WHERE id = $1
     RETURNING id, site_id, name, enabled, event_kind, condition_json,
               recipient_emails, recipient_user_ids, cooldown_seconds,
               email_subject, email_body,
               created_at, updated_at`,
    [
      id,
      name,
      enabled,
      eventKindRaw,
      JSON.stringify(conditionJson),
      recipientEmails,
      recipientUserIds,
      cooldownSeconds,
      emailSubject,
      emailBody,
    ],
  )
  res.json({ rule: upd.rows[0] })
})

router.delete('/:id', async (req, res) => {
  const id = req.params.id
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid id.' })
    return
  }
  const r = await pool.query(`DELETE FROM site_notification_email_rules WHERE id = $1`, [id])
  if ((r.rowCount ?? 0) === 0) {
    res.status(404).json({ error: 'Rule not found.' })
    return
  }
  res.status(204).send()
})

export default router

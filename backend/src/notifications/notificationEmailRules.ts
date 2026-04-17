import type { Pool } from 'pg'
import pino from 'pino'
import { env } from '../env.js'
import { sendMail } from '../mail/sendMail.js'
import type { NotificationDraft, NotificationKind } from './workOrderNotifications.js'

const logger = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

export const NOTIFICATION_EVENT_KINDS: readonly NotificationKind[] = [
  'work_order_field_changed',
  'work_order_employee_assigned',
  'work_order_employee_deassigned',
  'work_instruction_created',
  'work_instruction_updated',
  'work_instruction_deleted',
] as const

export function isNotificationEventKind(s: string): s is NotificationKind {
  return (NOTIFICATION_EVENT_KINDS as readonly string[]).includes(s)
}

export type SiteNotificationEmailRuleRow = {
  id: string
  site_id: string
  name: string
  enabled: boolean
  event_kind: string
  condition_json: Record<string, unknown>
  recipient_emails: string[]
  recipient_user_ids: string[]
  cooldown_seconds: number
  /** When null/empty at send time, a default subject is used. */
  email_subject: string | null
  /** When null/empty at send time, a default body is used. */
  email_body: string | null
  created_at: Date
  updated_at: Date
}

const MAX_MAIL_SUBJECT_LEN = 500
const MAX_MAIL_BODY_LEN = 100_000

/**
 * Replaces `{wo_key}`, `{message}`, `{work_order_id}`, `{kind}`, `{rule_name}`, `{payload_json}` in templates.
 * Unknown `{tokens}` are left unchanged.
 */
export function formatNotificationEmailTemplates(params: {
  subjectTemplate: string | null | undefined
  bodyTemplate: string | null | undefined
  ruleName: string
  draft: NotificationDraft
  workOrderId: string
  woKey: number
}): { subject: string; text: string } {
  const { subjectTemplate, bodyTemplate, ruleName, draft, workOrderId, woKey } = params
  const payloadJson = JSON.stringify(draft.payloadJson, null, 2)
  const vars: Record<string, string> = {
    wo_key: String(woKey),
    message: draft.message,
    work_order_id: workOrderId,
    kind: draft.kind,
    rule_name: ruleName,
    payload_json: payloadJson,
  }
  const defaultSubject = `[WO ${woKey}] ${draft.message}`
  const defaultText = `${draft.message}\n\nwork_order_id: ${workOrderId}\nkind: ${draft.kind}\n\n${payloadJson}`

  function apply(tmpl: string): string {
    return tmpl.replace(/\{(\w+)\}/g, (_, key: string) =>
      key in vars ? vars[key]! : `{${key}}`,
    )
  }

  const subTrim = typeof subjectTemplate === 'string' ? subjectTemplate.trim() : ''
  const bodyTrim = typeof bodyTemplate === 'string' ? bodyTemplate.trim() : ''

  const subject = subTrim
    ? apply(subTrim).slice(0, MAX_MAIL_SUBJECT_LEN)
    : defaultSubject
  const text = bodyTrim
    ? apply(bodyTrim).slice(0, MAX_MAIL_BODY_LEN)
    : defaultText
  return { subject, text }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

/**
 * `condition_json` is optional filters on `draft.payloadJson`.
 * Empty object means "any payload for this event_kind".
 * Supported keys when present: `field`, `before`, `after`, `employee_id`, `work_instruction_id`.
 */
export function notificationRuleMatchesDraft(
  rule: Pick<SiteNotificationEmailRuleRow, 'event_kind' | 'condition_json'>,
  draft: NotificationDraft,
): boolean {
  if (rule.event_kind !== draft.kind) return false
  const cond = rule.condition_json
  if (!cond || typeof cond !== 'object' || Object.keys(cond).length === 0) {
    return true
  }
  const p = draft.payloadJson
  if (typeof cond.field === 'string') {
    if (!valuesEqual(p.field, cond.field)) return false
  }
  if ('before' in cond) {
    if (!valuesEqual(p.before, cond.before)) return false
  }
  if ('after' in cond) {
    if (!valuesEqual(p.after, cond.after)) return false
  }
  if (typeof cond.employee_id === 'string') {
    if (!valuesEqual(p.employee_id, cond.employee_id)) return false
  }
  if (typeof cond.work_instruction_id === 'string') {
    if (!valuesEqual(p.work_instruction_id, cond.work_instruction_id)) return false
  }
  return true
}

async function resolveRecipientEmails(
  pool: Pool,
  rule: SiteNotificationEmailRuleRow,
): Promise<string[]> {
  const emails = new Set<string>()
  for (const raw of rule.recipient_emails ?? []) {
    const e = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (e.includes('@')) emails.add(e)
  }
  const ids = (rule.recipient_user_ids ?? []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  )
  if (ids.length > 0) {
    const r = await pool.query<{ email: string }>(
      `SELECT lower(trim(email)) AS email
       FROM users
       WHERE id = ANY($1::uuid[])
         AND email IS NOT NULL
         AND char_length(trim(email)) > 0`,
      [ids],
    )
    for (const row of r.rows) {
      if (row.email) emails.add(row.email)
    }
  }
  return [...emails]
}

async function lastFireAt(
  pool: Pool,
  ruleId: string,
  workOrderId: string,
): Promise<Date | null> {
  const r = await pool.query<{ fired_at: Date }>(
    `SELECT fired_at
     FROM site_notification_email_rule_fires
     WHERE rule_id = $1 AND work_order_id = $2
     ORDER BY fired_at DESC
     LIMIT 1`,
    [ruleId, workOrderId],
  )
  return r.rows[0]?.fired_at ?? null
}

async function recordFire(
  pool: Pool,
  ruleId: string,
  workOrderId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO site_notification_email_rule_fires (rule_id, work_order_id)
     VALUES ($1, $2)`,
    [ruleId, workOrderId],
  )
}

export async function runNotificationEmailRules(
  pool: Pool,
  params: {
    siteId: string
    workOrderId: string
    woKey: number
    drafts: NotificationDraft[]
  },
): Promise<void> {
  const { siteId, workOrderId, woKey, drafts } = params
  if (drafts.length === 0) return

  const rulesR = await pool.query<SiteNotificationEmailRuleRow>(
    `SELECT id, site_id, name, enabled, event_kind, condition_json,
            recipient_emails, recipient_user_ids, cooldown_seconds,
            email_subject, email_body,
            created_at, updated_at
     FROM site_notification_email_rules
     WHERE site_id = $1 AND enabled = true`,
    [siteId],
  )
  const rules = rulesR.rows
  if (rules.length === 0) return

  for (const draft of drafts) {
    for (const rule of rules) {
      if (!notificationRuleMatchesDraft(rule, draft)) continue

      const last = await lastFireAt(pool, rule.id, workOrderId)
      if (last) {
        const elapsedSec = (Date.now() - last.getTime()) / 1000
        if (elapsedSec < rule.cooldown_seconds) {
          logger.debug(
            { ruleId: rule.id, workOrderId, cooldown_seconds: rule.cooldown_seconds },
            'notification email rule skipped (cooldown)',
          )
          continue
        }
      }

      const to = await resolveRecipientEmails(pool, rule)
      if (to.length === 0) {
        logger.warn({ ruleId: rule.id, workOrderId }, 'notification email rule has no recipients')
        continue
      }

      const { subject, text } = formatNotificationEmailTemplates({
        subjectTemplate: rule.email_subject,
        bodyTemplate: rule.email_body,
        ruleName: rule.name ?? '',
        draft,
        workOrderId,
        woKey,
      })

      try {
        const sent = await sendMail({ to, subject, text })
        if (sent) {
          await recordFire(pool, rule.id, workOrderId)
          logger.info(
            { ruleId: rule.id, workOrderId, woKey, kind: draft.kind, toCount: to.length },
            'notification email rule sent',
          )
        }
      } catch (err) {
        logger.error(
          { err, ruleId: rule.id, workOrderId, kind: draft.kind },
          'notification email rule send failed',
        )
      }
    }
  }
}

export function scheduleNotificationEmailRules(
  pool: Pool,
  params: {
    siteId: string
    workOrderId: string
    woKey: number
    drafts: NotificationDraft[]
  },
): void {
  if (params.drafts.length === 0) return
  setImmediate(() => {
    void runNotificationEmailRules(pool, params).catch((err) => {
      logger.error({ err, workOrderId: params.workOrderId }, 'runNotificationEmailRules failed')
    })
  })
}

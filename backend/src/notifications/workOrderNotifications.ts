import type { PoolClient } from 'pg'

export type FieldChangeMap = Record<string, { before: unknown; after: unknown }>

export type NotificationKind =
  | 'work_order_field_changed'
  | 'work_instruction_created'
  | 'work_instruction_updated'
  | 'work_instruction_deleted'

export type NotificationDraft = {
  kind: NotificationKind
  message: string
  payloadJson: Record<string, unknown>
}

export type StoredWorkOrderNotification = {
  id: string
  user_id: string
  work_order_id: string
  kind: string
  message: string
  payload_json: Record<string, unknown>
  created_at: Date
  read_at: Date | null
}

const WO_FIELD_LABELS: Record<string, string> = {
  short_text: 'Short Text',
  instruction_text: 'Instruction Text',
  asset_id: 'Asset',
  costcenter_id: 'Cost Center',
  plan_start: 'Plan Start',
  plan_end: 'Plan End',
  worktime: 'Worktime',
  work_type_id: 'Work Type',
  status: 'Status',
  duration: 'Duration',
  category_id: 'Category',
  workgroup_id: 'Workgroup',
}

const WO_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  started: 'Started',
  on_hold: 'On Hold',
  done: 'Done',
  closed: 'Closed',
}

const IGNORED_WO_CHANGE_FIELDS = new Set<string>([
  'id',
  'site_id',
  'wo_key',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'work_plan_id',
  'work_plan_key',
])

function normalizeFieldLabel(key: string): string {
  return WO_FIELD_LABELS[key] ?? key.replaceAll('_', ' ')
}

function normalizeStatusLabel(v: unknown): string {
  if (typeof v !== 'string') return 'Unknown'
  return WO_STATUS_LABELS[v] ?? v
}

export function buildWorkOrderFieldChangeNotifications(params: {
  actorName: string
  workOrderId: string
  workOrderKey: number
  changes: FieldChangeMap | null
}): NotificationDraft[] {
  const { actorName, workOrderId, workOrderKey, changes } = params
  if (!changes) return []
  const out: NotificationDraft[] = []
  for (const [field, delta] of Object.entries(changes)) {
    if (IGNORED_WO_CHANGE_FIELDS.has(field)) continue
    if (field === 'status') {
      const statusLabel = normalizeStatusLabel(delta.after)
      out.push({
        kind: 'work_order_field_changed',
        message: `${actorName} set WO ${workOrderKey} to ${statusLabel}`,
        payloadJson: {
          work_order_id: workOrderId,
          work_order_key: workOrderKey,
          field,
          before: delta.before ?? null,
          after: delta.after ?? null,
        },
      })
      continue
    }
    out.push({
      kind: 'work_order_field_changed',
      message: `${actorName} updated ${normalizeFieldLabel(field)} on WO ${workOrderKey}`,
      payloadJson: {
        work_order_id: workOrderId,
        work_order_key: workOrderKey,
        field,
        before: delta.before ?? null,
        after: delta.after ?? null,
      },
    })
  }
  return out
}

export function buildWorkInstructionCreatedNotification(params: {
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  sortNr: number
}): NotificationDraft {
  const { actorName, workOrderId, workOrderKey, workInstructionId, sortNr } = params
  return {
    kind: 'work_instruction_created',
    message: `${actorName} added Work Instruction ${sortNr} on WO ${workOrderKey}`,
    payloadJson: {
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      work_instruction_id: workInstructionId,
      sort_nr: sortNr,
    },
  }
}

export function buildWorkInstructionUpdatedNotifications(params: {
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  changes: FieldChangeMap | null
}): NotificationDraft[] {
  const { actorName, workOrderId, workOrderKey, workInstructionId, changes } = params
  if (!changes) return []
  const out: NotificationDraft[] = []
  for (const [field, delta] of Object.entries(changes)) {
    if (field === 'done') {
      out.push({
        kind: 'work_instruction_updated',
        message: `${actorName} set Work Instruction on WO ${workOrderKey} to ${delta.after === true ? 'Done' : 'Open'}`,
        payloadJson: {
          work_order_id: workOrderId,
          work_order_key: workOrderKey,
          work_instruction_id: workInstructionId,
          field,
          before: delta.before ?? null,
          after: delta.after ?? null,
        },
      })
      continue
    }
    out.push({
      kind: 'work_instruction_updated',
      message: `${actorName} updated Work Instruction ${normalizeFieldLabel(field)} on WO ${workOrderKey}`,
      payloadJson: {
        work_order_id: workOrderId,
        work_order_key: workOrderKey,
        work_instruction_id: workInstructionId,
        field,
        before: delta.before ?? null,
        after: delta.after ?? null,
      },
    })
  }
  return out
}

export function buildWorkInstructionDeletedNotification(params: {
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  sortNr: number | null
}): NotificationDraft {
  const { actorName, workOrderId, workOrderKey, workInstructionId, sortNr } = params
  return {
    kind: 'work_instruction_deleted',
    message:
      sortNr === null
        ? `${actorName} deleted a Work Instruction on WO ${workOrderKey}`
        : `${actorName} deleted Work Instruction ${sortNr} on WO ${workOrderKey}`,
    payloadJson: {
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      work_instruction_id: workInstructionId,
      sort_nr: sortNr,
    },
  }
}

export async function createNotificationsForSubscribers(
  client: PoolClient,
  params: {
    workOrderId: string
    drafts: NotificationDraft[]
  },
): Promise<StoredWorkOrderNotification[]> {
  const { workOrderId, drafts } = params
  if (drafts.length === 0) return []
  const inserted: StoredWorkOrderNotification[] = []
  for (const draft of drafts) {
    const r = await client.query<StoredWorkOrderNotification>(
      `INSERT INTO work_order_notifications (
         user_id, work_order_id, kind, message, payload_json
       )
       SELECT s.user_id, $1, $2, $3, $4::jsonb
       FROM work_order_subscriptions s
       WHERE s.work_order_id = $1
       RETURNING id, user_id, work_order_id, kind, message, payload_json, created_at, read_at`,
      [
        workOrderId,
        draft.kind,
        draft.message,
        JSON.stringify(draft.payloadJson),
      ],
    )
    inserted.push(...r.rows)
  }
  return inserted
}

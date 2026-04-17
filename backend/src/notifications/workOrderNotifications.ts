import type { PoolClient } from 'pg'

export type FieldChangeMap = Record<string, { before: unknown; after: unknown }>

export type NotificationKind =
  | 'work_order_field_changed'
  | 'work_order_employee_assigned'
  | 'work_order_employee_deassigned'
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
  work_type_id: 'Work Type',
  status: 'Status',
  planned_duration: 'Planned duration',
  category_id: 'Category',
  workgroup_id: 'Workgroup',
}

const WO_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  started: 'Started',
  continued: 'Continued',
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
  'hold_reason',
])

function normalizeFieldLabel(key: string): string {
  return WO_FIELD_LABELS[key] ?? key.replaceAll('_', ' ')
}

function normalizeStatusLabel(v: unknown): string {
  if (typeof v !== 'string') return 'Unknown'
  return WO_STATUS_LABELS[v] ?? v
}

export function buildWorkOrderFieldChangeNotifications(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  changes: FieldChangeMap | null
}): NotificationDraft[] {
  const { actorUserId, actorName, workOrderId, workOrderKey, changes } = params
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
          actor_user_id: actorUserId,
          actor_user_name: actorName,
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
        actor_user_id: actorUserId,
        actor_user_name: actorName,
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

export function buildWorkOrderPutOnHoldNotification(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  reason: string
}): NotificationDraft {
  const { actorUserId, actorName, workOrderId, workOrderKey, reason } = params
  return {
    kind: 'work_order_field_changed',
    message: `${actorName} put WO ${workOrderKey} on hold: ${reason}`,
    payloadJson: {
      actor_user_id: actorUserId,
      actor_user_name: actorName,
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      field: 'status',
      before: null,
      after: 'on_hold',
      hold_reason: reason,
    },
  }
}

export function buildWorkOrderStartedNotification(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  beforeStatus: string
  afterStatus: 'started' | 'continued'
}): NotificationDraft {
  const {
    actorUserId,
    actorName,
    workOrderId,
    workOrderKey,
    beforeStatus,
    afterStatus,
  } = params
  const verb = afterStatus === 'continued' ? 'continued' : 'started'
  return {
    kind: 'work_order_field_changed',
    message: `${actorName} ${verb} WO ${workOrderKey}`,
    payloadJson: {
      actor_user_id: actorUserId,
      actor_user_name: actorName,
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      field: 'status',
      before: beforeStatus,
      after: afterStatus,
    },
  }
}

export function buildWorkInstructionCreatedNotification(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  sortNr: number
}): NotificationDraft {
  const {
    actorUserId,
    actorName,
    workOrderId,
    workOrderKey,
    workInstructionId,
    sortNr,
  } = params
  return {
    kind: 'work_instruction_created',
    message: `${actorName} added Work Instruction ${sortNr} on WO ${workOrderKey}`,
    payloadJson: {
      actor_user_id: actorUserId,
      actor_user_name: actorName,
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      work_instruction_id: workInstructionId,
      sort_nr: sortNr,
    },
  }
}

export function buildWorkInstructionUpdatedNotifications(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  changes: FieldChangeMap | null
}): NotificationDraft[] {
  const {
    actorUserId,
    actorName,
    workOrderId,
    workOrderKey,
    workInstructionId,
    changes,
  } = params
  if (!changes) return []
  const out: NotificationDraft[] = []
  for (const [field, delta] of Object.entries(changes)) {
    if (field === 'done') {
      out.push({
        kind: 'work_instruction_updated',
        message: `${actorName} set Work Instruction on WO ${workOrderKey} to ${delta.after === true ? 'Done' : 'Open'}`,
        payloadJson: {
          actor_user_id: actorUserId,
          actor_user_name: actorName,
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
        actor_user_id: actorUserId,
        actor_user_name: actorName,
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
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  workInstructionId: string
  sortNr: number | null
}): NotificationDraft {
  const {
    actorUserId,
    actorName,
    workOrderId,
    workOrderKey,
    workInstructionId,
    sortNr,
  } = params
  return {
    kind: 'work_instruction_deleted',
    message:
      sortNr === null
        ? `${actorName} deleted a Work Instruction on WO ${workOrderKey}`
        : `${actorName} deleted Work Instruction ${sortNr} on WO ${workOrderKey}`,
    payloadJson: {
      actor_user_id: actorUserId,
      actor_user_name: actorName,
      work_order_id: workOrderId,
      work_order_key: workOrderKey,
      work_instruction_id: workInstructionId,
      sort_nr: sortNr,
    },
  }
}

export function buildWorkOrderEmployeeAssignedNotifications(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  employees: Array<{ id: string; key: string; name: string }>
}): NotificationDraft[] {
  const { actorUserId, actorName, workOrderId, workOrderKey, employees } = params
  if (employees.length === 0) return []
  return employees.map((employee) => {
    const employeeLabel = employee.key?.trim() || employee.name?.trim() || employee.id
    return {
      kind: 'work_order_employee_assigned',
      message: `${actorName} assigned Employee ${employeeLabel} to WO ${workOrderKey}`,
      payloadJson: {
        actor_user_id: actorUserId,
        actor_user_name: actorName,
        employee_id: employee.id,
        employee_key: employee.key,
        employee_name: employee.name,
        work_order_id: workOrderId,
        work_order_key: workOrderKey,
      },
    }
  })
}

export function buildWorkOrderEmployeeDeassignedNotifications(params: {
  actorUserId: string
  actorName: string
  workOrderId: string
  workOrderKey: number
  employees: Array<{ id: string; key: string; name: string }>
}): NotificationDraft[] {
  const { actorUserId, actorName, workOrderId, workOrderKey, employees } = params
  if (employees.length === 0) return []
  return employees.map((employee) => {
    const employeeLabel = employee.key?.trim() || employee.name?.trim() || employee.id
    return {
      kind: 'work_order_employee_deassigned',
      message: `${actorName} de-assigned Employee ${employeeLabel} from WO ${workOrderKey}`,
      payloadJson: {
        actor_user_id: actorUserId,
        actor_user_name: actorName,
        employee_id: employee.id,
        employee_key: employee.key,
        employee_name: employee.name,
        work_order_id: workOrderId,
        work_order_key: workOrderKey,
      },
    }
  })
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

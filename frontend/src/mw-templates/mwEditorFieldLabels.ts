import type { MwFormShellKey } from '@sombra/shared'
import { MW_WORK_ORDER_TAB_IDS } from '@sombra/shared'
import type { TFunction } from 'i18next'

const WO_FIELD_KEYS: Record<string, string> = {
  voice_assist: 'mwte.wo_field_voice_assist',
  wo_key: 'mwte.wo_field_wo_key',
  short_text: 'mwte.wo_field_short_text',
  asset: 'mwte.wo_field_asset',
  cost_center_hint: 'mwte.wo_field_cost_center_hint',
  work_plan_key_readonly: 'mwte.wo_field_work_plan_key_readonly',
  work_type: 'mwte.wo_field_work_type',
  category: 'mwte.wo_field_category',
  instruction: 'mwte.wo_field_instruction',
  work_instructions: 'mwte.wo_field_work_instructions',
  work_plan_interval_count: 'mwte.wo_field_work_plan_interval_count',
  work_plan_interval_type: 'mwte.wo_field_work_plan_interval_type',
  work_plan_next_due: 'mwte.wo_field_work_plan_next_due',
  work_plan_open_button: 'mwte.wo_field_work_plan_open_button',
  workgroup: 'mwte.wo_field_workgroup',
  plan_start: 'mwte.wo_field_plan_start',
  planned_duration: 'mwte.wo_field_planned_duration',
  plan_end: 'mwte.wo_field_plan_end',
  feedback_self: 'mwte.wo_field_feedback_self',
  feedback_extra: 'mwte.wo_field_feedback_extra',
  feedback_target_status: 'mwte.wo_field_feedback_target_status',
  feedback_hold_reason: 'mwte.wo_field_feedback_hold_reason',
  feedback_submit: 'mwte.wo_field_feedback_submit',
  transactions: 'mwte.wo_field_transactions',
}

const TAB_LABEL_KEYS: Record<(typeof MW_WORK_ORDER_TAB_IDS)[number], string> = {
  general: 'mwte.wo_tab_general',
  instructions: 'mwte.wo_tab_instructions',
  work_plan: 'mwte.wo_tab_work_plan',
  planning: 'mwte.wo_tab_planning',
  feedback: 'mwte.wo_tab_feedback',
}

export function mwEditorFieldLabel(
  t: TFunction,
  shell: MwFormShellKey,
  fieldId: string,
): string {
  if (shell === 'costcenter') {
    if (fieldId === 'key') return t('mwte.field_key')
    if (fieldId === 'name') return t('mwte.field_name')
    return fieldId
  }
  const k = WO_FIELD_KEYS[fieldId]
  return k ? t(k) : fieldId
}

export function mwEditorTabLabel(
  t: TFunction,
  tabId: (typeof MW_WORK_ORDER_TAB_IDS)[number],
): string {
  return t(TAB_LABEL_KEYS[tabId])
}

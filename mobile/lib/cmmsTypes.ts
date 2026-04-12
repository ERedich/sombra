/** Mobile CMMS types aligned with backend JSON (ISO dates as strings). */

export type WorkInstructionDto = {
  id: string
  sort_nr: number
  instruction_text: string
  done: boolean
}

export type WorkOrderRow = {
  id: string
  site_id: string
  wo_key: number
  short_text: string
  status: string
  workgroup_id: string
  assigned_employee_ids: string[]
  site_key: string
  site_name: string
  asset_key: string
  asset_name: string
  work_type_key: string
  work_type_name: string
  workgroup_key: string
  workgroup_name: string
  hold_reason: string | null
  instruction_text: string
  created_at: string
  updated_at: string
  /** List API; aligns with web work order row / LIST_SQL. */
  has_material_assignment?: boolean
  has_employee_assignment?: boolean
  work_instruction_count?: number
  work_instruction_done_count?: number
}

export type WorkOrderDetail = WorkOrderRow & {
  work_instructions: WorkInstructionDto[]
}

export type AssetRow = {
  id: string
  site_id: string
  asset_type: string
  key: string
  name: string
  site_key: string
  site_name: string
  equipment_number: string | null
  serial_no: string | null
  build_year: number | null
  parent_asset_key: string | null
  parent_asset_name: string | null
  costcenter_key: string | null
  costcenter_name: string | null
  asset_classification_key: string | null
  asset_classification_name: string | null
  created_at: string
  updated_at: string
}

export type NotificationRow = {
  id: string
  user_id: string
  work_order_id: string
  kind: string
  message: string
  payload_json: Record<string, unknown>
  created_at: string
  read_at: string | null
}

export type WoAppSettings = {
  start_requires_assignment: boolean
  user_auto_assign_on_start: boolean
  idle_session_timeout_minutes: number
}

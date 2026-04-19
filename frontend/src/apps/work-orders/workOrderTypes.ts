/**
 * Shared work order shape for list/detail APIs and cross-app imports.
 */
export type WorkOrder = {
  id: string
  site_id: string
  wo_key: number
  short_text: string
  asset_id: string
  costcenter_id: string | null
  instruction_text: string
  plan_start: string | null
  plan_end: string | null
  work_type_id: string
  work_type_key: string
  work_type_name: string
  work_type_colour: string
  category_id: string | null
  category_key: string | null
  category_name: string | null
  workgroup_id: string
  workgroup_key: string
  workgroup_name: string
  status: string
  work_plan_id?: string | null
  work_plan_key?: string | null
  work_plan_interval_count?: number | null
  work_plan_interval_time_type?: string | null
  work_plan_next_due_at?: string | null
  planned_duration?: string
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  site_key: string
  site_name: string
  site_colour: string
  asset_key: string
  asset_name: string
  costcenter_key: string | null
  costcenter_name: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
  work_instructions?: {
    id: string
    sort_nr: number
    instruction_text: string
    done: boolean
  }[]
  has_material_assignment?: boolean
  has_employee_assignment?: boolean
  assigned_employee_ids?: string[]
  work_instruction_count?: number
  work_instruction_done_count?: number
  hold_reason?: string | null
  started_by_employee_id: string | null
  started_by_employee_key: string | null
  started_by_employee_name: string | null
  continued_by_employee_id: string | null
  continued_by_employee_key: string | null
  continued_by_employee_name: string | null
  done_at: string | null
  done_by_employee_id: string | null
  done_by_employee_key: string | null
  done_by_employee_name: string | null
}

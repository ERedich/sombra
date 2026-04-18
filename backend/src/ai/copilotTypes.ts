import type { ClientAction } from '@sombra/shared'

export type CopilotConfirmable =
  | {
      id: string
      type: 'create_work_order'
      payload: Record<string, unknown>
    }
  | {
      id: string
      type: 'create_work_plan'
      payload: Record<string, unknown>
    }
  | {
      id: string
      type: 'create_asset'
      payload: Record<string, unknown>
    }
  | {
      id: string
      type: 'update_work_order'
      /** UUID of the existing WO to PATCH (frontend target: PATCH /api/work-orders/:id). */
      work_order_id: string
      /** Site-scoped numeric key for display (wo_key). */
      wo_key: number
      /** Partial update body; only provided fields are sent on PATCH. */
      payload: Record<string, unknown>
      /** Human-readable summary for the confirmation card. */
      summary: {
        short_text: string
        changes: Record<
          string,
          { before: unknown; after: unknown }
        >
      }
    }
  | {
      id: string
      type: 'capacity_allocation'
      work_order_id: string
      wo_key: number
      short_text: string
      /** Body for PUT /api/work-orders/:id/capacity-allocation */
      payload: {
        employee_id: string
        allocation_date: string
        planned_hours: number
      }
      summary: {
        employee_key: string
        employee_name: string
        allocation_date: string
        planned_hours: number
        action: 'set' | 'clear'
      }
    }
  | {
      id: string
      type: 'create_shift_assignment'
      /** Body for POST /api/shift-assignments */
      payload: {
        shift_id: string
        employee_id: string
        assignment_date: string
      }
      summary: {
        shift_key: string
        shift_name: string
        time_start: string
        time_end: string
        employee_key: string
        employee_name: string
        assignment_date: string
      }
    }

export type CopilotTurnResponse = {
  message: { role: 'assistant'; content: string }
  confirmable: CopilotConfirmable[]
  client_actions: ClientAction[]
}

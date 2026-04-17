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

export type CopilotTurnResponse = {
  message: { role: 'assistant'; content: string }
  confirmable: CopilotConfirmable[]
  client_actions: ClientAction[]
}

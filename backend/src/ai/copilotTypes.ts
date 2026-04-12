export type CopilotConfirmable =
  | {
      id: string
      type: 'create_work_order'
      payload: Record<string, unknown>
    }
  | {
      id: string
      type: 'create_asset'
      payload: Record<string, unknown>
    }

export type CopilotTurnResponse = {
  message: { role: 'assistant'; content: string }
  confirmable: CopilotConfirmable[]
}

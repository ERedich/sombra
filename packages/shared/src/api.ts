/** Relative to API origin (no trailing slash). */
export const API_PREFIX = '/api'

export const authPaths = {
  login: `${API_PREFIX}/auth/login`,
  logout: `${API_PREFIX}/auth/logout`,
  me: `${API_PREFIX}/auth/me`,
  workingSite: `${API_PREFIX}/auth/working-site`,
} as const

export const cmmsPaths = {
  workOrders: `${API_PREFIX}/work-orders`,
  workPlans: `${API_PREFIX}/work-plans`,
  workOrder: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}`,
  workOrderCapacityAllocation: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}/capacity-allocation`,
  workOrderEmployees: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}/employees`,
  workOrderStart: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}/actions/start`,
  workOrderHold: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}/actions/hold`,
  workOrderFeedback: (id: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(id)}/actions/feedback`,
  workOrderWorkInstruction: (workOrderId: string, workInstructionId: string) =>
    `${API_PREFIX}/work-orders/${encodeURIComponent(workOrderId)}/work-instructions/${encodeURIComponent(workInstructionId)}`,
  workOrderSubscriptions: `${API_PREFIX}/work-orders/subscriptions`,
  workOrderSubscriptionsBulk: `${API_PREFIX}/work-orders/subscriptions/bulk`,
  assets: `${API_PREFIX}/assets`,
  asset: (id: string) =>
    `${API_PREFIX}/assets/${encodeURIComponent(id)}`,
  appParameters: `${API_PREFIX}/app-parameters`,
  notifications: `${API_PREFIX}/notifications`,
  notificationsUnreadCount: `${API_PREFIX}/notifications/unread-count`,
  notificationsMarkRead: `${API_PREFIX}/notifications/mark-read-visible`,
  aiSuggest: `${API_PREFIX}/ai/suggest`,
  aiTranscribe: `${API_PREFIX}/ai/transcribe`,
  aiCopilotTurn: `${API_PREFIX}/ai/copilot/turn`,
  aiStatus: `${API_PREFIX}/ai/status`,
  aiSimilarWorkOrders: `${API_PREFIX}/ai/similar-work-orders`,
  aiAtheneAsk: `${API_PREFIX}/ai/athene/ask`,
  shiftAssignments: `${API_PREFIX}/shift-assignments`,
  documents: `${API_PREFIX}/documents`,
  documentsCounts: `${API_PREFIX}/documents/counts`,
  document: (id: string) =>
    `${API_PREFIX}/documents/${encodeURIComponent(id)}`,
  documentFile: (id: string) =>
    `${API_PREFIX}/documents/${encodeURIComponent(id)}/file`,
  pcrProblems: `${API_PREFIX}/pcr-problems`,
  pcrProblem: (id: string) =>
    `${API_PREFIX}/pcr-problems/${encodeURIComponent(id)}`,
  pcrCauses: (problemId?: string) =>
    problemId
      ? `${API_PREFIX}/pcr-causes?problem_id=${encodeURIComponent(problemId)}`
      : `${API_PREFIX}/pcr-causes`,
  pcrCause: (id: string) =>
    `${API_PREFIX}/pcr-causes/${encodeURIComponent(id)}`,
  pcrRemedies: (causeId?: string) =>
    causeId
      ? `${API_PREFIX}/pcr-remedies?cause_id=${encodeURIComponent(causeId)}`
      : `${API_PREFIX}/pcr-remedies`,
  pcrRemedy: (id: string) =>
    `${API_PREFIX}/pcr-remedies/${encodeURIComponent(id)}`,
} as const

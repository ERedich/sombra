export const DOCUMENT_ENTITY_TYPES = [
  'asset',
  'employee',
  'work_order',
] as const

export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number]

export type DocumentSummary = {
  id: string
  site_id: string
  entity_type: DocumentEntityType
  entity_id: string
  original_filename: string
  mime_type: string
  size_bytes: number
  storage: 'database' | 'filesystem'
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  created_by_login_name: string | null
  updated_by_login_name: string | null
}

export type DocumentsListResponse = {
  documents: DocumentSummary[]
  count: number
}

export type DocumentUploadResponse = {
  document: DocumentSummary
}

export type DocumentCountsResponse = {
  counts: Record<string, number>
}

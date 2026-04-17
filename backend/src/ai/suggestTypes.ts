/** Reference row sent by the client (site-scoped lists). */
export type AiRefItem = {
  id: string
  key?: string
  name?: string
}

export type AiSuggestContext = {
  assets?: AiRefItem[]
  work_types?: AiRefItem[]
  workgroups?: AiRefItem[]
  categories?: AiRefItem[]
  costcenters?: AiRefItem[]
  asset_classifications?: AiRefItem[]
}

export type AiSuggestRequestBody = {
  kind: 'work_order' | 'asset'
  transcript: string
  context: AiSuggestContext
}

export type AiCandidate = {
  id: string
  label: string
  score: number
}

export type AiWorkOrderDraft = {
  short_text: string | null
  instruction_text: string | null
  asset_id: string | null
  work_type_id: string | null
  workgroup_id: string | null
  category_id: string | null
  planned_duration: number | null
  plan_start: string | null
}

export type AiAssetDraft = {
  key: string | null
  name: string | null
  asset_type:
    | 'location'
    | 'building'
    | 'group'
    | 'maintenance_object'
    | null
  parent_asset_id: string | null
  costcenter_id: string | null
  asset_classification_id: string | null
  equipment_number: string | null
  serial_no: string | null
  build_year: number | null
  warranty_end: string | null
  priority: number | null
}

export type AiSuggestResponse = {
  kind: 'work_order' | 'asset'
  transcript_echo: string
  draft: AiWorkOrderDraft | AiAssetDraft
  validated: AiWorkOrderDraft | AiAssetDraft
  unresolved: string[]
  candidates: Record<string, AiCandidate[]>
  warnings: string[]
}

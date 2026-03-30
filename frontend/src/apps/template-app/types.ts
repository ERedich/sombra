/**
 * Guidelines: id, key, name (+ timestamps). Each row is tied to the user’s
 * working site (`site_id`) like API-backed skeleton apps.
 */
export type TemplateEntity = {
  id: string
  site_id: string
  key: string
  name: string
  created_at: string
  updated_at: string
}

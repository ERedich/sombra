/**
 * Asset create/edit dialog layout.
 * - `tabs`: TabView — Basic Information, Equipment, Dates (default UX).
 * - `default`: original stacked Fieldset layout (full form, no tabs).
 * - `quick`: essential fields + collapsible "More details" panel.
 *
 * Set to `'default'` or `'quick'` to roll back without other code changes.
 */
export type AssetFormVariant = 'default' | 'quick' | 'tabs'

export const ASSET_FORM_VARIANT: AssetFormVariant = 'tabs'

/** PrimeReact Dialog `style.width` — wide modals for readability on large screens. */
export const ASSET_FORM_DIALOG_WIDTH: Record<AssetFormVariant, string> = {
  quick: 'min(48rem, 96vw)',
  default: 'min(62rem, 96vw)',
  tabs: 'min(80rem, 96vw)',
}

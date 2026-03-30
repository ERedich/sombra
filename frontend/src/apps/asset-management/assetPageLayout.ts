/**
 * How the asset management page combines list and form.
 * - `split`: table view and details view side-by-side (or stacked on narrow viewports).
 * - `modal`: table view full width; details view opens in a Dialog (rollback).
 */
export type AssetPageLayout = 'split' | 'modal'

export const ASSET_PAGE_LAYOUT: AssetPageLayout = 'modal'

/** Main content wrapper: nearly full viewport width with comfortable margins. */
export const ASSET_PAGE_CONTAINER_CLASS =
  'w-full max-w-[min(100rem,calc(100vw-2rem))] mx-auto p-4 md:p-6'

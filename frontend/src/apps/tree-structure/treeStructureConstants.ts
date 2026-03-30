/** Stable empty expansion map (avoid new `{}` each render for memo). */
export const EMPTY_EXPANDED_KEYS: Record<string, boolean> = Object.freeze({})

/** Expand row animation duration (matches CSS --app-tree-anim-ms). */
export const TREE_ANIM_MS = 480
/**
 * Skip expand-row animation when a node has more direct children than this.
 * Large expands would otherwise schedule huge CSS animation delays.
 */
export const EXPAND_ANIM_MAX_CHILDREN = 80

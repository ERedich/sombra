import type { TreeNode } from 'primereact/treenode'

/** All node keys that have children (for expand-all). */
export function collectExpandableKeys(nodes: TreeNode[]): Record<string, boolean> {
  const keys: Record<string, boolean> = {}
  function walk(n: TreeNode) {
    if (n.children?.length) {
      const k = n.key
      if (k !== undefined && k !== null) {
        keys[String(k)] = true
      }
      for (const c of n.children) walk(c)
    }
  }
  for (const n of nodes) walk(n)
  return keys
}

export type FlatTreeRow = {
  node: TreeNode
  /** Indentation depth (0 = root). */
  depth: number
}

/** Flatten visible nodes in tree order (respects `expandedKeys`). */
export function flattenVisibleTreeNodes(
  nodes: TreeNode[],
  expandedKeys: Record<string, boolean>,
): FlatTreeRow[] {
  const out: FlatTreeRow[] = []

  function walk(list: TreeNode[], depth: number) {
    for (const n of list) {
      out.push({ node: n, depth })
      const k = n.key
      if (k === undefined || k === null) continue
      if (n.children?.length && expandedKeys[String(k)]) {
        walk(n.children, depth + 1)
      }
    }
  }

  walk(nodes, 0)
  return out
}

import type { AiCandidate, AiRefItem } from './suggestTypes.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüßáéíóúàèìòùâêîôûçñ\s-]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
}

export function labelForRef(it: AiRefItem): string {
  const k = (it.key ?? '').trim()
  const n = (it.name ?? '').trim()
  if (k && n) return `${k} — ${n}`
  return k || n || it.id.slice(0, 8)
}

/** Score reference items by word overlap with transcript + optional hint string. */
export function rankRefMatches(
  transcript: string,
  items: AiRefItem[] | undefined,
  topN: number,
): AiCandidate[] {
  if (!items?.length) return []
  const words = new Set(tokenize(transcript))
  if (words.size === 0) return []
  const scored: AiCandidate[] = []
  for (const it of items) {
    if (!UUID_RE.test(it.id)) continue
    const blob = tokenize(
      `${it.key ?? ''} ${it.name ?? ''} ${it.id}`.toLowerCase(),
    )
    let score = 0
    for (const w of blob) {
      if (words.has(w)) score += 1
    }
    if (score > 0) {
      scored.push({ id: it.id, label: labelForRef(it), score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}

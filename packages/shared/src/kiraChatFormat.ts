export type BoldTextSegment = { kind: 'text' | 'bold'; value: string }

/**
 * Splits `before **emphasis** after` into plain vs bold runs (paired `**` only).
 * Unmatched `**` stays in the trailing plain-text segment.
 */
export function parseDoubleAsteriskBold(text: string): BoldTextSegment[] {
  if (!text || !text.includes('**')) {
    return [{ kind: 'text', value: text }]
  }
  const out: BoldTextSegment[] = []
  const re = /\*\*([\s\S]*?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', value: text.slice(last, m.index) })
    }
    out.push({ kind: 'bold', value: m[1] ?? '' })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) })
  }
  return out.length > 0 ? out : [{ kind: 'text', value: text }]
}

/** One-line composer seed for “Ask Kira” from a grid row (ASCII-friendly). */
export function formatKiraRowDraft(
  entityLabel: string,
  row: {
    id: string
    key?: string | null
    name?: string | null
    login_name?: string | null
  },
): string {
  const bits: string[] = [entityLabel.trim() || 'Record']
  if (row.key != null && String(row.key).trim() !== '') {
    bits.push(`key=${String(row.key).trim()}`)
  }
  if (row.name != null && String(row.name).trim() !== '') {
    bits.push(`name="${String(row.name).trim()}"`)
  }
  if (row.login_name != null && String(row.login_name).trim() !== '') {
    bits.push(`login=${String(row.login_name).trim()}`)
  }
  bits.push(`id=${row.id}`)
  return `[${bits.join(' · ')}]\n\n`
}

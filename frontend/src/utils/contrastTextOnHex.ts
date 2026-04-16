/** Readable foreground (#0f172a or #fff) for a 6-digit hex background. */
export function contrastTextOnHex(bgHex: string): string {
  const s = bgHex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return '#ffffff'
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#0f172a' : '#ffffff'
}

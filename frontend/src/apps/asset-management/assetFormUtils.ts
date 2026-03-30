export function formatDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateOnly(s: string | null): Date | null {
  if (!s) return null
  const d = new Date(`${s}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

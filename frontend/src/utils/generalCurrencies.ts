/** CURR: matches backend `DEFAULT_GENERAL_CURRENCIES` / `normalizeGeneralCurrenciesList`. */
export const DEFAULT_GENERAL_CURRENCIES: readonly string[] = ['EUR']

export const GENERAL_CURRENCIES_MAX = 24

const CODE_RE = /^[A-Za-z]{3}$/

function normalizeOne(raw: string): string | null {
  const u = raw.trim().toUpperCase()
  return CODE_RE.test(u) ? u : null
}

/** Lenient: invalid entries dropped, deduped, at least one code, max GENERAL_CURRENCIES_MAX. */
export function normalizeGeneralCurrenciesFromApi(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_GENERAL_CURRENCIES]
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const c = normalizeOne(x)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
    if (out.length >= GENERAL_CURRENCIES_MAX) break
  }
  return out.length > 0 ? out : [...DEFAULT_GENERAL_CURRENCIES]
}

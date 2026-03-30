/** Pragmatic single-address check (local@domain with at least one dot in domain). */
export function isValidEmailFormat(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

const MAX_EMAIL_LENGTH = 254

/**
 * Optional email for API bodies: null/empty → null; non-empty must be valid.
 * Normalizes to lowercase for storage (matches login lookup `lower(email)`).
 */
export function parseOptionalEmail(
  input: unknown,
):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  if (input === null || input === undefined) {
    return { ok: true, value: null }
  }
  if (typeof input !== 'string') {
    return { ok: false, error: 'Email must be a string.' }
  }
  const trimmed = input.trim()
  if (trimmed === '') {
    return { ok: true, value: null }
  }
  if (trimmed.length > MAX_EMAIL_LENGTH) {
    return {
      ok: false,
      error: `Email must be at most ${MAX_EMAIL_LENGTH} characters.`,
    }
  }
  if (!isValidEmailFormat(trimmed)) {
    return { ok: false, error: 'Invalid email format.' }
  }
  return { ok: true, value: trimmed.toLowerCase() }
}

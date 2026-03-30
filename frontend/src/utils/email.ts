/** Keep in sync with backend `validation/email.ts` `isValidEmailFormat`. */
export function isValidEmailFormat(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

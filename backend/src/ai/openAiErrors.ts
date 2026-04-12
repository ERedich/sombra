/** Maps OpenAI HTTP errors to a safe client message and HTTP status for our API. */

export class OpenAiRequestError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'OpenAiRequestError'
    this.statusCode = statusCode
  }
}

type OpenAiErrJson = {
  error?: { message?: string; code?: string; type?: string }
}

/**
 * @param httpStatus response status from OpenAI
 * @param rawBody response body text (JSON)
 */
export function throwOpenAiHttpError(httpStatus: number, rawBody: string): never {
  let code: string | undefined
  let type: string | undefined
  try {
    const j = JSON.parse(rawBody) as OpenAiErrJson
    code = j.error?.code
    type = j.error?.type
  } catch {
    /* ignore */
  }

  if (httpStatus === 429 && code === 'insufficient_quota') {
    throw new OpenAiRequestError(
      'OpenAI quota exceeded or billing inactive. Add payment method or credits at https://platform.openai.com/account/billing',
      503,
    )
  }

  if (
    code === 'billing_not_active' ||
    type === 'billing_not_active' ||
    code === 'insufficient_quota'
  ) {
    throw new OpenAiRequestError(
      'OpenAI billing is not active or quota is exhausted. See https://platform.openai.com/account/billing',
      503,
    )
  }

  if (httpStatus === 429) {
    throw new OpenAiRequestError(
      'OpenAI rate limit exceeded. Try again in a moment.',
      429,
    )
  }

  if (httpStatus === 401) {
    throw new OpenAiRequestError(
      'OpenAI rejected the API key (invalid or revoked). Check OPENAI_API_KEY.',
      503,
    )
  }

  throw new OpenAiRequestError(
    `AI provider request failed (HTTP ${httpStatus}).`,
    502,
  )
}

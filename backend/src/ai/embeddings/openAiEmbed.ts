import { env } from '../../env.js'
import { throwOpenAiHttpError } from '../openAiErrors.js'

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

type OpenAiEmbeddingResponse = {
  data?: { embedding?: number[]; index?: number }[]
  model?: string
}

export type EmbeddingResult = {
  vectors: number[][]
  model: string
}

/**
 * Call OpenAI's embeddings endpoint. Splits `inputs` into chunks of
 * `AI_EMBEDDING_BATCH_SIZE` so we never exceed request limits. Empty strings
 * are rejected by OpenAI, so callers must pre-filter.
 */
export async function embedTexts(inputs: string[]): Promise<EmbeddingResult> {
  const key = env.OPENAI_API_KEY
  if (!key?.trim()) {
    throw new Error('OPENAI_API_KEY not configured')
  }
  if (inputs.length === 0) {
    return { vectors: [], model: env.OPENAI_EMBEDDING_MODEL }
  }

  const model = env.OPENAI_EMBEDDING_MODEL
  const batchSize = env.AI_EMBEDDING_BATCH_SIZE
  const out: number[][] = new Array(inputs.length)

  for (let start = 0; start < inputs.length; start += batchSize) {
    const slice = inputs.slice(start, start + batchSize)

    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: slice }),
    })

    const rawText = await res.text()
    if (!res.ok) {
      throwOpenAiHttpError(res.status, rawText)
    }

    let parsed: OpenAiEmbeddingResponse
    try {
      parsed = JSON.parse(rawText) as OpenAiEmbeddingResponse
    } catch {
      throw new Error('OpenAI embeddings response was not JSON')
    }

    const data = parsed.data
    if (!Array.isArray(data) || data.length !== slice.length) {
      throw new Error('OpenAI embeddings response shape unexpected')
    }

    for (const item of data) {
      const idx = typeof item.index === 'number' ? item.index : -1
      const vec = item.embedding
      if (idx < 0 || idx >= slice.length || !Array.isArray(vec)) {
        throw new Error('OpenAI embeddings response missing vector')
      }
      out[start + idx] = vec
    }
  }

  return { vectors: out, model }
}

/** pgvector accepts textual literals like `[0.1,0.2,...]` cast to vector. */
export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

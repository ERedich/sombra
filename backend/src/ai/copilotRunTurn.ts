import type { Pool } from 'pg'
import { env } from '../env.js'
import { throwOpenAiHttpError } from './openAiErrors.js'
import {
  COPILOT_TOOL_DEFINITIONS,
  executeCopilotTool,
} from './copilotTools.js'
import type { CopilotConfirmable, CopilotTurnResponse } from './copilotTypes.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_ITERATIONS = 8

type OpenAiToolCall = {
  id: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type ApiMessage =
  | {
      role: 'system' | 'user' | 'assistant'
      content: string | null
      tool_calls?: OpenAiToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

function sanitizeClientMessages(
  raw: unknown,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of raw.slice(-32)) {
    if (typeof m !== 'object' || m === null) continue
    const role = (m as { role?: unknown }).role
    if (role !== 'user' && role !== 'assistant') continue
    const content = (m as { content?: unknown }).content
    if (typeof content !== 'string') continue
    const c = content.trim().slice(0, 12000)
    if (!c) continue
    out.push({ role, content: c })
  }
  return out
}

function buildSystemPrompt(args: {
  siteId: string
  locale: string
}): string {
  const loc = (args.locale || 'en').toLowerCase()
  const langRule =
    loc === 'de' || loc.startsWith('de-')
      ? 'Antworte durchgehend auf Deutsch, außer der Nutzer verlangt ausdrücklich eine andere Sprache.'
      : 'Reply in English unless the user explicitly asks for another language.'
  return [
    'You are a CMMS copilot for a single maintenance site.',
    `Working site_id (UUID): ${args.siteId}.`,
    `User interface locale code: ${loc}. ${langRule}`,
    'You never create or update database records yourself. Use tools to read data and to register validated create payloads; the user must confirm writes in the app.',
    'Do not invent UUIDs: only use ids from tool outputs (search, lists, suggest validated fields, etc.).',
    'When the user wants a new work order or asset, prefer suggest_* tools to extract fields, then prepare_create_* once required fields are known.',
  ].join('\n')
}

type OpenAiChoiceMessage = {
  role?: string
  content?: string | null
  tool_calls?: OpenAiToolCall[]
}

function parseOpenAiAssistantMessage(
  msg: OpenAiChoiceMessage | undefined,
): ApiMessage | null {
  if (!msg || msg.role !== 'assistant') return null
  const content =
    typeof msg.content === 'string'
      ? msg.content
      : msg.content === null
        ? null
        : null
  if (msg.tool_calls?.length) {
    return {
      role: 'assistant',
      content,
      tool_calls: msg.tool_calls,
    }
  }
  if (content !== null && content.trim()) {
    return { role: 'assistant', content }
  }
  return null
}

async function openAiChatCompletion(args: {
  messages: ApiMessage[]
}): Promise<OpenAiChoiceMessage | undefined> {
  const key = env.OPENAI_API_KEY
  if (!key?.trim()) throw new Error('OPENAI_API_KEY not configured')

  const model =
    env.OPENAI_COPILOT_MODEL?.trim() || env.OPENAI_SUGGEST_MODEL

  const body = {
    model,
    temperature: 0.25,
    messages: args.messages,
    tools: [...COPILOT_TOOL_DEFINITIONS],
    tool_choice: 'auto' as const,
  }

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const rawText = await res.text()
  if (!res.ok) {
    throwOpenAiHttpError(res.status, rawText)
  }

  type OpenAiChatResponse = {
    choices?: { message?: OpenAiChoiceMessage }[]
  }
  let parsed: OpenAiChatResponse
  try {
    parsed = JSON.parse(rawText) as OpenAiChatResponse
  } catch {
    throw new Error('OpenAI response was not JSON')
  }

  return parsed.choices?.[0]?.message
}

export async function runCopilotTurn(args: {
  pool: Pool
  siteId: string
  locale: string
  messages: unknown
}): Promise<CopilotTurnResponse> {
  const clientMsgs = sanitizeClientMessages(args.messages)
  if (clientMsgs.length === 0) {
    throw new Error('messages must include at least one user or assistant entry.')
  }

  const confirmables: CopilotConfirmable[] = []
  const toolCtx = {
    pool: args.pool,
    siteId: args.siteId,
    confirmables,
  }

  const apiMessages: ApiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        siteId: args.siteId,
        locale: args.locale,
      }),
    },
    ...clientMsgs.map(
      (m): ApiMessage => ({ role: m.role, content: m.content }),
    ),
  ]

  let iterations = 0
  let lastAssistantText = ''

  while (iterations < MAX_ITERATIONS) {
    iterations += 1
    const choice = await openAiChatCompletion({ messages: apiMessages })
    const assistantMsg = parseOpenAiAssistantMessage(choice)

    if (!assistantMsg) {
      lastAssistantText =
        'Sorry, I could not produce a response. Please try again.'
      break
    }

    apiMessages.push(assistantMsg)

    if (
      assistantMsg.role === 'assistant' &&
      assistantMsg.tool_calls?.length
    ) {
      for (const tc of assistantMsg.tool_calls) {
        const name = tc.function?.name ?? ''
        const argStr = tc.function?.arguments ?? '{}'
        const result = await executeCopilotTool({
          name,
          argumentsJson: argStr,
          ctx: toolCtx,
        })
        apiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        })
      }
      continue
    }

    if (assistantMsg.role === 'assistant' && assistantMsg.content) {
      lastAssistantText = assistantMsg.content.trim()
    }
    break
  }

  if (!lastAssistantText && iterations >= MAX_ITERATIONS) {
    lastAssistantText =
      'The request took too many steps. Please narrow your question or try again.'
  }

  return {
    message: {
      role: 'assistant',
      content: lastAssistantText || 'No response.',
    },
    confirmable: confirmables,
  }
}


import type { ClientAction } from '@sombra/shared'
import type { Pool } from 'pg'
import { env } from '../env.js'
import {
  getWorkingSiteDetailsForCopilot,
  loadUserEmployeeOnSite,
  loadUserWorkgroupsOnSite,
  type CopilotUserEmployeeOnSite,
  type CopilotWorkingSiteRow,
} from './copilotContext.js'
import { COPILOT_SCHEDULING_MAX_RANGE_DAYS } from './copilotSchedulingSnapshot.js'
import { formatCopilotProductRulesForPrompt } from './copilotRules.js'
import { throwOpenAiHttpError } from './openAiErrors.js'
import {
  COPILOT_TOOL_DEFINITIONS,
  executeCopilotTool,
} from './copilotTools.js'
import type { CopilotConfirmable, CopilotTurnResponse } from './copilotTypes.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_ITERATIONS = 8

/** UTC calendar YYYY-MM-DD from server clock (for copilot "today" anchor). */
function utcCalendarDateToday(): string {
  return new Date().toISOString().slice(0, 10)
}

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

function formatWorkingSiteBlock(site: CopilotWorkingSiteRow | null): string {
  if (!site) {
    return 'Working site record: **not found** in the database for this site_id (unexpected).'
  }
  return [
    'Working site (plant / data scope for all tools; same row as CMMS “site” / Arbeitsstätte):',
    `- **key** (short code): ${JSON.stringify(site.key)}`,
    `- **name** (display): ${JSON.stringify(site.name)}`,
    `- **id** (UUID, equals working site_id above): ${site.id}`,
    `- **colour**: ${JSON.stringify(site.colour)} (UI theme hint; informational)`,
    `- **is_plant**: ${site.is_plant} (true = marked as physical plant in CMMS)`,
  ].join('\n')
}

function buildSystemPrompt(args: {
  siteId: string
  workingSite: CopilotWorkingSiteRow | null
  locale: string
  isAdmin: boolean
  userLoginName: string
  userDisplayName: string
  userWorkgroupsOnSiteJson: string
  userEmployee: CopilotUserEmployeeOnSite | null
  /** Server UTC calendar date; authoritative for "today" / relative ranges. */
  referenceCalendarDateUtc: string
}): string {
  const loc = (args.locale || 'en').toLowerCase()
  const langRule =
    loc === 'de' || loc.startsWith('de-')
      ? 'Antworte durchgehend auf Deutsch, außer der Nutzer verlangt ausdrücklich eine andere Sprache.'
      : 'Reply in English unless the user explicitly asks for another language.'
  return [
    'You are a CMMS copilot for a single maintenance site.',
    `**Current calendar date (authoritative):** ${args.referenceCalendarDateUtc} — this is **today** in UTC from the CMMS server clock when the user sent this message. For "today", "this week", "tomorrow", "next Monday", etc., derive dates from **this** line only. **Ignore** any other assumed "current date" (including from model training data, e.g. 2023 or October 2023).`,
    `Working site_id (UUID): ${args.siteId}.`,
    formatWorkingSiteBlock(args.workingSite),
    `User interface locale code: ${loc}. ${langRule}`,
    `Logged-in **user** (login account in the \`users\` table): login_name=${JSON.stringify(args.userLoginName)}, display_name=${JSON.stringify(args.userDisplayName)}.`,
    '**User vs employee (important):** A `user` is a login account (authentication). An `employee` (DE **Mitarbeiter**, short **MA**) is a site-scoped HR/workforce record in the `employees` table (columns `id`, `key`, `name`, `site_id`) that work orders, workgroups, shifts, and capacity planning refer to. A user may optionally be linked to one employee via `users.employee_id`; the linked employee is how workgroup membership, shift assignments, and "my work" are resolved. Treat `login_name` / `display_name` (user fields) and employee `key` / `name` as separate identifiers — never assume they match. When the user asks things like "welcher MA bin ich", "mein Mitarbeiter", "which employee am I", answer from the **linked employee** line below, not the user name.',
    args.userEmployee
      ? args.userEmployee.on_working_site
        ? `Linked **employee** for this user on the **current working site**: id=${args.userEmployee.id}, key=${JSON.stringify(args.userEmployee.key)}, name=${JSON.stringify(args.userEmployee.name)}. When referring to this employee in replies, you may use the link token \`[[employee:${args.userEmployee.id}]]\` if a deep link is useful (the UI may render it as plain text if the employee app is not registered).`
        : `Linked **employee** for this user exists but belongs to a **different site** (employee site_id=${args.userEmployee.site_id}, current working site_id=${args.siteId}); id=${args.userEmployee.id}, key=${JSON.stringify(args.userEmployee.key)}, name=${JSON.stringify(args.userEmployee.name)}. Tools scoped to this working site will **not** return this employee; tell the user their employee is on a different plant and they may need to switch working site.`
      : 'Linked **employee** for this user: **none** (`users.employee_id` is null). Do not invent an employee; if asked "which MA / employee am I" or about "my workgroup / my shifts / my presence", explain that no employee is linked to this login and HR/admin must connect an `employees` row to the user before workgroup-, shift-, or capacity-related answers are meaningful.',
    `On the current working site, the user's linked employee (if any) belongs to these workgroups as JSON array of {id,key,name} (may be empty): ${args.userWorkgroupsOnSiteJson}`,
    'When the user says "my workgroup", "use my workgroup", "my default workgroup", or similar in any language: (0) If the JSON array is empty, explain they have no employee–workgroup assignment on this working site (HR/admin may need to link an employee and assign workgroups, or they may need to switch working site). (1) If exactly one workgroup, use its `id` as workgroup_id in tools (e.g. prepare_create_work_order) without asking again. (2) If two or more, list each by key and name (and id if helpful) and ask which workgroup they mean before calling tools that need a single workgroup_id.',
    `User is admin: ${args.isAdmin ? 'yes' : 'no'} (admin-only app navigations are rejected for non-admins).`,
    'You can open CMMS apps for the user by calling `request_client_navigation` with a logical `app` id (and optional `entity_id` for assets, workgroups, or work orders). The client validates and performs navigation; the Kira assistant **stays open** by default. Pass `close_kira: true` only if the user explicitly wants the assistant closed after navigation.',
    'When you mention a concrete asset, workgroup, or work order UUID that came from tool output, embed link tokens the UI turns into deep links (exactly): `[[asset:UUID]]`, `[[workgroup:UUID]]`, `[[work_order:UUID]]` — use lowercase type names between the brackets.',
    '**Kira reply formatting:** The Kira web client renders assistant text as **GitHub-Flavored Markdown** (headings, lists, fenced code, **bold** / *italic*, pipe `| ... |` tables) and **sanitized HTML** (e.g. `<table>`, `<thead>`, `<tr>`, `<th>`, `<td>`). Dangerous tags and attributes (scripts, inline event handlers, most `style`) are stripped in the client sanitizer — do not rely on them. Prefer **Markdown pipe tables** or simple HTML tables for tabular summaries; keep using `[[entity:UUID]]` tokens for in-app deep links to those records.',
    '**Tables (when the user asks for a table / HTML table / table view, or DE: Tabelle / Tabellenansicht / als Tabelle):** Put a **real** GFM **pipe** table or `<table>...</table>` **directly in the assistant message**, as normal text — **not** only inside a ``` fenced code block (fences show monospace code; they do **not** render as a table). **Not** ASCII-only box grids (`+---+` / `┌──┐`) as the sole format — those stay plain text. For pipe tables: include a header row, a separator row like `| --- | --- |`, then body rows; each line starts with `|`. Example shape (replace cells):' +
      '\n| Asset | Status |\n| --- | --- |\n| Pump-12 | Open |',
    'Tools load assets, work types, workgroups, work plans (WP), and related reference data for this **working site** (same scope as creating a work order in the app). Use `get_working_site` if you need to re-read site key, name, colour, or plant flag in a long turn.',
    `**Shifts & capacity planning:** use \`list_shift_definitions\` for site shift templates (times, weekdays). Use \`get_scheduling_snapshot\` with \`date_from\` / \`date_to\` (YYYY-MM-DD, inclusive) for work orders with plan windows in that range, shift assignments, capacity allocations, and used hours per employee per day — max ${COPILOT_SCHEDULING_MAX_RANGE_DAYS} calendar days per call. Use \`analyze_scheduling_issues\` for the same window when the user asks to **run a check**, find **bottlenecks**, **collisions**, **overload**, or **scheduling risks**; it returns structured issues (read-only). Prefer narrowing with \`workgroup_id\` when the user cares about one team. Offer \`request_client_navigation\` to apps \`capacity_planner\`, \`shift_planner\`, or \`shifts\` when they should adjust schedules in the UI.`,
    '**Calendar dates (critical):** For `get_scheduling_snapshot`, `analyze_scheduling_issues`, and `prepare_create_work_plan` (`due_date`), tool arguments must match **real calendar dates from the user** — prefer **`YYYY-MM-DD`**. For German messages, `17.04.2026` and `17. Apr. 2026` mean **17 April 2026** → `2026-04-17` (day **before** month in dotted DE form). **Never** invent unrelated years or months. If the user only says "this week", compute `date_from` / `date_to` from the **Current calendar date (authoritative)** line at the top of this system message (UTC week boundaries Monday–Sunday unless the user specifies otherwise). When replying in natural language, restate the ISO range you used so the user can correct you.',
    'Work planning (WP): use `list_work_types` to list work order types (WO types: id, key, name) — **only for creating work orders**, not for defining a new WP. Use `search_work_plans` to list or search maintenance plans (plan_key, asset, interval_count + interval_time_type day|week|month|year, next_due_at, category). Use `get_work_plan_details` for one plan including work instruction lines.',
    '**Work order (WO) vs work plan (WP):** WO = one-off or ad-hoc task (EN work order; DE **Arbeitsauftrag** / Auftrag in CMMS sense). WP = recurring preventive **maintenance plan** (DE **Arbeitsplan** / Wartungsplan: plan_key, interval, first due_date, asset; generated WOs from the due engine use work type PM per product rules). If the user asks to create **a WP / Arbeitsplan / recurring plan / Instandhaltungsplan**, call `prepare_create_work_plan` once required fields are known — **do not** call `suggest_work_order_draft` or `prepare_create_work_order` for that. If they want a **one-off WO / Störung / Reparaturauftrag**, use the WO suggest/prepare tools, not `prepare_create_work_plan`.',
    `Product rules (authoritative; follow when explaining WO/WP behaviour):\n${formatCopilotProductRulesForPrompt()}`,
    'Elsewhere in the app the user may see assets from other plants (e.g. admins, or users with multiple sites). If tools show no assets but the user insists assets exist, tell them to **switch working site** in the app to the plant where those assets live, then try again.',
    'If search_assets returns an empty `assets` array but `total_assets_on_working_site` is greater than zero, there are assets on this site but none matched the search string — say that clearly; do not claim the whole system has no assets.',
    'You never create or update database records yourself. Use tools to read data and to register validated create payloads; the user must confirm writes in the app.',
    'Do not invent UUIDs: only use ids from tool outputs (search, lists, suggest validated fields, etc.). If the user pastes an asset UUID from the CMMS (e.g. from the URL or a bracket line), you may use it with `get_asset_details` after confirming it looks like a valid UUID.',
    'When the user asks who created an asset, when it was created or last updated, or who last changed it, call `get_asset_details` with that asset\'s id.',
    '**Work order (WO) read tools:** `list_open_work_orders` returns recent open WOs with brief fields (incl. `planned_duration_hours`, `plan_start`, `plan_end`, asset, workgroup). `search_work_orders` filters by substring and/or status. `get_work_order_details` returns one WO by UUID or `wo_key` with **all** fields: `short_text`, `instruction_text`, `status`, `hold_reason`, asset, work_type, workgroup, category, costcenter, source work plan, `plan_start`, `plan_end`, **`planned_duration_hours`**, audit (created_at / updated_at + users), assigned employees, and work instruction checklist. Use `get_work_order_details` whenever the user asks about a specific WO — including planned duration / planned work time / `planned_duration`, schedule window, assignees, instructions, or audit — instead of guessing or saying you lack access.',
    '**Updating an existing work order (postpone / reschedule / change status or fields):** Use `prepare_update_work_order`. Identify the WO with `work_order_id` (UUID) or `wo_key`; include **only** the fields that change. For postpone / reschedule (DE: **verschieben**, auf einen anderen Tag legen), set `plan_start` and `plan_end` (ISO, prefer UTC `...Z`) — shift both by the same delta so `planned_duration` stays consistent, or set `planned_duration` explicitly. Do **not** call `suggest_work_order_draft` / `prepare_create_work_order` for an update — those create a brand-new WO. If the user mentions the WO by wo_key, number, or a [[work_order:UUID]] token from a prior tool reply, parse it out and call `prepare_update_work_order` directly; call `get_work_order_details` first if you need the current times to compute a correct delta.',
    '**Shift assignments = the plan for that day (critical — do not invert).** A `shift_assignments` row for employee E on date D means E **is** planned to work that day during `[time_start, time_end]`; overnight shifts (e.g. `20:00` → `06:00` on D) cover D 20:00 UTC through D+1 06:00 UTC as one continuous window. If there is **no** `shift_assignments` row for E on D, E is **not** at work that day — treat them as unavailable, never as "available because nothing is assigned". Presences `scheduled` and `present` count as at-work; `absent` and `not_present` do not. To answer "wer ist am … verfügbar" / "wer kann WO x übernehmen" / "assign employee to WO", call `find_assignable_employees` (pass the WO\'s `plan_start`/`plan_end` or `work_order_id`/`wo_key`; include the WO\'s `workgroup_id` when one team owns the work). Only propose employees returned in `assignable`. Employees in `partial` have a shift that covers **part** of the WO window — offer them only when the user accepts splitting or resizing the WO, and quote the `uncovered_ranges`. Never propose anyone in `excluded_no_shift` (they are either absent, have no shift that day, or their shift falls outside the WO window).',
    '**Capacity KPIs (TCP / TPD / TPC) — use before proposing any postpone / reschedule target:** `TCP` = SPC-adjusted available shift hours in the target range (`tcp_effective_hours` from `get_capacity_kpis`; the raw sum is `tcp_raw_shift_hours`). `TPD` = sum of `planned_duration` of active WOs whose plan window overlaps that range (`tpd_hours`). `TPC = TCP − TPD` (`tpc_hours`): positive = spare capacity, negative = **overloaded**. Before you suggest a new `plan_start` / `plan_end` for a postpone or reschedule, call `get_capacity_kpis` for the candidate range (usually Mon–Sun UTC of the target week) with the WO\'s `workgroup_id` when one team owns the work, and compare the WO\'s `planned_duration` to `tpc_hours` of that range. If `tpc_hours − planned_duration < 0`, do **not** silently move the WO there — explicitly warn the user with concrete numbers (TCP, TPD, TPC, moved duration) and propose an alternative week or workgroup. The final decision stays with the user.',
    '**Fazit marker — final proposal:** End your reply with a short final recommendation wrapped in `[[fazit]] ... [[/fazit]]`. Exactly one fazit per turn, no nesting, 1–3 sentences, plain text or simple Markdown (no HTML blocks). The fazit must always cite the **concrete data and facts** it is based on, so the user can see *why* you arrived at this conclusion: quote the relevant numbers and identifiers (e.g. WO key or [[work_order:UUID]], old vs new `plan_start`/`plan_end`, `planned_duration`, TCP/TPD/TPC in hours, workgroup, any overload warning). A fazit like "Verschieben auf KW 18 (Mo 2026-04-27 08:00 → Fr 2026-05-01 16:00). KW18 KW hat TCP 40 h, TPD 24 h, TPC 16 h — 8 h Auftrag WO-4217 passt." is good; "Ich empfehle die Verschiebung." is not. Omit the marker only when the turn is a pure clarification question with no conclusion.',
    'When the user wants a new work order or asset, prefer suggest_* tools to extract fields, then prepare_create_* once required fields are known. For a new work plan (WP), gather plan_key, short_text, instruction_text, asset_id, interval_count, interval_time_type, due_date (and optional lead_time_days, planned_duration, category_id, work_instructions); then call `prepare_create_work_plan` — there is no suggest_work_plan_draft tool.',
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
  isAdmin: boolean
  userId: string
  userLoginName: string
  userDisplayName: string
  messages: unknown
}): Promise<CopilotTurnResponse> {
  const clientMsgs = sanitizeClientMessages(args.messages)
  if (clientMsgs.length === 0) {
    throw new Error('messages must include at least one user or assistant entry.')
  }

  const [userWgs, workingSite, userEmployee] = await Promise.all([
    loadUserWorkgroupsOnSite(args.pool, args.userId, args.siteId),
    getWorkingSiteDetailsForCopilot(args.pool, args.siteId),
    loadUserEmployeeOnSite(args.pool, args.userId, args.siteId),
  ])
  const userWorkgroupsOnSiteJson = JSON.stringify(userWgs)
  const referenceCalendarDateUtc = utcCalendarDateToday()

  const confirmables: CopilotConfirmable[] = []
  const clientActions: ClientAction[] = []
  const toolCtx = {
    pool: args.pool,
    siteId: args.siteId,
    locale: args.locale || 'en',
    confirmables,
    clientActions,
    isAdmin: args.isAdmin,
  }

  const apiMessages: ApiMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt({
        siteId: args.siteId,
        workingSite,
        locale: args.locale,
        isAdmin: args.isAdmin,
        userLoginName: args.userLoginName,
        userDisplayName: args.userDisplayName,
        userWorkgroupsOnSiteJson,
        userEmployee,
        referenceCalendarDateUtc,
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
    client_actions: clientActions,
  }
}


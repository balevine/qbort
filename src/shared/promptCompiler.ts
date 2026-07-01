import type { StaffMember } from './types'
import { TICKET_STATUSES } from './types'
import { staffEmail, STAFF_EMAIL_DOMAIN } from './staff'

export interface CompilePromptInput {
  /** The user's editable creative/distribution prompt. */
  editablePrompt: string
  /** How many tickets this batch should produce. */
  batchCount: number
  staff: {
    include: boolean
    avgResponses: number
    roster: StaffMember[]
    /** Optional per-ticket targets (length === batchCount). Omit for an averaged directive. */
    responseCounts?: number[]
  }
}

/** The exact JSON shape we ask the model to return (no `id` — the app assigns ids). */
export const OUTPUT_SHAPE = `{
  "tickets": [
    {
      "subject": "string — concise ticket subject line",
      "body": "string — the customer's opening message",
      "status": "one of: ${TICKET_STATUSES.join(' | ')}",
      "from": { "name": "string — customer full name", "email": "string — customer email (NOT on ${STAFF_EMAIL_DOMAIN})" },
      "responses": [
        { "body": "string — reply text", "from": { "name": "string", "email": "string" } }
      ]
    }
  ]
}`

const DELIMITER = '═'.repeat(60)

/**
 * The static half of the staff section (identical across every batch): whether staff replies
 * are enabled, the roster, and — when no per-ticket targets are supplied — the average
 * directive. Per-ticket targets vary per batch and live in the dynamic suffix instead.
 */
function staffStaticSection(staff: CompilePromptInput['staff']): string {
  if (!staff.include) {
    return [
      'STAFF RESPONSES: DISABLED.',
      '- Do NOT include any staff replies.',
      '- Every ticket\'s "responses" array MUST be empty ([]).'
    ].join('\n')
  }

  const roster = staff.roster
    .filter((m) => (m.name?.trim() || m.alias?.trim() || '').length > 0)
    .map((m) => `  - ${m.name || m.alias} <${staffEmail(m)}>`)
    .join('\n')

  const lines = [
    'STAFF RESPONSES: ENABLED.',
    `- All staff replies MUST be authored by a roster member, using their @${STAFF_EMAIL_DOMAIN} email.`,
    `- The opening message and any customer follow-ups must NOT use a @${STAFF_EMAIL_DOMAIN} email.`,
    '',
    'Staff roster:',
    roster || '  (none provided)'
  ]
  // When per-ticket targets aren't provided (e.g. the preview), fall back to the average.
  if (!staff.responseCounts) {
    lines.push(
      '',
      `Average staff responses per ticket: ~${staff.avgResponses}. Vary naturally — some tickets have 0, others several.`
    )
  }
  return lines.join('\n')
}

/** Static prefix: the user's editable text + app requirements that never change per batch. */
function staticPrefix(input: CompilePromptInput): string {
  const editable = (input.editablePrompt ?? '').trim()
  const requirements = [
    DELIMITER,
    'OUTPUT REQUIREMENTS (enforced by the app — follow exactly)',
    DELIMITER,
    'A. Return ONLY a single JSON object — no prose, no markdown fences — of this shape:',
    '',
    OUTPUT_SHAPE,
    '',
    `B. "status" MUST be one of: ${TICKET_STATUSES.join(', ')}.`,
    'C. Do NOT include an "id" field — the app assigns ids.',
    'D. Make every ticket distinct (subject, customer, and details).',
    '',
    staffStaticSection(input.staff),
    DELIMITER
  ].join('\n')
  return editable ? `${editable}\n\n${requirements}` : requirements
}

/** Dynamic suffix: the small per-batch instructions (count + per-ticket response targets). */
function dynamicSuffix(input: CompilePromptInput): string {
  const lines = [
    DELIMITER,
    'THIS BATCH',
    DELIMITER,
    `Produce EXACTLY ${input.batchCount} unique ticket(s) in this batch.`
  ]
  if (input.staff.include && input.staff.responseCounts) {
    lines.push(
      'Target number of staff responses per ticket, in order (match as closely as possible):',
      `  [${input.staff.responseCounts.join(', ')}]`
    )
  }
  return lines.join('\n')
}

/**
 * Compose the prompt as a static prefix (identical across batches — cacheable) plus a small
 * dynamic suffix (this batch's count + per-ticket response targets). Providers that support
 * prompt caching reuse the prefix; everything else concatenates the two.
 */
export function compilePromptParts(input: CompilePromptInput): { static: string; dynamic: string } {
  return { static: staticPrefix(input), dynamic: dynamicSuffix(input) }
}

/**
 * Compose the final prompt string: the user's editable text + app-enforced requirements +
 * this batch's instructions, clearly delimited. Pure and deterministic — used for the in-app
 * preview and for each generation batch.
 */
export function compilePrompt(input: CompilePromptInput): string {
  const { static: prefix, dynamic } = compilePromptParts(input)
  return `${prefix}\n\n${dynamic}`
}

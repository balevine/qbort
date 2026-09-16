import type { StaffMember } from './types'
import { TICKET_STATUSES } from './types'
import { staffEmail, STAFF_EMAIL_DOMAIN } from './staff'

export interface CompilePromptInput {
  /** The user's editable creative/distribution prompt. */
  editablePrompt: string
  /** How many tickets this batch should produce. */
  batchCount: number
  /**
   * One-line scenarios dealt to this batch by the orchestrator (scenario i → ticket i). Omit
   * (or pass empty) to leave the batch's topics to the model.
   */
  scenarios?: string[]
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
        { "body": "string — staff reply to this customer, same conversation", "from": { "name": "string — staff member's name", "email": "string — staff member's @${STAFF_EMAIL_DOMAIN} email" } }
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
    `- Each ticket's "responses" is the reply thread for THAT ONE ticket: staff replying to the`,
    `  SAME customer about the SAME issue, in order. A ticket is one conversation — never fill`,
    `  "responses" with unrelated issues, new complaints, or messages from other customers.`,
    `- Every staff reply MUST be authored by a roster member below, using their @${STAFF_EMAIL_DOMAIN} email.`,
    `- The only non-staff message allowed in a thread is the SAME customer (the opener's exact name`,
    `  and email) following up — never introduce a different customer inside "responses".`,
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
  // Scenarios are dealt by the orchestrator so that independent batches cannot converge on the
  // same high-probability topics. They belong in the dynamic suffix: the static prefix is sent as
  // a cached block (see anthropic.ts), and per-batch text there would break prompt caching.
  const scenarios = input.scenarios ?? []
  if (scenarios.length > 0) {
    lines.push(
      'Ticket scenarios, in order — ticket 1 uses scenario 1, ticket 2 uses scenario 2, and so on:',
      ...scenarios.map((s, i) => `  ${i + 1}. ${s}`),
      'Expand each scenario into a full ticket in its own voice. Do not copy its wording, and do not',
      'write about anything else.'
    )
    if (scenarios.length < input.batchCount) {
      lines.push(
        `The remaining ${input.batchCount - scenarios.length} ticket(s) have no scenario — invent them,`,
        'keeping them clearly distinct from the ones above.'
      )
    }
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

/**
 * How many scenarios to ask for when generating `count` tickets. The surplus is the reserve that
 * top-up rounds draw from, so a re-generated ticket gets a fresh scenario rather than a repeat.
 */
export function scenarioTarget(count: number): number {
  return Math.max(count + 3, Math.ceil(count * 1.3))
}

/**
 * The one-shot call that produces the whole scenario list. Asking for more one-liners than the
 * user's prompt has examples forces invention, and generating them in a single call lets the model
 * see the whole list while writing it — the same thing that keeps within-batch tickets distinct.
 */
export function compileScenarioPrompt(editablePrompt: string, count: number): string {
  const editable = (editablePrompt ?? '').trim()
  const requirements = [
    DELIMITER,
    'OUTPUT REQUIREMENTS (enforced by the app — follow exactly)',
    DELIMITER,
    `Produce EXACTLY ${count} one-line ticket scenarios, numbered 1 to ${count}.`,
    'Follow the category mix described above (if one is described).',
    'Any examples above are illustrative and are already covered. Do not reuse them.',
    'Make each scenario distinct in what it is about AND in who is writing it.',
    'Return ONLY a JSON object — no prose, no markdown fences — of this shape:',
    '',
    '{ "scenarios": ["...", "...", ...] }',
    DELIMITER
  ].join('\n')
  return editable ? `${editable}\n\n${requirements}` : requirements
}

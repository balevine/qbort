// Ported from src/shared/promptCompiler.ts. Composes the user's TICKET_PROMPT.md (the creative
// / distribution half) with the app-enforced output requirements (schema, roster, per-batch
// response targets, allowed statuses). The user's text is never overridden — requirements are
// appended and clearly delimited.

import { TICKET_STATUSES, STAFF_EMAIL_DOMAIN } from './constants.mjs'
import { staffEmail } from './staff.mjs'

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

/** The static half of the staff section (identical across every batch). */
function staffStaticSection(staff) {
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
  if (!staff.responseCounts) {
    lines.push(
      '',
      `Average staff responses per ticket: ~${staff.avgResponses}. Vary naturally — some tickets have 0, others several.`
    )
  }
  return lines.join('\n')
}

/** Static prefix: the user's editable text + app requirements that never change per batch. */
function staticPrefix(input) {
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
function dynamicSuffix(input) {
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
  // Scenarios are dealt by the engine so that independent batches cannot converge on the same
  // high-probability topics. They live in the dynamic suffix on purpose (the static prefix is
  // prompt-cached in the desktop app, and both ports must stay aligned).
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

/** Compose the prompt as a static prefix (identical across batches) plus a per-batch suffix. */
export function compilePromptParts(input) {
  return { static: staticPrefix(input), dynamic: dynamicSuffix(input) }
}

/**
 * How many scenarios to ask for when generating `count` tickets. The surplus is the reserve that
 * top-up rounds draw from, so a re-generated ticket gets a fresh scenario rather than a repeat.
 */
export function scenarioTarget(count) {
  return Math.max(count + 3, Math.ceil(count * 1.3))
}

/**
 * The one-shot call that produces the whole scenario list. Asking for more one-liners than the
 * user's prompt has examples forces invention, and generating them in a single call lets the model
 * see the whole list while writing it — the same thing that keeps within-batch tickets distinct.
 */
export function compileScenarioPrompt(editablePrompt, count) {
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

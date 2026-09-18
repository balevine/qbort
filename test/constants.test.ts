import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_TICKET_STATUS,
  MAX_RESPONSES_PER_TICKET,
  MAX_TOPUP_ROUNDS,
  STAFF_EMAIL_DOMAIN,
  TICKET_STATUSES
} from '@lib/constants.mjs'
import { OUTPUT_SHAPE } from '@lib/promptCompiler.mjs'
import { repairTicket } from '@lib/validate.mjs'

// The run's fixed values. They are worth testing only where a wrong value would be silently
// absorbed, which means the status set, since the prompt and the validator both read it.

describe('TICKET_STATUSES', () => {
  it('contains the default status, so a coerced ticket is always valid', () => {
    expect(TICKET_STATUSES).toContain(DEFAULT_TICKET_STATUS)
  })

  it('has no duplicates', () => {
    expect(new Set(TICKET_STATUSES).size).toBe(TICKET_STATUSES.length)
  })

  it('is the same set the prompt advertises and the validator accepts', () => {
    for (const status of TICKET_STATUSES) {
      expect(OUTPUT_SHAPE).toContain(status)
      expect(repairTicket({ body: 'b', from: { email: 'c@x.example' }, status }, { includeStaffResponses: false })!.status).toBe(status)
    }
  })
})

describe('numeric constants', () => {
  it('are positive integers', () => {
    for (const n of [MAX_RESPONSES_PER_TICKET, DEFAULT_BATCH_SIZE, MAX_TOPUP_ROUNDS]) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
    }
  })
})

describe('STAFF_EMAIL_DOMAIN', () => {
  it('is a bare domain, since it is concatenated after an @', () => {
    expect(STAFF_EMAIL_DOMAIN).not.toContain('@')
    expect(STAFF_EMAIL_DOMAIN).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
  })
})

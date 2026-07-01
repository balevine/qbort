import { describe, expect, it } from 'vitest'
import { errorFromResponse, extractJson, maxTokensFor } from './common'

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"tickets":[]}')).toEqual({ tickets: [] })
  })

  it('strips ```json fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('recovers JSON embedded in surrounding prose', () => {
    expect(extractJson('Here you go: {"a":1} — done')).toEqual({ a: 1 })
  })

  it('throws on empty or non-JSON output', () => {
    expect(() => extractJson('')).toThrow()
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('maxTokensFor', () => {
  it('scales with count and clamps', () => {
    expect(maxTokensFor(1)).toBeGreaterThanOrEqual(1024)
    expect(maxTokensFor(1000)).toBeLessThanOrEqual(16_000)
    expect(maxTokensFor(20)).toBeGreaterThan(maxTokensFor(5))
  })
})

describe('errorFromResponse', () => {
  it('marks 429 and 5xx as retryable, 4xx as not', async () => {
    const e429 = await errorFromResponse('anthropic', new Response('rate', { status: 429 }))
    expect(e429.retryable).toBe(true)
    expect(e429.status).toBe(429)

    const e503 = await errorFromResponse('anthropic', new Response('busy', { status: 503 }))
    expect(e503.retryable).toBe(true)

    const e401 = await errorFromResponse('anthropic', new Response('nope', { status: 401 }))
    expect(e401.retryable).toBe(false)
  })
})

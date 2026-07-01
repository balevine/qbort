import type { ProviderId } from '@shared/types'
import { isRetryableStatus, ProviderError } from './types'

/** Stable system instruction (cacheable). Per-batch detail lives in the compiled prompt. */
export const SYSTEM_PROMPT =
  'You are an expert at generating realistic, diverse, fictional customer support tickets. ' +
  'Always respond with a single valid JSON object matching the requested shape, and nothing else — no prose, no markdown fences.'

/** Higher temperature for variety across tickets. */
export const TEMPERATURE = 0.8

/** Size the output token budget to the batch (rough heuristic, clamped). */
export function maxTokensFor(count: number): number {
  return Math.min(16_000, Math.max(1024, count * 600 + 512))
}

/** The preferred output-token budget for a call: caller-supplied, else the per-count heuristic. */
export function resolveMaxTokens(args: { maxOutputTokens?: number; count: number }): number {
  return args.maxOutputTokens ?? maxTokensFor(args.count)
}

/**
 * POST a JSON body and return the parsed JSON response. Throws a `ProviderError` (with a body
 * snippet + retryable flag) on a non-OK status. Shared by the non-streaming hosted adapters.
 */
export async function postJson(
  provider: ProviderId,
  url: string,
  init: { headers?: Record<string, string>; body: unknown; signal?: AbortSignal }
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: JSON.stringify(init.body),
    signal: init.signal
  })
  if (!res.ok) throw await errorFromResponse(provider, res)
  return res.json()
}

/**
 * Robustly pull a JSON value out of model text: try direct parse, strip ```fences```, then
 * fall back to the first `{`…last `}` slice. Throws if nothing parses.
 */
export function extractJson(text: string): unknown {
  const trimmed = (text ?? '').trim()
  if (!trimmed) throw new Error('Model returned empty output')

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced ? fenced[1] : trimmed

  try {
    return JSON.parse(candidate)
  } catch {
    /* fall through */
  }

  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      /* fall through */
    }
  }
  throw new Error('Model did not return valid JSON')
}

/** Build a ProviderError from a non-OK fetch Response, capturing a short body snippet. */
export async function errorFromResponse(provider: ProviderId, res: Response): Promise<ProviderError> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    /* ignore */
  }
  const message = `${provider} responded ${res.status}${detail ? `: ${detail}` : ''}`
  return new ProviderError(message, provider, res.status, isRetryableStatus(res.status))
}

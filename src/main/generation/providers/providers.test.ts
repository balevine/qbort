import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from './anthropic'
import { OllamaProvider } from './ollama'
import { createProvider } from './index'
import { ProviderError, TruncationError } from './types'
import { DEFAULT_SETTINGS } from '@shared/settings'

afterEach(() => vi.unstubAllGlobals())

let lastCall: { url: string; init?: RequestInit }
function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      lastCall = { url, init }
      return impl(url, init)
    })
  )
}
const body = () => JSON.parse(String(lastCall.init?.body))
const args = { compiledPrompt: 'PROMPT', count: 3 }

describe('AnthropicProvider', () => {
  it('sends the model + cached system block and parses content/usage', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '{"tickets":[{"subject":"x"}]}' }],
            usage: { input_tokens: 100, output_tokens: 250 }
          }),
          { status: 200 }
        )
    )
    const result = await new AnthropicProvider('sk-x', 'claude-sonnet-5').generateBatch(args)
    expect(lastCall.url).toContain('api.anthropic.com')
    expect(lastCall.init?.headers).toMatchObject({ 'x-api-key': 'sk-x', 'anthropic-version': '2023-06-01' })
    expect(body().model).toBe('claude-sonnet-5')
    expect(body().system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(result.raw).toEqual({ tickets: [{ subject: 'x' }] })
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 250 })
  })

  it('throws a retryable ProviderError on 429', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }))
    await expect(new AnthropicProvider('k', 'm').generateBatch(args)).rejects.toMatchObject({
      retryable: true,
      status: 429
    })
  })

  it('throws a retryable TruncationError when the model stops at max_tokens', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '{"tickets":[{"subject":"x"' }], // truncated JSON
            stop_reason: 'max_tokens',
            usage: { input_tokens: 100, output_tokens: 4000 }
          }),
          { status: 200 }
        )
    )
    const err = await new AnthropicProvider('k', 'm').generateBatch(args).catch((e) => e)
    expect(err).toBeInstanceOf(TruncationError)
    expect(err.retryable).toBe(true)
  })
})

describe('OllamaProvider', () => {
  it('calls /api/chat with streaming JSON + a constrained context, parsing usage', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            message: { content: '{"tickets":[]}' },
            prompt_eval_count: 30,
            eval_count: 40
          }),
          { status: 200 }
        )
    )
    const result = await new OllamaProvider('http://localhost:11434/', 'llama3.1').generateBatch(args)
    expect(lastCall.url).toBe('http://localhost:11434/api/chat')
    expect(body().format).toBe('json')
    expect(body().stream).toBe(true)
    expect(body().options.num_ctx).toBeGreaterThanOrEqual(8192)
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 40 })
  })

  it('streams NDJSON, reports live tokens via onToken, and uses the final usage counts', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '{"tic' } }),
      JSON.stringify({ message: { content: 'kets":[]}' } }),
      JSON.stringify({ done: true, prompt_eval_count: 12, eval_count: 7 })
    ].join('\n')
    stubFetch(() => new Response(ndjson, { status: 200 }))

    const tokenTicks: number[] = []
    const result = await new OllamaProvider('http://localhost:11434', 'm').generateBatch({
      compiledPrompt: 'p',
      count: 2,
      onToken: ({ outputTokens }) => tokenTicks.push(outputTokens)
    })

    expect(tokenTicks).toEqual([1, 2])
    expect(result.raw).toEqual({ tickets: [] })
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 })
  })

  it('skips a malformed NDJSON line instead of dropping the whole batch', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '{"tickets"' } }),
      'not-json-at-all', // proxy noise / partial frame — must be tolerated
      JSON.stringify({ message: { content: ':[]}' } }),
      JSON.stringify({ done: true, prompt_eval_count: 9, eval_count: 3 })
    ].join('\n')
    stubFetch(() => new Response(ndjson, { status: 200 }))

    const result = await new OllamaProvider('http://localhost:11434', 'm').generateBatch({ compiledPrompt: 'p', count: 1 })
    expect(result.raw).toEqual({ tickets: [] })
    expect(result.usage).toEqual({ inputTokens: 9, outputTokens: 3 })
  })

  it('surfaces an error field on a 200 stream as a ProviderError', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'model not found' }), { status: 200 }))
    await expect(new OllamaProvider('http://localhost:11434', 'm').generateBatch({ compiledPrompt: 'p', count: 1 })).rejects.toBeInstanceOf(ProviderError)
  })

  it('throws a TruncationError when the stream stops at the output-token limit', async () => {
    const ndjson = [
      JSON.stringify({ message: { content: '{"tickets":[{"subject":"x"' } }),
      JSON.stringify({ done: true, done_reason: 'length', prompt_eval_count: 10, eval_count: 4000 })
    ].join('\n')
    stubFetch(() => new Response(ndjson, { status: 200 }))
    await expect(new OllamaProvider('http://localhost:11434', 'm').generateBatch({ compiledPrompt: 'p', count: 5 })).rejects.toBeInstanceOf(TruncationError)
  })
})

describe('createProvider', () => {
  const noKey = () => Promise.resolve(null)
  const someKey = () => Promise.resolve('a-key')

  it('builds an Ollama provider from settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, providerId: 'ollama' as const, ollama: { host: 'http://localhost:11434', model: 'llama3.1' } }
    const provider = await createProvider(settings, noKey)
    expect(provider.id).toBe('ollama')
    expect(provider.model).toBe('llama3.1')
  })

  it('throws when Ollama has no model selected', async () => {
    const settings = { ...DEFAULT_SETTINGS, providerId: 'ollama' as const, ollama: { host: 'h', model: '' } }
    await expect(createProvider(settings, noKey)).rejects.toBeInstanceOf(ProviderError)
  })

  it('builds a hosted provider with the curated model and requires a key', async () => {
    const settings = { ...DEFAULT_SETTINGS, providerId: 'anthropic' as const }
    const provider = await createProvider(settings, someKey)
    expect(provider.id).toBe('anthropic')
    expect(provider.model).toBe('claude-sonnet-5')

    await expect(createProvider(settings, noKey)).rejects.toMatchObject({ provider: 'anthropic' })
  })
})

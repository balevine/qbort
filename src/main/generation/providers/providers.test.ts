import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { GeminiProvider } from './gemini'
import { OllamaProvider } from './ollama'
import { createProvider } from './index'
import { ProviderError } from './types'
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
    const result = await new AnthropicProvider('sk-x', 'claude-sonnet-4-6').generateBatch(args)
    expect(lastCall.url).toContain('api.anthropic.com')
    expect(lastCall.init?.headers).toMatchObject({ 'x-api-key': 'sk-x', 'anthropic-version': '2023-06-01' })
    expect(body().model).toBe('claude-sonnet-4-6')
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
})

describe('OpenAIProvider', () => {
  it('uses json_object response format and parses choices/usage', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"tickets":[]}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20 }
          }),
          { status: 200 }
        )
    )
    const result = await new OpenAIProvider('sk-o', 'gpt-4.1-mini').generateBatch(args)
    expect(lastCall.url).toContain('api.openai.com')
    expect(lastCall.init?.headers).toMatchObject({ Authorization: 'Bearer sk-o' })
    expect(body().response_format).toEqual({ type: 'json_object' })
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 })
  })
})

describe('GeminiProvider', () => {
  it('puts the model + key in the URL and parses candidates/usage', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"tickets":[]}' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 }
          }),
          { status: 200 }
        )
    )
    const result = await new GeminiProvider('g-key', 'gemini-2.5-flash').generateBatch(args)
    expect(lastCall.url).toContain('models/gemini-2.5-flash:generateContent')
    expect(lastCall.url).toContain('key=g-key')
    expect(body().generationConfig.responseMimeType).toBe('application/json')
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 8 })
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
    expect(provider.model).toBe('claude-sonnet-4-6')

    await expect(createProvider(settings, noKey)).rejects.toMatchObject({ provider: 'anthropic' })
  })
})

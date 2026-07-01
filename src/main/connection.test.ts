import { afterEach, describe, expect, it, vi } from 'vitest'
import { listOllamaModels, normalizeHost, testConnection } from './connection'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('normalizeHost', () => {
  it('strips trailing slashes and defaults when empty', () => {
    expect(normalizeHost('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeHost('')).toBe('http://localhost:11434')
  })
})

describe('listOllamaModels', () => {
  it('returns sorted, de-duplicated model names', async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({ models: [{ name: 'llama3.1' }, { name: 'qwen2.5' }, { name: 'llama3.1' }] }),
        { status: 200 }
      )
    )
    expect(await listOllamaModels('http://localhost:11434')).toEqual(['llama3.1', 'qwen2.5'])
  })

  it('throws on a non-OK response', async () => {
    stubFetch(() => new Response('nope', { status: 500 }))
    await expect(listOllamaModels('http://localhost:11434')).rejects.toThrow(/500/)
  })
})

describe('testConnection', () => {
  const getKey = (key: string | null) => () => Promise.resolve(key)

  it('reports success for Ollama with installed models', async () => {
    stubFetch(() => new Response(JSON.stringify({ models: [{ name: 'llama3.1' }] }), { status: 200 }))
    const res = await testConnection('ollama', { host: 'http://localhost:11434', getKey: getKey(null) })
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/1 model/)
  })

  it('fails a hosted provider when no key is saved', async () => {
    const res = await testConnection('anthropic', { getKey: getKey(null) })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/no api key/i)
  })

  it('reports unauthorized on a 401 from a hosted provider', async () => {
    stubFetch(() => new Response('unauthorized', { status: 401 }))
    const res = await testConnection('anthropic', { getKey: getKey('bad-key') })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/unauthorized/i)
  })

  it('reports success on a 200 from a hosted provider', async () => {
    stubFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const res = await testConnection('anthropic', { getKey: getKey('good-key') })
    expect(res.ok).toBe(true)
  })
})

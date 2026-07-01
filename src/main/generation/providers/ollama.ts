import type { GenerateBatchArgs, GenerateBatchResult, LLMProvider } from './types'
import { SYSTEM_PROMPT, TEMPERATURE, errorFromResponse, extractJson, resolveMaxTokens } from './common'
import { normalizeHost } from '../../connection'

/**
 * Context window to request from Ollama. Many models default to a huge context (e.g. 256k),
 * which makes the model load slowly and consume far more memory than we need. We size the
 * window to the prompt + expected output (+ margin), clamped to a sane range.
 */
function contextSize(compiledPrompt: string, outputBudget: number): number {
  const promptTokens = Math.ceil(compiledPrompt.length / 4)
  return Math.min(32_768, Math.max(8192, promptTokens + outputBudget + 2048))
}

interface OllamaChatChunk {
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
  done?: boolean
}

/** Local Ollama server via /api/chat. Streams NDJSON so we can report live token progress. */
export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama' as const
  private readonly base: string

  constructor(
    host: string,
    readonly model: string
  ) {
    this.base = normalizeHost(host)
  }

  async generateBatch({
    compiledPrompt,
    count,
    maxOutputTokens,
    signal,
    onToken
  }: GenerateBatchArgs): Promise<GenerateBatchResult> {
    const outputBudget = resolveMaxTokens({ maxOutputTokens, count })
    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        format: 'json',
        // Keep the model resident between batches/runs so it isn't reloaded each time.
        keep_alive: '30m',
        options: {
          temperature: TEMPERATURE,
          num_ctx: contextSize(compiledPrompt, outputBudget),
          num_predict: outputBudget
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: compiledPrompt }
        ]
      }),
      signal
    })

    if (!res.ok) throw await errorFromResponse('ollama', res)

    let content = ''
    let promptTokens = 0
    let outputTokens = 0
    let chunks = 0

    const handle = (chunk: OllamaChatChunk) => {
      const piece = chunk.message?.content
      if (piece) {
        content += piece
        chunks++
        onToken?.({ outputTokens: chunks })
      }
      if (typeof chunk.prompt_eval_count === 'number') promptTokens = chunk.prompt_eval_count
      if (typeof chunk.eval_count === 'number') outputTokens = chunk.eval_count
    }

    // Stream NDJSON line-by-line. Fall back to a buffered read if the body isn't streamable.
    const body = res.body as ReadableStream<Uint8Array> | null
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (line) handle(JSON.parse(line) as OllamaChatChunk)
        }
        if (done) break
      }
      const tail = buffer.trim()
      if (tail) handle(JSON.parse(tail) as OllamaChatChunk)
    } else {
      const text = await res.text()
      for (const line of text.split('\n')) {
        const l = line.trim()
        if (l) handle(JSON.parse(l) as OllamaChatChunk)
      }
    }

    return {
      raw: extractJson(content),
      usage: { inputTokens: promptTokens, outputTokens: outputTokens || chunks }
    }
  }
}

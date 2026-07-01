import { TruncationError, type GenerateBatchArgs, type GenerateBatchResult, type LLMProvider } from './types'
import { SYSTEM_PROMPT, TEMPERATURE, extractJson, postJson, resolveMaxTokens } from './common'

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
  /** `max_tokens` here means the model was cut off mid-output — the JSON will be truncated. */
  stop_reason?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * Anthropic Messages API. JSON is enforced via the prompt. The static prefix of the compiled
 * prompt (schema + roster, identical across batches) is sent as a cached content block so the
 * bulk of the input isn't re-billed on every batch; only the small dynamic suffix varies.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const

  constructor(
    private readonly apiKey: string,
    readonly model: string
  ) {}

  async generateBatch(args: GenerateBatchArgs): Promise<GenerateBatchResult> {
    const { compiledPrompt, staticPrefix, dynamicSuffix, signal } = args
    // Cache the large static prefix; keep the per-batch suffix uncached after it.
    const userContent =
      staticPrefix && dynamicSuffix !== undefined
        ? [
            { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: dynamicSuffix }
          ]
        : compiledPrompt

    const data = (await postJson('anthropic', 'https://api.anthropic.com/v1/messages', {
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: this.model,
        max_tokens: resolveMaxTokens(args),
        temperature: TEMPERATURE,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }]
      },
      signal
    })) as AnthropicResponse
    // A cut-off response yields unparseable JSON; surface it as retryable so the orchestrator can
    // grow the token budget or split the batch rather than dropping it after a doomed JSON parse.
    if (data.stop_reason === 'max_tokens') throw new TruncationError('anthropic')
    const text = (data.content ?? []).map((b) => b.text ?? '').join('')
    const u = data.usage ?? {}
    // With caching, cached tokens are reported separately from `input_tokens`; sum them all
    // so the usage total reflects every input token processed.
    const inputTokens =
      (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    return {
      raw: extractJson(text),
      usage: { inputTokens, outputTokens: u.output_tokens ?? 0 }
    }
  }
}

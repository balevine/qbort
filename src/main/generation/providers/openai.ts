import type { GenerateBatchArgs, GenerateBatchResult, LLMProvider } from './types'
import { SYSTEM_PROMPT, TEMPERATURE, extractJson, postJson, resolveMaxTokens } from './common'

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** OpenAI Chat Completions API with JSON-object response format. */
export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai' as const

  constructor(
    private readonly apiKey: string,
    readonly model: string
  ) {}

  async generateBatch(args: GenerateBatchArgs): Promise<GenerateBatchResult> {
    const data = (await postJson('openai', 'https://api.openai.com/v1/chat/completions', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: {
        model: this.model,
        temperature: TEMPERATURE,
        max_tokens: resolveMaxTokens(args),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: args.compiledPrompt }
        ]
      },
      signal: args.signal
    })) as OpenAIResponse
    const text = data.choices?.[0]?.message?.content ?? ''
    return {
      raw: extractJson(text),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0
      }
    }
  }
}

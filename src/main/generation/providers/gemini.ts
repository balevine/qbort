import type { GenerateBatchArgs, GenerateBatchResult, LLMProvider } from './types'
import { SYSTEM_PROMPT, TEMPERATURE, extractJson, postJson, resolveMaxTokens } from './common'

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

/** Google Gemini generateContent API with a JSON response mime type. */
export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const

  constructor(
    private readonly apiKey: string,
    readonly model: string
  ) {}

  async generateBatch(args: GenerateBatchArgs): Promise<GenerateBatchResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`
    const data = (await postJson('gemini', url, {
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: args.compiledPrompt }] }],
        generationConfig: {
          temperature: TEMPERATURE,
          maxOutputTokens: resolveMaxTokens(args),
          responseMimeType: 'application/json'
        }
      },
      signal: args.signal
    })) as GeminiResponse
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    return {
      raw: extractJson(text),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0
      }
    }
  }
}

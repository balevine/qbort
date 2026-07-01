import type { ProviderId, Settings } from '@shared/types'
import { ProviderError, type LLMProvider } from './types'
import { getModelId } from './models'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { GeminiProvider } from './gemini'
import { OllamaProvider } from './ollama'

export * from './types'
export * from './models'

/** The model id that will be used for the given settings (hosted = curated map; ollama = chosen). */
export function modelForSettings(settings: Settings): string {
  return settings.providerId === 'ollama' ? settings.ollama.model : getModelId(settings.providerId)
}

/**
 * Build the active provider adapter. Resolves the model (curated for hosted, user-selected
 * for Ollama) and the API key (main-process only). Throws a ProviderError when misconfigured.
 */
export async function createProvider(
  settings: Settings,
  getKey: (provider: ProviderId) => Promise<string | null>
): Promise<LLMProvider> {
  const id = settings.providerId

  if (id === 'ollama') {
    if (!settings.ollama.model.trim()) {
      throw new ProviderError('No Ollama model selected. Fetch and choose a model in Settings.', 'ollama')
    }
    return new OllamaProvider(settings.ollama.host, settings.ollama.model)
  }

  const key = await getKey(id)
  if (!key) throw new ProviderError(`No API key saved for ${id}. Add one in Settings.`, id)

  const model = getModelId(id)
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(key, model)
    case 'openai':
      return new OpenAIProvider(key, model)
    case 'gemini':
      return new GeminiProvider(key, model)
    default:
      throw new ProviderError(`Unsupported provider: ${id}`, id)
  }
}

/**
 * Decides which provider-specific settings (API keys, base URLs, model names, speaker voices)
 * the AI settings page should show.
 *
 * The page used to list every provider's fields at once: four API keys, two base URLs, and a
 * model/speaker block per provider, regardless of which providers were actually selected. A
 * user on Gemini still saw OPENAI_API_KEY, CGU_AIR_BASE_URL, the OpenRouter TTS speakers, and
 * the whole audio.cpp section. Now a provider's fields appear only while it is picked in one of
 * the four provider selects (primary/secondary LLM, primary/secondary TTS).
 *
 * Credentials (key + base URL) are shared by a provider's LLM and TTS roles, so they show when
 * the provider is used in *any* role; model/speaker fields are role-specific.
 *
 * `showAll` is the escape hatch: it reveals everything, e.g. to fill in a key before switching
 * to that provider, or to set OPENAI_API_KEY for semantic search (embeddings always use OpenAI,
 * independent of the selected LLM provider).
 */
export interface ProviderSelection {
  llmProvider: string;
  ttsProvider: string;
  /** '' when no secondary provider is configured. */
  secondaryLlmProvider: string;
  /** '' when no secondary provider is configured. */
  secondaryTtsProvider: string;
  /** '' = images follow the LLM provider; otherwise the pinned image provider ('openai' | 'gemini' | 'qwen'). */
  imageProvider?: string;
  showAll?: boolean;
}

export interface ProviderFieldVisibility {
  /** API key / base URL fields for this provider. */
  credentials(provider: string): boolean;
  /** LLM model (and image model) fields for this provider. */
  llm(provider: string): boolean;
  /** TTS model / speaker / engine fields for this provider. */
  tts(provider: string): boolean;
  /**
   * Image model fields for this provider: the pinned image provider's, or — when images follow
   * the LLM provider — those of the providers picked for the LLM roles.
   */
  image(provider: string): boolean;
}

export function providerFieldVisibility(selection: ProviderSelection): ProviderFieldVisibility {
  const showAll = selection.showAll === true;
  const llm = new Set([selection.llmProvider, selection.secondaryLlmProvider].filter(Boolean));
  const tts = new Set([selection.ttsProvider, selection.secondaryTtsProvider].filter(Boolean));
  const pinnedImage = selection.imageProvider ?? '';
  // A pinned image provider needs its credentials too (Qwen has no other role that could reveal its key).
  const image = (provider: string) => (pinnedImage ? pinnedImage === provider : llm.has(provider));
  return {
    credentials: (provider) => showAll || llm.has(provider) || tts.has(provider) || (pinnedImage !== '' && pinnedImage === provider),
    llm: (provider) => showAll || llm.has(provider),
    tts: (provider) => showAll || tts.has(provider),
    image: (provider) => showAll || image(provider),
  };
}

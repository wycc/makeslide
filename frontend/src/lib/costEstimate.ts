/**
 * Generation cost estimation helper.
 *
 * Pure functions only — no side effects, no API calls — so they are easy to
 * unit-test. Prices are best-effort approximations for informational display
 * only; actual charges depend on the upstream provider's current rate card.
 */

/** TTS cost in USD per 1 000 characters. */
export const TTS_PRICE_PER_1K_CHARS: Record<string, number> = {
  openai: 0.015,   // OpenAI TTS-1: $15 / 1M chars
  gemini: 0.0004,  // Gemini TTS via Live API: rough estimate ~$0.4 / 1M chars
};

/**
 * LLM input/output price in USD per 1M tokens.
 * Mirrors the backend's MODEL_PRICE_PER_1M_TOKENS in services/llmUsage.ts.
 */
export const LLM_PRICE_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':         { input: 0.15,   output: 0.6  },
  'gpt-4o':              { input: 2.5,    output: 10   },
  'gemini-2.0-flash':    { input: 0.075,  output: 0.3  },
  'gemini-2.0-flash-lite': { input: 0.0375, output: 0.15 },
  'gemini-1.5-flash':    { input: 0.075,  output: 0.3  },
  'gemini-1.5-pro':      { input: 1.25,   output: 5.0  },
};

/** Fallback LLM price when the model name is unknown. */
const FALLBACK_LLM_PRICE = { input: 0.15, output: 0.6 };

export interface CostEstimateParams {
  /** Number of slides / pages to generate. */
  pageCount: number;
  /** Maximum characters per page script (scriptMaxCharsPerPage). */
  charsPerPage: number;
  /** TTS provider identifier, e.g. 'openai' | 'gemini'. */
  ttsProvider: string;
  /** LLM model name used for script generation. */
  llmModel: string;
}

export interface CostEstimateResult {
  /** Estimated LLM cost in USD. */
  llmCostUsd: number;
  /** Estimated TTS cost in USD. */
  ttsCostUsd: number;
  /** Total estimated cost in USD (llm + tts). */
  totalCostUsd: number;
}

/**
 * Estimate the USD cost of generating a presentation.
 *
 * LLM model is called once per page; each call sends ~1 000 input tokens
 * (page context + system prompt) and produces ~charsPerPage/3 output tokens.
 * TTS synthesises pageCount × charsPerPage characters.
 */
export function estimateGenerationCost(params: CostEstimateParams): CostEstimateResult {
  const { pageCount, charsPerPage, ttsProvider, llmModel } = params;
  if (pageCount <= 0 || charsPerPage <= 0) {
    return { llmCostUsd: 0, ttsCostUsd: 0, totalCostUsd: 0 };
  }

  const llmPrice = LLM_PRICE_PER_1M_TOKENS[llmModel] ?? FALLBACK_LLM_PRICE;
  const llmInputTokens = pageCount * 1000;
  const llmOutputTokens = pageCount * (charsPerPage / 3);
  const llmCostUsd =
    (llmInputTokens / 1_000_000) * llmPrice.input +
    (llmOutputTokens / 1_000_000) * llmPrice.output;

  const ttsPrice = TTS_PRICE_PER_1K_CHARS[ttsProvider] ?? TTS_PRICE_PER_1K_CHARS['openai']!;
  const ttsTotalChars = pageCount * charsPerPage;
  const ttsCostUsd = (ttsTotalChars / 1000) * ttsPrice;

  const totalCostUsd = llmCostUsd + ttsCostUsd;
  return { llmCostUsd, ttsCostUsd, totalCostUsd };
}

export interface CostTier {
  /** Tier identifier; PromptModal maps it to the `promptModal.costEstimate.tier<Name>`(`Desc`) labels. */
  name: 'cheap' | 'balanced' | 'quality';
  charsPerPage: number;
}

/** Three preset tiers ordered from cheapest to highest quality. */
export const COST_TIERS: CostTier[] = [
  { name: 'cheap',    charsPerPage: 80  },
  { name: 'balanced', charsPerPage: 150 },
  { name: 'quality',  charsPerPage: 250 },
];

/** Format a USD amount as a human-readable string, e.g. "$0.023". */
export function formatUsd(usd: number): string {
  if (usd < 0.001) return '< $0.001';
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  if (usd < 1)     return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateGenerationCost,
  formatUsd,
  COST_TIERS,
  TTS_PRICE_PER_1K_CHARS,
} from './costEstimate.js';

describe('estimateGenerationCost', () => {
  test('returns zeros when pageCount is 0', () => {
    const result = estimateGenerationCost({ pageCount: 0, charsPerPage: 150, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' });
    assert.equal(result.llmCostUsd, 0);
    assert.equal(result.ttsCostUsd, 0);
    assert.equal(result.totalCostUsd, 0);
  });

  test('returns zeros when charsPerPage is 0', () => {
    const result = estimateGenerationCost({ pageCount: 10, charsPerPage: 0, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' });
    assert.equal(result.llmCostUsd, 0);
    assert.equal(result.ttsCostUsd, 0);
  });

  test('calculates LLM cost using known model pricing', () => {
    // 1 page, 150 chars/page, gpt-4o-mini
    // llmInput = 1 * 1000 = 1000 tokens → cost = 1000/1M * 0.15 = 0.00015
    // llmOutput = 1 * (150/3) = 50 tokens → cost = 50/1M * 0.6 = 0.00003
    const result = estimateGenerationCost({ pageCount: 1, charsPerPage: 150, ttsProvider: 'gemini', llmModel: 'gpt-4o-mini' });
    const expected = 0.00015 + 0.00003;
    assert.ok(Math.abs(result.llmCostUsd - expected) < 1e-8, `expected ~${expected}, got ${result.llmCostUsd}`);
  });

  test('calculates TTS cost for openai provider', () => {
    // 10 pages × 150 chars = 1500 chars → 1.5 × $0.015/1k = $0.0225
    const result = estimateGenerationCost({ pageCount: 10, charsPerPage: 150, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' });
    assert.ok(Math.abs(result.ttsCostUsd - 0.0225) < 1e-8, `expected 0.0225, got ${result.ttsCostUsd}`);
  });

  test('gemini TTS is cheaper than openai TTS', () => {
    const params = { pageCount: 10, charsPerPage: 150, llmModel: 'gpt-4o-mini' };
    const openai = estimateGenerationCost({ ...params, ttsProvider: 'openai' });
    const gemini = estimateGenerationCost({ ...params, ttsProvider: 'gemini' });
    assert.ok(gemini.ttsCostUsd < openai.ttsCostUsd, 'gemini TTS should be cheaper than openai TTS');
  });

  test('higher charsPerPage yields higher cost', () => {
    const base = { pageCount: 5, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' };
    const cheap   = estimateGenerationCost({ ...base, charsPerPage: 80  });
    const quality = estimateGenerationCost({ ...base, charsPerPage: 250 });
    assert.ok(quality.totalCostUsd > cheap.totalCostUsd, 'quality tier should cost more than cheap tier');
  });

  test('gpt-4o is more expensive than gpt-4o-mini for same params', () => {
    const params = { pageCount: 5, charsPerPage: 150, ttsProvider: 'openai' };
    const mini = estimateGenerationCost({ ...params, llmModel: 'gpt-4o-mini' });
    const full = estimateGenerationCost({ ...params, llmModel: 'gpt-4o' });
    assert.ok(full.llmCostUsd > mini.llmCostUsd, 'gpt-4o should cost more than gpt-4o-mini');
  });

  test('falls back to gpt-4o-mini pricing for unknown model', () => {
    const known   = estimateGenerationCost({ pageCount: 1, charsPerPage: 150, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' });
    const unknown = estimateGenerationCost({ pageCount: 1, charsPerPage: 150, ttsProvider: 'openai', llmModel: 'unknown-model' });
    assert.ok(Math.abs(unknown.llmCostUsd - known.llmCostUsd) < 1e-10, 'unknown model should fall back to gpt-4o-mini pricing');
  });

  test('totalCostUsd equals llmCostUsd + ttsCostUsd', () => {
    const result = estimateGenerationCost({ pageCount: 5, charsPerPage: 150, ttsProvider: 'openai', llmModel: 'gpt-4o-mini' });
    assert.ok(Math.abs(result.totalCostUsd - (result.llmCostUsd + result.ttsCostUsd)) < 1e-10);
  });
});

describe('formatUsd', () => {
  test('formats very small amounts as < $0.001', () => {
    assert.equal(formatUsd(0.0001), '< $0.001');
    assert.equal(formatUsd(0), '< $0.001');
  });

  test('formats cents range with 4 decimal places', () => {
    const result = formatUsd(0.0234);
    assert.ok(result.startsWith('$0.023'), `expected $0.023x, got ${result}`);
  });

  test('formats sub-dollar with 3 decimal places', () => {
    const result = formatUsd(0.5);
    assert.ok(result.startsWith('$0.500'), `expected $0.500, got ${result}`);
  });

  test('formats dollar amounts with 2 decimal places', () => {
    assert.equal(formatUsd(1.23), '$1.23');
    assert.equal(formatUsd(10.5), '$10.50');
  });
});

describe('COST_TIERS', () => {
  test('has 3 tiers in ascending charsPerPage order', () => {
    assert.equal(COST_TIERS.length, 3);
    assert.ok(COST_TIERS[0]!.charsPerPage < COST_TIERS[1]!.charsPerPage);
    assert.ok(COST_TIERS[1]!.charsPerPage < COST_TIERS[2]!.charsPerPage);
  });

  test('includes cheap, balanced, quality tiers', () => {
    const names = COST_TIERS.map((t) => t.name);
    assert.ok(names.includes('cheap'));
    assert.ok(names.includes('balanced'));
    assert.ok(names.includes('quality'));
  });
});

describe('TTS_PRICE_PER_1K_CHARS', () => {
  test('has positive entries for openai and gemini', () => {
    assert.ok((TTS_PRICE_PER_1K_CHARS['openai'] ?? 0) > 0);
    assert.ok((TTS_PRICE_PER_1K_CHARS['gemini'] ?? 0) > 0);
  });
});

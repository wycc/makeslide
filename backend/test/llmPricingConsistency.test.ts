import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MODEL_PRICE_PER_1M_TOKENS } from '../src/services/llmUsage';

// The frontend's costEstimate.ts keeps a LLM_PRICE_PER_1M_TOKENS table that is
// explicitly documented to mirror the backend's MODEL_PRICE_PER_1M_TOKENS. They
// live in separate packages, so nothing stops them drifting and silently making
// the user-facing cost estimate disagree with backend accounting. Parse the
// frontend table from source and assert the two stay in lockstep.
function readFrontendPriceTable(): Record<string, { input: number; output: number }> {
  const srcUrl = new URL('../../frontend/src/lib/costEstimate.ts', import.meta.url);
  const src = fs.readFileSync(srcUrl, 'utf8');
  const block = src.match(/LLM_PRICE_PER_1M_TOKENS[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'could not locate LLM_PRICE_PER_1M_TOKENS in frontend costEstimate.ts');
  const table: Record<string, { input: number; output: number }> = {};
  const entryRe = /'([^']+)':\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)\s*\}/g;
  for (const m of block![1]!.matchAll(entryRe)) {
    table[m[1]!] = { input: Number(m[2]), output: Number(m[3]) };
  }
  return table;
}

test('frontend cost-estimate price table parses to a non-trivial set of models', () => {
  const frontend = readFrontendPriceTable();
  assert.ok(Object.keys(frontend).length >= 5, 'expected the frontend table to parse several models');
});

test('frontend and backend LLM price tables list the same models', () => {
  const frontend = readFrontendPriceTable();
  assert.deepEqual(
    Object.keys(frontend).sort(),
    Object.keys(MODEL_PRICE_PER_1M_TOKENS).sort(),
  );
});

test('frontend and backend agree on input/output price for every model', () => {
  const frontend = readFrontendPriceTable();
  for (const [model, price] of Object.entries(MODEL_PRICE_PER_1M_TOKENS)) {
    assert.deepEqual(frontend[model], price, `price mismatch for ${model}`);
  }
});

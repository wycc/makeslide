import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OPENAI_TTS_VOICES as BACKEND_OPENAI_TTS_VOICES } from '../src/config';

// The frontend voice pickers (frontend/src/lib/ttsVoices.ts) must list the same
// voices the backend accepts, or the picker offers a name the backend silently
// coerces to a fallback voice (GEMINI_TTS_VOICES is explicitly documented to
// "Keep in sync with backend GEMINI_VOICES"). These live in separate packages
// with no guard. Parse the lists from source and assert the value sets match.
// Order is ignored — the picker order is cosmetic; only the set is a contract.
function readQuotedList(src: string, varName: string): string[] {
  const m = src.match(new RegExp(`${varName}[^\\[]*\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `could not locate ${varName}`);
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

function readFrontendVoices(varName: string): string[] {
  const src = fs.readFileSync(new URL('../../frontend/src/lib/ttsVoices.ts', import.meta.url), 'utf8');
  return readQuotedList(src, varName);
}

function readBackendGeminiVoices(): string[] {
  const src = fs.readFileSync(new URL('../src/services/gemini.ts', import.meta.url), 'utf8');
  return readQuotedList(src, 'GEMINI_VOICES');
}

const sorted = (xs: readonly string[]) => [...xs].sort();

test('frontend voice lists parse to non-trivial sets', () => {
  assert.ok(readFrontendVoices('GEMINI_TTS_VOICES').length >= 10);
  assert.ok(readFrontendVoices('OPENAI_TTS_VOICES').length >= 5);
});

test('frontend GEMINI_TTS_VOICES matches the backend GEMINI_VOICES set', () => {
  assert.deepEqual(sorted(readFrontendVoices('GEMINI_TTS_VOICES')), sorted(readBackendGeminiVoices()));
});

test('frontend OPENAI_TTS_VOICES matches the backend OPENAI_TTS_VOICES set', () => {
  assert.deepEqual(sorted(readFrontendVoices('OPENAI_TTS_VOICES')), sorted(BACKEND_OPENAI_TTS_VOICES));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config';

// Every LLM default moved from gpt-4o-mini to gpt-5.6-luna (user request, 2026-09-18). Guard the
// defaults so a future edit to config.ts cannot silently drop one of them back. Each check is
// skipped when the environment overrides that variable (the dev `.env` may set it).

test('OpenAI defaults to gpt-5.6-luna when OPENAI_LLM_MODEL is not set', { skip: Boolean(process.env.OPENAI_LLM_MODEL) }, () => {
  assert.equal(config.openaiLlmModel, 'gpt-5.6-luna');
});

test('CGU Air defaults to gpt-5.6-luna when CGU_AIR_LLM_MODEL is not set', { skip: Boolean(process.env.CGU_AIR_LLM_MODEL) }, () => {
  assert.equal(config.cguAirLlmModel, 'gpt-5.6-luna');
});

test('OpenRouter defaults to openai/gpt-5.6-luna when OPENROUTER_LLM_MODEL is not set', { skip: Boolean(process.env.OPENROUTER_LLM_MODEL) }, () => {
  assert.equal(config.openrouterLlmModel, 'openai/gpt-5.6-luna');
});

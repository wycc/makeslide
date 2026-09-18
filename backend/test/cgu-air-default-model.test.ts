import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config';

// The CGU Air default LLM moved from gpt-4o-mini to gpt-5.6-luna (user request, 2026-09-18).
// Guard the default so a future edit to config.ts cannot silently drop it back.
test('CGU Air defaults to gpt-5.6-luna when CGU_AIR_LLM_MODEL is not set', { skip: Boolean(process.env.CGU_AIR_LLM_MODEL) }, () => {
  assert.equal(config.cguAirLlmModel, 'gpt-5.6-luna');
});

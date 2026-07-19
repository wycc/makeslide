import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from 'openai';
import { config } from '../src/config';
import { setRuntimeAiSettings } from '../src/services/aiSettings';
import { getImageClient, resolveImageProviderFailover } from '../src/services/openai';
import { setLlmUsageContext, setStickyLlmProvider } from '../src/services/llmUsage';

test('getImageClient routes images through the selected CGU Air provider + its image model', () => {
  const accountId = 'image-client-cguair-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    cguAirBaseUrl: 'https://air.example.test/v1',
    cguAirImageModel: 'cgu-image-model-x',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'cgu-air', 'image provider should follow the selected LLM provider');
  assert.equal(model, 'cgu-image-model-x');
});

test('getImageClient falls back to the OpenAI image model name when the provider image model is unset', () => {
  const accountId = 'image-client-cguair-fallback-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    cguAirBaseUrl: 'https://air.example.test/v1',
    cguAirImageModel: '',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'cgu-air');
  assert.equal(model, config.openaiImageModel, 'empty provider image model falls back to the OpenAI image model name');
});

test('getImageClient uses OpenAI + the OpenAI image model when OpenAI is selected', () => {
  const accountId = 'image-client-openai-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'openai',
    openaiApiKey: 'sk-openai-test',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'openai');
  assert.equal(model, config.openaiImageModel);
});

test('getImageClient falls back to OpenAI for Gemini, which has no OpenAI-compatible Images API', () => {
  const accountId = 'image-client-gemini-fallback-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'gemini',
    openaiApiKey: 'sk-openai-test',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'openai', 'gemini cannot generate images here, so fall back to OpenAI');
  assert.equal(model, config.openaiImageModel);
});

test('getImageClient follows the run-sticky failover provider once a run has failed over', () => {
  const accountId = 'image-client-sticky-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'openai',
    openaiApiKey: 'sk-openai-test',
    secondaryLlmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    cguAirImageModel: 'cgu-image-model-sticky',
  });
  // Reset to a clean context before and after so this test's sticky state can't leak into
  // sibling tests (setLlmUsageContext uses AsyncLocalStorage#enterWith, which — unlike #run —
  // has no automatic scoping back out once this synchronous test body returns).
  setLlmUsageContext({});
  try {
    assert.equal(getImageClient(accountId).provider, 'openai', 'no failover yet — uses the primary provider');
    setStickyLlmProvider('cgu-air');
    const { provider, model } = getImageClient(accountId);
    assert.equal(provider, 'cgu-air', 'once sticky, image generation should follow the failover choice');
    assert.equal(model, 'cgu-image-model-sticky');
  } finally {
    setLlmUsageContext({});
  }
});

test('resolveImageProviderFailover only returns a provider for a permanent error with a usable, not-yet-active secondary', () => {
  const accountId = 'image-client-failover-resolve-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'openai',
    openaiApiKey: 'sk-openai-test',
    secondaryLlmProvider: 'gemini',
    geminiApiKey: 'sk-gemini-test',
  });
  setLlmUsageContext({});
  try {
    const permanentErr = new APIError(403, { code: 'account_deactivated' }, 'nope', undefined);
    assert.equal(resolveImageProviderFailover(accountId, permanentErr), 'gemini');

    const transientErr = new APIError(500, {}, 'server error', undefined);
    assert.equal(resolveImageProviderFailover(accountId, transientErr), null, 'transient errors should not trigger failover');

    setStickyLlmProvider('gemini');
    assert.equal(
      resolveImageProviderFailover(accountId, permanentErr),
      null,
      'already on the secondary — nothing further to fail over to',
    );
  } finally {
    setLlmUsageContext({});
  }
});

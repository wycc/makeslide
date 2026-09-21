import test from 'node:test';
import assert from 'node:assert/strict';
import { APIError } from 'openai';
import { config } from '../src/config';
import { CGU_AIR_DEFAULT_IMAGE_MODEL, GEMINI_DEFAULT_IMAGE_MODEL, QWEN_DEFAULT_IMAGE_MODEL, setRuntimeAiSettings } from '../src/services/aiSettings';
import { isApiKeyMissingError } from '../src/services/apiKeyErrors';
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

test('getImageClient falls back to the CGU Air default image model when the CGU Air image model is unset', () => {
  const accountId = 'image-client-cguair-fallback-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    cguAirBaseUrl: 'https://air.example.test/v1',
    cguAirImageModel: '',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'cgu-air');
  // Not the OpenAI image model: CGU Air does not serve every OpenAI model name (it rejects
  // gpt-image-2.5-flare), so reusing OPENAI_IMAGE_MODEL broke image generation there.
  assert.equal(model, CGU_AIR_DEFAULT_IMAGE_MODEL);
  assert.equal(model, 'gpt-image-2');
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

test('getImageClient falls back to OpenAI for OpenRouter, which has no OpenAI-compatible Images API', () => {
  const accountId = 'image-client-openrouter-fallback-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'openrouter',
    openrouterApiKey: 'sk-openrouter-test',
    openrouterBaseUrl: 'https://openrouter.ai/api/v1',
    // Even with an OpenRouter image model configured, OpenRouter has no /v1/images/* endpoints,
    // so image generation/inpaint must be routed to OpenAI rather than sent to OpenRouter.
    openrouterImageModel: 'some/openrouter-image-model',
    openaiApiKey: 'sk-openai-test',
  });

  const { provider, model } = getImageClient(accountId);
  assert.equal(provider, 'openai', 'openrouter cannot serve the Images API here, so fall back to OpenAI');
  assert.equal(model, config.openaiImageModel, 'and it uses the OpenAI image model, not the OpenRouter one');
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

// ── Image provider setting (user request, 2026-09-22): OpenAI / Gemini (Nano Banana 2) / Qwen-Image ──

test('an explicit image provider pins images to that service, whatever the LLM provider is', () => {
  const accountId = 'image-client-pinned-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    geminiApiKey: 'AIza-test',
    qwenApiKey: 'sk-qwen-test',
    openaiApiKey: 'sk-openai-test',
    imageProvider: 'gemini',
  });
  let target = getImageClient(accountId);
  assert.equal(target.provider, 'gemini');
  assert.equal(target.model, GEMINI_DEFAULT_IMAGE_MODEL, 'Nano Banana 2 by default');
  assert.equal(typeof target.client.images.generate, 'function');
  assert.equal(typeof target.client.images.edit, 'function');

  setRuntimeAiSettings(accountId, { imageProvider: 'qwen', qwenImageModel: '' });
  target = getImageClient(accountId);
  assert.equal(target.provider, 'qwen');
  assert.equal(target.model, QWEN_DEFAULT_IMAGE_MODEL);

  setRuntimeAiSettings(accountId, { imageProvider: 'qwen', qwenImageModel: 'qwen-image-3.0-pro' });
  assert.equal(getImageClient(accountId).model, 'qwen-image-3.0-pro', 'the configured model wins');

  setRuntimeAiSettings(accountId, { imageProvider: 'openai', openaiImageModel: '' });
  target = getImageClient(accountId);
  assert.equal(target.provider, 'openai', 'pinned to OpenAI even though the LLM is CGU Air');
  assert.equal(target.model, config.openaiImageModel);

  setRuntimeAiSettings(accountId, { imageProvider: 'openai', openaiImageModel: 'gpt-image-2.5' });
  assert.equal(getImageClient(accountId).model, 'gpt-image-2.5', 'per-account OpenAI image model');

  setRuntimeAiSettings(accountId, { imageProvider: '' });
  assert.equal(getImageClient(accountId).provider, 'cgu-air', "'' = follow the LLM provider, as before");
});

test('a pinned Gemini / Qwen image provider without its key fails as a missing-key error, not a 401 later', () => {
  const accountId = 'image-client-pinned-nokey-01';
  setRuntimeAiSettings(accountId, { llmProvider: 'openai', openaiApiKey: 'sk-openai-test', imageProvider: 'gemini', geminiApiKey: '' });
  assert.throws(() => getImageClient(accountId), (err: unknown) => isApiKeyMissingError(err) && /GEMINI_API_KEY/.test((err as Error).message));
  setRuntimeAiSettings(accountId, { imageProvider: 'qwen', qwenImageBackend: 'dashscope', qwenApiKey: '' });
  assert.throws(() => getImageClient(accountId), (err: unknown) => isApiKeyMissingError(err) && /QWEN_API_KEY/.test((err as Error).message));
  // The local / remote service needs no key (a --token is optional), so it resolves without one.
  setRuntimeAiSettings(accountId, { imageProvider: 'qwen', qwenImageBackend: 'local', qwenApiKey: '' });
  assert.equal(getImageClient(accountId).provider, 'qwen');
});

test('a pinned image provider never fails over to the LLM secondary provider', () => {
  const accountId = 'image-client-pinned-failover-01';
  setRuntimeAiSettings(accountId, {
    llmProvider: 'openai',
    openaiApiKey: 'sk-openai-test',
    secondaryLlmProvider: 'cgu-air',
    cguAirApiKey: 'sk-cgu-air-test',
    imageProvider: 'gemini',
    geminiApiKey: 'AIza-test',
  });
  setLlmUsageContext({});
  try {
    const permanentErr = new APIError(403, { code: 'account_deactivated' }, 'nope', undefined);
    assert.equal(resolveImageProviderFailover(accountId, permanentErr), null, 'images are pinned; the LLM fallback says nothing about images');
    setStickyLlmProvider('cgu-air');
    assert.equal(getImageClient(accountId).provider, 'gemini', 'nor does a sticky LLM failover move images');
  } finally {
    setLlmUsageContext({});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config';
import { setRuntimeAiSettings } from '../src/services/aiSettings';
import { getImageClient } from '../src/services/openai';

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

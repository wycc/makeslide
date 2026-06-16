import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiContents } from '../src/services/gemini';

test('buildGeminiContents: text-only system+user messages', () => {
  const result = buildGeminiContents([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
  ]);
  assert.deepStrictEqual(result.systemInstruction, { parts: [{ text: 'You are a helpful assistant.' }] });
  assert.strictEqual(result.contents.length, 1);
  assert.strictEqual(result.contents[0]!.role, 'user');
  assert.deepStrictEqual(result.contents[0]!.parts, [{ text: 'Hello!' }]);
});

test('buildGeminiContents: assistant role maps to model', () => {
  const result = buildGeminiContents([
    { role: 'user', content: 'Ping' },
    { role: 'assistant', content: 'Pong' },
  ]);
  assert.strictEqual(result.systemInstruction, undefined);
  assert.strictEqual(result.contents.length, 2);
  assert.strictEqual(result.contents[0]!.role, 'user');
  assert.strictEqual(result.contents[1]!.role, 'model');
  assert.deepStrictEqual(result.contents[1]!.parts, [{ text: 'Pong' }]);
});

test('buildGeminiContents: data:image URL converted to inlineData', () => {
  const base64 = Buffer.from('fake-jpeg-bytes').toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;
  const result = buildGeminiContents([
    { role: 'system', content: 'System prompt.' },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        { type: 'text', text: 'What is in this slide?' },
      ],
    },
  ]);
  assert.deepStrictEqual(result.systemInstruction, { parts: [{ text: 'System prompt.' }] });
  assert.strictEqual(result.contents.length, 1);
  const parts = result.contents[0]!.parts;
  assert.strictEqual(parts.length, 2);
  assert.deepStrictEqual(parts[0], { inlineData: { mimeType: 'image/jpeg', data: base64 } });
  assert.deepStrictEqual(parts[1], { text: 'What is in this slide?' });
});

test('buildGeminiContents: non-data-URL image_url is dropped', () => {
  const result = buildGeminiContents([
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/slide.jpg', detail: 'auto' } },
        { type: 'text', text: 'Describe this.' },
      ],
    },
  ]);
  assert.strictEqual(result.contents.length, 1);
  // Only the text part should remain; the external URL is dropped.
  assert.deepStrictEqual(result.contents[0]!.parts, [{ text: 'Describe this.' }]);
});

test('buildGeminiContents: multiple system messages concatenated in systemInstruction', () => {
  const result = buildGeminiContents([
    { role: 'system', content: 'First system.' },
    { role: 'system', content: 'Second system.' },
    { role: 'user', content: 'User message.' },
  ]);
  assert.deepStrictEqual(result.systemInstruction, {
    parts: [{ text: 'First system.' }, { text: 'Second system.' }],
  });
  assert.strictEqual(result.contents.length, 1);
});

test('buildGeminiContents: no system instruction when no system messages', () => {
  const result = buildGeminiContents([{ role: 'user', content: 'Hello' }]);
  assert.strictEqual(result.systemInstruction, undefined);
});

test('buildGeminiContents: image_url with PNG data URL works', () => {
  const base64 = Buffer.from('fake-png').toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;
  const result = buildGeminiContents([
    { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] },
  ]);
  assert.deepStrictEqual(result.contents[0]!.parts[0], { inlineData: { mimeType: 'image/png', data: base64 } });
});

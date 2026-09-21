import test from 'node:test';
import assert from 'node:assert/strict';
import { toFile } from 'openai';
import {
  MASK_HINT,
  QWEN_DEFAULT_SIZE,
  geminiAspectRatioForSize,
  geminiImageClient,
  parseGeminiImageResponse,
  parseOpenAiSize,
  parseQwenImageResponse,
  qwenImageClient,
  qwenSizeForOpenAiSize,
  uploadableToDataUrl,
} from '../src/services/imageAdapters';

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('size mapping: OpenAI WxH → Gemini aspect ratio / Qwen w*h within its pixel bounds', () => {
  assert.deepEqual(parseOpenAiSize('1536x1024'), { width: 1536, height: 1024 });
  assert.equal(parseOpenAiSize('auto'), null);
  assert.equal(parseOpenAiSize(undefined), null);
  assert.equal(geminiAspectRatioForSize('1536x1024'), '3:2');
  assert.equal(geminiAspectRatioForSize('1024x1024'), '1:1');
  assert.equal(geminiAspectRatioForSize('1792x1024'), '16:9', 'nearest listed ratio');
  assert.equal(geminiAspectRatioForSize('auto'), undefined);
  assert.equal(qwenSizeForOpenAiSize('1536x1024'), '1536*1024', 'inside the 512²–2048² window: kept as is');
  assert.equal(qwenSizeForOpenAiSize(undefined), QWEN_DEFAULT_SIZE);
  assert.equal(qwenSizeForOpenAiSize('256x256'), '512*512', 'too small → scaled up to the floor');
  const [w, h] = qwenSizeForOpenAiSize('4096x4096').split('*').map(Number) as [number, number];
  assert.ok(w * h <= 2048 * 2048 && w === h && w % 16 === 0, `too large → scaled down (${w}*${h})`);
});

test('response parsing tolerates both casings of Gemini inline data and finds the Qwen image URL', () => {
  assert.deepEqual(parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: 'AAA=' } }] } }] }), { b64: 'AAA=', mimeType: 'image/png' });
  assert.deepEqual(parseGeminiImageResponse({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'BBB=' } }] } }] }), { b64: 'BBB=', mimeType: 'image/jpeg' });
  assert.equal(parseGeminiImageResponse({ candidates: [{ content: { parts: [{ text: 'refused' }] } }] }), null);
  assert.equal(parseQwenImageResponse({ output: { choices: [{ message: { content: [{ image: 'https://x/y.png' }] } }] } }), 'https://x/y.png');
  assert.equal(parseQwenImageResponse({ output: { choices: [] } }), null);
});

test('uploadableToDataUrl reads what the SDK toFile helper produces', async () => {
  const file = await toFile(PNG_1PX, 'a.png', { type: 'image/png' });
  const url = await uploadableToDataUrl(file);
  assert.equal(url, `data:image/png;base64,${PNG_1PX.toString('base64')}`);
});

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

test('Gemini adapter: generateContent with image output, aspect ratio from the size, edit inputs as inlineData plus the mask hint', async () => {
  const { fetch: fetchImpl, calls } = fakeFetch(() =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'R0VN' } }] } }] }), { status: 200 }),
  );
  const client = geminiImageClient({ apiKey: 'AIza-test', timeoutMs: 5_000, fetchImpl });

  const generated = await client.images.generate({ model: 'gemini-3.1-flash-image', prompt: 'a slide', size: '1536x1024' } as never);
  assert.equal(generated.data?.[0]?.b64_json, 'R0VN');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/v1beta\/models\/gemini-3\.1-flash-image:generateContent$/);
  assert.equal((calls[0]!.init?.headers as Record<string, string>)['x-goog-api-key'], 'AIza-test', 'key in a header, not the URL');
  const body = JSON.parse(String(calls[0]!.init?.body)) as { contents: Array<{ parts: unknown[] }>; generationConfig: Record<string, unknown> };
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '3:2' });
  assert.deepEqual(body.contents[0]!.parts, [{ text: 'a slide' }]);

  const image = await toFile(PNG_1PX, 'slide.png', { type: 'image/png' });
  const mask = await toFile(PNG_1PX, 'mask.png', { type: 'image/png' });
  await client.images.edit({ model: 'gemini-3.1-flash-image', prompt: 'replace the title', image, mask, size: '1024x1024' } as never);
  const editBody = JSON.parse(String(calls[1]!.init?.body)) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
  const parts = editBody.contents[0]!.parts;
  assert.equal(parts.length, 3, 'text + image + mask');
  assert.equal((parts[0] as { text: string }).text, `replace the title${MASK_HINT}`);
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: PNG_1PX.toString('base64') } });
});

test('Gemini adapter: retries once without imageConfig when the model rejects it, and reports text-only answers', async () => {
  let n = 0;
  const { fetch: fetchImpl, calls } = fakeFetch(() => {
    n++;
    if (n === 1) return new Response(JSON.stringify({ error: { message: 'Unknown name "imageConfig"' } }), { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I cannot draw that' }] }, finishReason: 'STOP' }] }), { status: 200 });
  });
  const client = geminiImageClient({ apiKey: 'k', timeoutMs: 5_000, fetchImpl });
  await assert.rejects(
    client.images.generate({ model: 'gemini-2.5-flash-image', prompt: 'x', size: '1536x1024' } as never),
    /Gemini returned no image \(I cannot draw that finishReason=STOP\)/,
  );
  assert.equal(calls.length, 2);
  assert.equal('imageConfig' in (JSON.parse(String(calls[1]!.init?.body)) as { generationConfig: Record<string, unknown> }).generationConfig, false);
});

test('Qwen adapter: DashScope multimodal-generation request, images before the text, result URL downloaded to base64', async () => {
  const { fetch: fetchImpl, calls } = fakeFetch((url) => {
    if (url.endsWith('/services/aigc/multimodal-generation/generation')) {
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/out.png' }] } }] } }), { status: 200 });
    }
    return new Response(PNG_1PX, { status: 200 });
  });
  const client = qwenImageClient({ apiKey: 'sk-qwen', baseUrl: 'https://dashscope-intl.aliyuncs.com/api/v1/', timeoutMs: 5_000, fetchImpl });

  const generated = await client.images.generate({ model: 'qwen-image-2.1', prompt: 'a slide', size: '1536x1024' } as never);
  assert.equal(generated.data?.[0]?.b64_json, PNG_1PX.toString('base64'));
  assert.equal(calls[0]!.url, 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, 'Bearer sk-qwen');
  const body = JSON.parse(String(calls[0]!.init?.body)) as { model: string; input: { messages: Array<{ content: Array<Record<string, string>> }> }; parameters: Record<string, unknown> };
  assert.equal(body.model, 'qwen-image-2.1');
  assert.deepEqual(body.input.messages[0]!.content, [{ text: 'a slide' }]);
  assert.equal(body.parameters.size, '1536*1024');
  assert.equal(calls[1]!.url, 'https://cdn.example/out.png', 'the 24-hour result URL is fetched right away');

  const image = await toFile(PNG_1PX, 'slide.png', { type: 'image/png' });
  await client.images.edit({ model: 'qwen-image-2.1', prompt: 'brighter', image } as never);
  const editBody = JSON.parse(String(calls[2]!.init?.body)) as { input: { messages: Array<{ content: Array<Record<string, string>> }> } };
  const content = editBody.input.messages[0]!.content;
  assert.equal(content.length, 2);
  assert.match(content[0]!.image!, /^data:image\/png;base64,/);
  assert.equal(content[1]!.text, 'brighter');
});

test('Qwen adapter: HTTP errors carry the status and a body snippet', async () => {
  const { fetch: fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ code: 'InvalidParameter', message: 'model not found' }), { status: 400 }));
  const client = qwenImageClient({ apiKey: 'k', baseUrl: 'https://x/api/v1', timeoutMs: 5_000, fetchImpl });
  await assert.rejects(client.images.generate({ model: 'nope', prompt: 'x' } as never), (err: Error & { status?: number }) => err.status === 400 && /model not found/.test(err.message));
});

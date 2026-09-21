import test from 'node:test';
import assert from 'node:assert/strict';
import { toFile } from 'openai';
import sharp from 'sharp';
import {
  MASK_HINT,
  QWEN_DEFAULT_SIZE,
  geminiAspectRatioForSize,
  geminiImageClient,
  parseGeminiImageResponse,
  parseOpenAiSize,
  parseQwenImageResponse,
  qwenImageClient,
  qwenLocalImageClient,
  qwenSizeForOpenAiSize,
  uploadableToDataUrl,
} from '../src/services/imageAdapters';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('Qwen local adapter: JSON generations/edits against the service, bearer token only when configured, mask passed through', async () => {
  const { fetch: fetchImpl, calls } = fakeFetch(() => new Response(JSON.stringify({ created: 1, data: [{ b64_json: 'TE9DQUw=' }] }), { status: 200 }));
  const client = qwenLocalImageClient({ baseUrl: 'http://gpu-box:8765/', token: 'secret', timeoutMs: 5_000, fetchImpl });
  const generated = await client.images.generate({ model: 'Qwen/Qwen-Image-2.1', prompt: 'a slide', size: '1536x1024' } as never);
  assert.equal(generated.data?.[0]?.b64_json, 'TE9DQUw=');
  assert.equal(calls[0]!.url, 'http://gpu-box:8765/v1/images/generations');
  assert.equal((calls[0]!.init?.headers as Record<string, string>).authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { model: 'Qwen/Qwen-Image-2.1', prompt: 'a slide', size: '1536x1024', n: 1 });

  const image = await toFile(PNG_1PX, 'slide.png', { type: 'image/png' });
  const mask = await toFile(PNG_1PX, 'mask.png', { type: 'image/png' });
  await client.images.edit({ model: 'Qwen/Qwen-Image-2.1', prompt: 'replace the title', image, mask } as never);
  assert.equal(calls[1]!.url, 'http://gpu-box:8765/v1/images/edits');
  const body = JSON.parse(String(calls[1]!.init?.body)) as { prompt: string; images: string[]; mask?: string };
  assert.equal(body.prompt, 'replace the title', 'the service composites the mask itself — no prompt hint');
  assert.equal(body.images.length, 1);
  assert.match(body.mask!, /^data:image\/png;base64,/);

  const noToken = qwenLocalImageClient({ baseUrl: 'http://127.0.0.1:8765', timeoutMs: 5_000, fetchImpl });
  await noToken.images.generate({ model: 'm', prompt: 'x' } as never);
  assert.equal('authorization' in (calls[2]!.init?.headers as Record<string, string>), false);
});

// End to end against the real service in --stub mode (no model): proves the wire format both
// sides agree on, including the service's mask compositing. Needs python3 with pillow.
const PYTHON = ['python3.12', 'python3'].find((bin) => spawnSync(bin, ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0);
test('the Qwen-Image service (stub) answers the local adapter end to end, compositing edits only inside the mask', { skip: PYTHON ? false : 'python3 with pillow not available' }, async () => {
  const script = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'scripts', 'qwen-image-server', 'server.py');
  const proc = spawn(PYTHON!, [script, '--stub', '--port', '0', '--token', 'e2e'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`service did not start: ${out}`)), 15_000);
      proc.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        const m = /listening on (http:\/\/[\d.]+:\d+)/.exec(out);
        if (m) { clearTimeout(timer); resolve(m[1]!); }
      });
      proc.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.on('exit', (code) => reject(new Error(`service exited with ${code}: ${out}`)));
    });
    const client = qwenLocalImageClient({ baseUrl: url, token: 'e2e', timeoutMs: 20_000 });
    const generated = await client.images.generate({ model: 'stub', prompt: 'matrices', size: '512x320' } as never);
    const png = Buffer.from(generated.data![0]!.b64_json!, 'base64');
    const meta = await sharp(png).metadata();
    assert.deepEqual({ w: meta.width, h: meta.height }, { w: 512, h: 320 });

    // Red 64×64 original; the mask is transparent on the left half only.
    const red = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const maskRaw = Buffer.alloc(64 * 64 * 4, 0);
    for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) maskRaw[(y * 64 + x) * 4 + 3] = 255;
    const maskPng = await sharp(maskRaw, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    const edited = await client.images.edit({ model: 'stub', prompt: 'blue', image: await toFile(red, 'red.png', { type: 'image/png' }), mask: await toFile(maskPng, 'mask.png', { type: 'image/png' }) } as never);
    const out = await sharp(Buffer.from(edited.data![0]!.b64_json!, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(out.data.subarray((y * out.info.width + x) * 4, (y * out.info.width + x) * 4 + 3));
    assert.deepEqual(px(48, 32), [255, 0, 0], 'opaque mask half stays the original red');
    assert.notDeepEqual(px(16, 32), [255, 0, 0], 'transparent mask half comes from the model');

    const unauthorized = qwenLocalImageClient({ baseUrl: url, timeoutMs: 5_000 });
    await assert.rejects(unauthorized.images.generate({ model: 'stub', prompt: 'x' } as never), (err: Error & { status?: number }) => err.status === 401);
  } finally {
    proc.kill();
  }
});

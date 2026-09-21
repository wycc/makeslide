import type { Uploadable } from 'openai/uploads';
import type { ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming, ImagesResponse } from 'openai/resources/images';
import { logger } from '../logger';

/**
 * Image generation through services that do not speak the OpenAI Images API.
 *
 * Every image call site in the app (slide rendering, regenerate, inpaint, cut-outs, page elements,
 * React backgrounds) is written against `client.images.generate` / `client.images.edit` from the
 * OpenAI SDK. Rather than teach each of them a second and third API, the account's image provider
 * setting (aiSettings.ts `imageProvider`) makes getImageClient hand back an object with the same
 * two methods — for OpenAI-compatible providers it is the SDK client itself, for Gemini and Qwen
 * it is one of the adapters below, which translate the request and hand back an OpenAI-shaped
 * `ImagesResponse` with `data[0].b64_json`.
 *
 * What the adapters can and cannot do:
 * - Text-to-image and image-to-image (edit with reference images) both work.
 * - Neither service takes a mask. When a call passes one, the mask image is sent as an extra
 *   input and the prompt tells the model to change only the transparent region; that is a hint,
 *   not a guarantee, so mask-precise inpainting stays best on OpenAI.
 * - Size is mapped to what each service understands (Gemini: an aspect ratio; Qwen: `w*h`).
 */

export interface ImageRequestOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/** The subset of the OpenAI SDK surface the app's image call sites use. */
export interface ImageApiClient {
  images: {
    generate(params: ImageGenerateParamsNonStreaming, options?: ImageRequestOptions): Promise<ImagesResponse>;
    edit(params: ImageEditParamsNonStreaming, options?: ImageRequestOptions): Promise<ImagesResponse>;
  };
}

export interface ImageDimensions { width: number; height: number }

/** OpenAI-style `WxH` size → dimensions; `auto`, undefined and anything unparsable → null. */
export function parseOpenAiSize(size: string | null | undefined): ImageDimensions | null {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec((size ?? '').trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

const GEMINI_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export type GeminiAspectRatio = (typeof GEMINI_ASPECT_RATIOS)[number];

/** The Gemini aspect ratio closest to an OpenAI size (`1536x1024` → `3:2`); undefined when there is no size. */
export function geminiAspectRatioForSize(size: string | null | undefined): GeminiAspectRatio | undefined {
  const dims = parseOpenAiSize(size);
  if (!dims) return undefined;
  const target = dims.width / dims.height;
  let best: GeminiAspectRatio = '1:1';
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const ratio of GEMINI_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number) as [number, number];
    const diff = Math.abs(Math.log(w / h) - Math.log(target));
    if (diff < bestDiff) { best = ratio; bestDiff = diff; }
  }
  return best;
}

const QWEN_MIN_PIXELS = 512 * 512;
const QWEN_MAX_PIXELS = 2048 * 2048;
export const QWEN_DEFAULT_SIZE = '1664*928';

/**
 * Qwen-Image size string for an OpenAI size. Qwen wants `w*h` with the pixel count between 512²
 * and 2048² (aspect kept), so an out-of-range request is scaled to the nearest bound and rounded
 * to multiples of 16. No size → the service's 16:9 default.
 */
export function qwenSizeForOpenAiSize(size: string | null | undefined): string {
  const dims = parseOpenAiSize(size);
  if (!dims) return QWEN_DEFAULT_SIZE;
  let { width, height } = dims;
  const pixels = width * height;
  const scale = pixels < QWEN_MIN_PIXELS ? Math.sqrt(QWEN_MIN_PIXELS / pixels) : pixels > QWEN_MAX_PIXELS ? Math.sqrt(QWEN_MAX_PIXELS / pixels) : 1;
  if (scale !== 1) {
    width = Math.max(16, Math.round((width * scale) / 16) * 16);
    height = Math.max(16, Math.round((height * scale) / 16) * 16);
  }
  return `${width}*${height}`;
}

/** Turn whatever the SDK's `toFile` produced (a File, mostly) into a `data:` URL. */
export async function uploadableToDataUrl(file: Uploadable, fallbackMime = 'image/png'): Promise<string> {
  const withBuffer = file as { arrayBuffer?: () => Promise<ArrayBuffer>; type?: string };
  let bytes: Buffer;
  if (typeof withBuffer.arrayBuffer === 'function') {
    bytes = Buffer.from(await withBuffer.arrayBuffer());
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of file as AsyncIterable<Buffer | string>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    bytes = Buffer.concat(chunks);
  }
  const mime = (withBuffer.type ?? '').trim() || fallbackMime;
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function uploadablesOf(image: Uploadable | Uploadable[]): Uploadable[] {
  return Array.isArray(image) ? image : [image];
}

/** Prompt suffix standing in for a mask the service cannot take. */
export const MASK_HINT =
  ' The last attached image is a mask: only the transparent (cut-out) area of the first image may change; keep every other pixel exactly as it is.';

/** Pull the first inline image out of a generateContent response; null when the model answered with text only. */
export function parseGeminiImageResponse(json: unknown): { b64: string; mimeType: string } | null {
  const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> })?.candidates ?? [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = (part.inlineData ?? part.inline_data) as { data?: string; mimeType?: string; mime_type?: string } | undefined;
      if (inline?.data) return { b64: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png' };
    }
  }
  return null;
}

/** Text the model returned alongside (or instead of) an image — surfaced when no image came back. */
export function geminiResponseText(json: unknown): string {
  const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> })?.candidates ?? [];
  const texts = candidates.flatMap((c) => (c.content?.parts ?? []).map((p) => p.text ?? '').filter(Boolean));
  const finish = candidates[0]?.finishReason;
  return [texts.join(' ').slice(0, 300), finish ? `finishReason=${finish}` : ''].filter(Boolean).join(' ');
}

/** The image (URL or data URL) in a DashScope multimodal-generation response; null when absent. */
export function parseQwenImageResponse(json: unknown): string | null {
  const choices = (json as { output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> } })?.output?.choices ?? [];
  for (const choice of choices) {
    for (const part of choice.message?.content ?? []) {
      if (typeof part.image === 'string' && part.image) return part.image;
    }
  }
  return null;
}

function httpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function imagesResponse(b64: string): ImagesResponse {
  return { created: Math.floor(Date.now() / 1000), data: [{ b64_json: b64 }] };
}

function timeoutSignal(options: ImageRequestOptions | undefined, defaultMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(options?.timeout ?? defaultMs);
  return options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
}

async function readErrorSnippet(resp: Response): Promise<string> {
  try {
    return (await resp.text()).replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}

/** Gemini (Nano Banana): `generateContent` with image output. */
export function geminiImageClient(opts: { apiKey: string; timeoutMs: number; fetchImpl?: typeof fetch }): ImageApiClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const call = async (
    model: string,
    prompt: string,
    inputDataUrls: string[],
    size: string | null | undefined,
    options: ImageRequestOptions | undefined,
  ): Promise<ImagesResponse> => {
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    for (const dataUrl of inputDataUrls) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    const aspectRatio = geminiAspectRatioForSize(size);
    const request = async (withImageConfig: boolean) => {
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          ...(withImageConfig && aspectRatio ? { imageConfig: { aspectRatio } } : {}),
        },
      };
      const startedAt = Date.now();
      const resp = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
          signal: timeoutSignal(options, opts.timeoutMs),
        },
      );
      logger.info({ provider: 'gemini', model, status: resp.status, latencyMs: Date.now() - startedAt, inputImages: inputDataUrls.length, aspectRatio: withImageConfig ? aspectRatio : undefined }, 'Gemini image request');
      return resp;
    };
    let resp = await request(true);
    if (resp.status === 400 && aspectRatio) {
      // Older image models reject imageConfig outright; the picture is still worth having.
      const snippet = await readErrorSnippet(resp.clone());
      if (/imageConfig|aspect/i.test(snippet)) resp = await request(false);
    }
    if (!resp.ok) throw httpError(`Gemini image request failed: HTTP ${resp.status} ${await readErrorSnippet(resp)}`.trim(), resp.status);
    const json = (await resp.json()) as unknown;
    const image = parseGeminiImageResponse(json);
    if (!image) throw new Error(`Gemini returned no image (${geminiResponseText(json) || 'empty response'})`);
    return imagesResponse(image.b64);
  };

  return {
    images: {
      generate: (params, options) => call(params.model ?? '', params.prompt, [], params.size, options),
      edit: async (params, options) => {
        const inputs = await Promise.all(uploadablesOf(params.image).map((f) => uploadableToDataUrl(f)));
        let prompt = params.prompt;
        if (params.mask) {
          inputs.push(await uploadableToDataUrl(params.mask));
          prompt += MASK_HINT;
        }
        return call(params.model ?? '', prompt, inputs, params.size, options);
      },
    },
  };
}

/** Qwen-Image through DashScope's synchronous multimodal-generation endpoint. */
export function qwenImageClient(opts: { apiKey: string; baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch }): ImageApiClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const endpoint = `${opts.baseUrl.replace(/\/+$/, '')}/services/aigc/multimodal-generation/generation`;

  const call = async (
    model: string,
    prompt: string,
    inputDataUrls: string[],
    size: string | null | undefined,
    options: ImageRequestOptions | undefined,
  ): Promise<ImagesResponse> => {
    const content: Array<Record<string, string>> = [...inputDataUrls.map((image) => ({ image })), { text: prompt }];
    const body = {
      model,
      input: { messages: [{ role: 'user', content }] },
      parameters: { n: 1, size: qwenSizeForOpenAiSize(size), watermark: false },
    };
    const startedAt = Date.now();
    const resp = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(body),
      signal: timeoutSignal(options, opts.timeoutMs),
    });
    logger.info({ provider: 'qwen', model, status: resp.status, latencyMs: Date.now() - startedAt, inputImages: inputDataUrls.length, size: body.parameters.size }, 'Qwen image request');
    if (!resp.ok) throw httpError(`Qwen image request failed: HTTP ${resp.status} ${await readErrorSnippet(resp)}`.trim(), resp.status);
    const json = (await resp.json()) as unknown;
    const image = parseQwenImageResponse(json);
    if (!image) {
      const detail = JSON.stringify((json as { output?: unknown; message?: unknown })?.message ?? (json as { output?: unknown }).output ?? json).slice(0, 300);
      throw new Error(`Qwen returned no image (${detail})`);
    }
    const dataUrl = /^data:/.exec(image);
    if (dataUrl) return imagesResponse(image.replace(/^data:[^,]*,/, ''));
    // Result URLs expire after 24 h; fetch the bytes now so the caller can store them.
    const download = await fetchImpl(image, { signal: timeoutSignal(options, opts.timeoutMs) });
    if (!download.ok) throw httpError(`Qwen image download failed: HTTP ${download.status}`, download.status);
    return imagesResponse(Buffer.from(await download.arrayBuffer()).toString('base64'));
  };

  return {
    images: {
      generate: (params, options) => call(params.model ?? '', params.prompt, [], params.size, options),
      edit: async (params, options) => {
        const inputs = await Promise.all(uploadablesOf(params.image).map((f) => uploadableToDataUrl(f)));
        let prompt = params.prompt;
        if (params.mask) {
          inputs.push(await uploadableToDataUrl(params.mask));
          prompt += MASK_HINT;
        }
        return call(params.model ?? '', prompt, inputs, params.size, options);
      },
    },
  };
}

/**
 * The open-weight Qwen-Image-2.1 served by scripts/qwen-image-server/server.py (this machine or
 * a remote GPU box). Its API is a JSON cousin of the OpenAI Images API: images and the mask travel
 * as data URLs, the reply is already `{ data: [{ b64_json }] }`. The mask is honoured by the
 * service itself (it pastes the model's output back only where the mask is transparent), so no
 * prompt hint is needed here.
 */
export function qwenLocalImageClient(opts: { baseUrl: string; token?: string; timeoutMs: number; fetchImpl?: typeof fetch }): ImageApiClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const root = opts.baseUrl.replace(/\/+$/, '');

  const call = async (path: string, body: Record<string, unknown>, options: ImageRequestOptions | undefined): Promise<ImagesResponse> => {
    const startedAt = Date.now();
    const resp = await fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      body: JSON.stringify(body),
      signal: timeoutSignal(options, opts.timeoutMs),
    });
    logger.info({ provider: 'qwen-local', url: `${root}${path}`, model: body.model, status: resp.status, latencyMs: Date.now() - startedAt }, 'Qwen local image request');
    if (!resp.ok) throw httpError(`Qwen image service request failed: HTTP ${resp.status} ${await readErrorSnippet(resp)}`.trim(), resp.status);
    const json = (await resp.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error('Qwen image service returned no image');
    return imagesResponse(b64);
  };

  return {
    images: {
      generate: (params, options) =>
        call('/v1/images/generations', { model: params.model, prompt: params.prompt, size: params.size ?? undefined, n: 1 }, options),
      edit: async (params, options) => {
        const images = await Promise.all(uploadablesOf(params.image).map((f) => uploadableToDataUrl(f)));
        const mask = params.mask ? await uploadableToDataUrl(params.mask) : undefined;
        return call('/v1/images/edits', { model: params.model, prompt: params.prompt, size: params.size ?? undefined, images, ...(mask ? { mask } : {}) }, options);
      },
    },
  };
}

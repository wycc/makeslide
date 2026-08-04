/**
 * OpenAI 相容的假伺服器，供 E2E 使用。
 *
 * 為什麼需要它：生成流程（逐字稿、配圖、語音、embedding）全部經過 OpenAI SDK。
 * 真的打會燒錢、慢，而且每次輸出都不一樣——不確定的輸出無法斷言。後端的
 * `OPENAI_BASE_URL` 是可覆寫的設定，所以把它指到這裡即可。
 *
 * 設計上最重要的一點：**回應要真實到足以通過後端既有的解析**。音檔必須真的能被
 * ffmpeg 讀出時長、圖片必須真的是 PNG，否則測到的會是這支假伺服器的 bug，而不是
 * 產品的。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export interface LlmCall {
  ts: string;
  endpoint: string;
  model: string | null;
  /** 只留摘要：完整 prompt 可能很長，而診斷時通常只需要知道打了什麼、多長。 */
  promptChars: number;
  promptHead: string;
  stream: boolean;
  matchedRule: string | null;
}

/**
 * 測試可註冊的腳本回應：當請求內容含 `when` 字串時，回傳 `reply`（會被 JSON.stringify）。
 * 先註冊的先比對，讓個別測試可以覆寫預設行為。
 */
export interface ChatRule {
  name: string;
  when: (prompt: string) => boolean;
  reply: (prompt: string) => unknown;
}

/**
 * 預設回應是一個「superset 物件」——同時帶上各生成步驟需要的鍵。
 *
 * 這可行是因為後端的 zod schema 都是非 strict 的 `z.object()`，會忽略不認得的鍵。
 * 於是同一份回應可以同時滿足 `{script}`、`{title}`、`{pages:[{page_number,content}]}`、
 * `{pages:[{page_number,script}]}`、`{slides:[{title,bullets}]}` 等多個 schema，
 * 不必為每一條 AI 路徑各寫一個 mock。
 */
function supersetReply(prompt: string): Record<string, unknown> {
  const slideCount = countRequestedSlides(prompt);
  // 選擇題欄位也一併帶上，而不是靠關鍵字判斷「這是不是出題請求」。試過用
  // /選擇題|quiz|正解/ 之類的規則路由，但出題提示詞未必含這些字——猜錯的代價是
  // 後端拿到缺欄位的 JSON、重試兩次後回 500，而失敗訊息看起來像產品壞了。
  // superset 本來就靠「zod 非 strict 會忽略未知鍵」成立，多帶幾個鍵不會有副作用。
  const question = {
    question: 'E2E 測試題目：以下哪一個是正確的？',
    options: ['正確選項', '錯誤選項一', '錯誤選項二', '錯誤選項三'],
    correct_index: 0,
    correct_indices: [0],
    explanation: '因為這是 E2E 假伺服器固定回傳的正解。',
    page_number: 1,
    topic: firstTopicIn(prompt),
    difficulty: 2,
  };
  const pages = Array.from({ length: slideCount }, (_, i) => ({
    page_number: i + 1,
    content: `# E2E 第 ${i + 1} 頁\n\n- 這是假 LLM 產生的內容\n- 用於端對端測試`,
    script: `這是第 ${i + 1} 頁的測試逐字稿，由 E2E 假伺服器產生，內容固定以便斷言。`,
    title: `E2E 第 ${i + 1} 頁`,
  }));
  return {
    ...question,
    questions: [question],
    items: [question],
    // generateScript / 單頁改寫
    script: '這是測試逐字稿，由 E2E 假伺服器產生，內容固定以便斷言。',
    // generateTitle（2–60 字）
    title: 'E2E 測試簡報',
    // splitTextWithLlm / deck rewrite
    pages,
    // 大綱（OutlineSchema）
    slides: pages.map((p) => ({
      title: p.title,
      bullets: ['第一個要點', '第二個要點'],
    })),
    // 常見的其他形狀，一併帶上
    description: 'E2E 測試用描述',
    summary: 'E2E 測試用摘要',
    topics: ['測試主題甲', '測試主題乙'],
    prompt: 'a plain slide, e2e test',
    image_prompt: 'a plain slide, e2e test',
    answer: '這是 AI 導師的測試回答。',
    suggestions: ['測試建議一', '測試建議二'],
  };
}

/** 從 prompt 裡推測要產生幾頁：優先看 `## Slide N` 標記，其次看明講的頁數，最後預設 2。 */
function countRequestedSlides(prompt: string): number {
  const markers = prompt.match(/##\s*Slide\s*\d+/gi);
  if (markers && markers.length > 0) return Math.min(markers.length, 20);
  const explicit = /(\d+)\s*(頁|張|slides?|pages?)/i.exec(prompt);
  if (explicit) {
    const n = Number(explicit[1]);
    if (Number.isFinite(n) && n >= 1) return Math.min(n, 20);
  }
  return 2;
}

/** 出題提示詞會列出「可選主題」，照抄其中一個，讓主題歸因的路徑走得通。 */
function firstTopicIn(prompt: string): string {
  const m = /可選主題[^\n]*[:：]\s*([^\n]+)/.exec(prompt);
  if (m?.[1]) {
    const first = m[1].split(/[、,，]/)[0]?.trim();
    if (first) return first.replace(/^[-*\s]+/, '');
  }
  return '測試主題甲';
}

const DEFAULT_RULES: ChatRule[] = [
  { name: 'superset', when: () => true, reply: supersetReply },
];

export interface FakeOpenAI {
  baseUrl: string;
  calls: LlmCall[];
  /** 註冊優先於預設的回應規則（後註冊者優先）。 */
  addRule(rule: ChatRule): void;
  resetRules(): void;
  close(): Promise<void>;
}

/** 產生指定秒數的無聲 MP3。後端會交給 ffmpeg 量長度，所以必須是真的能解碼的檔案。 */
async function silentMp3(seconds: number, cacheDir: string): Promise<Buffer> {
  const rounded = Math.max(1, Math.min(60, Math.round(seconds)));
  const cached = path.join(cacheDir, `silence-${rounded}.mp3`);
  try {
    return await fs.readFile(cached);
  } catch {
    // 不在快取裡，往下產生。
  }
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
  await execFileAsync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`,
    '-t', String(rounded),
    '-c:a', 'libmp3lame', '-b:a', '64k',
    cached,
  ]);
  return fs.readFile(cached);
}

/** 依輸入字數估時長，讓時間軸與字幕對齊的邏輯有東西可以算（約每秒 5 字）。 */
function estimateSeconds(text: string): number {
  return Math.max(1, Math.min(60, Math.ceil(text.length / 5)));
}

async function pngBuffer(width: number, height: number, seed: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const hash = crypto.createHash('sha256').update(seed).digest();
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      // 由 seed 決定顏色：同樣的 prompt 會得到同樣的圖，方便肉眼比對截圖。
      background: { r: 120 + (hash[0]! % 100), g: 120 + (hash[1]! % 100), b: 120 + (hash[2]! % 100) },
    },
  }).png().toBuffer();
}

function parseSize(size: unknown): { width: number; height: number } {
  if (typeof size === 'string') {
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  }
  return { width: 1536, height: 1024 };
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function promptTextOf(body: Record<string, unknown>): string {
  const messages = body.messages;
  if (Array.isArray(messages)) {
    return messages
      .map((m) => {
        const content = (m as { content?: unknown }).content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content
            .map((part) => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
            .join('\n');
        }
        return '';
      })
      .join('\n');
  }
  if (typeof body.prompt === 'string') return body.prompt;
  return '';
}

export async function startFakeOpenAI(): Promise<FakeOpenAI> {
  const calls: LlmCall[] = [];
  let rules: ChatRule[] = [...DEFAULT_RULES];
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'makeslide-e2e-audio-'));

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(err), type: 'fake_openai_error' } }));
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '';
    const raw = await readBody(req);
    const isJson = (req.headers['content-type'] ?? '').includes('application/json');
    const body = isJson && raw.length > 0
      ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>)
      : {};
    const model = typeof body.model === 'string' ? body.model : null;

    const record = (endpoint: string, prompt: string, stream: boolean, matchedRule: string | null): void => {
      calls.push({
        ts: new Date().toISOString(),
        endpoint,
        model,
        promptChars: prompt.length,
        promptHead: prompt.slice(0, 200),
        stream,
        matchedRule,
      });
    };

    if (url.includes('/chat/completions')) {
      const prompt = promptTextOf(body);
      const rule = [...rules].reverse().find((r) => r.when(prompt)) ?? DEFAULT_RULES[0]!;
      const stream = body.stream === true;
      record('chat.completions', prompt, stream, rule.name);
      const content = JSON.stringify(rule.reply(prompt));

      if (stream) {
        // 後端有一條 streaming 路徑（openai.ts:1017），照 SSE 格式回。
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const chunk = {
          id: 'chatcmpl-e2e',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model ?? 'e2e-model',
          choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model ?? 'e2e-model',
        choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4), total_tokens: 0 },
      }));
      return;
    }

    if (url.includes('/images/')) {
      // images.edit 是 multipart，不解析內容——只要回一張真的 PNG 就夠了。
      const prompt = isJson ? String(body.prompt ?? '') : `multipart:${raw.length}bytes`;
      const { width, height } = parseSize(isJson ? body.size : undefined);
      record(url.includes('/edits') ? 'images.edit' : 'images.generate', prompt, false, null);
      const png = await pngBuffer(width, height, prompt);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: png.toString('base64') }],
      }));
      return;
    }

    if (url.includes('/audio/speech')) {
      const input = typeof body.input === 'string' ? body.input : '';
      const format = typeof body.response_format === 'string' ? body.response_format : 'mp3';
      record('audio.speech', input, false, null);
      if (format === 'pcm') {
        // OpenRouter 路徑只收 PCM；24 kHz mono 16-bit 的無聲資料。
        const samples = 24000 * estimateSeconds(input);
        res.writeHead(200, { 'content-type': 'audio/pcm;rate=24000;channels=1' });
        res.end(Buffer.alloc(samples * 2));
        return;
      }
      const mp3 = await silentMp3(estimateSeconds(input), cacheDir);
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(mp3);
      return;
    }

    if (url.includes('/embeddings')) {
      const input = body.input;
      const inputs = Array.isArray(input) ? input : [input];
      record('embeddings', inputs.map(String).join('\n'), false, null);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        model: model ?? 'e2e-embedding',
        data: inputs.map((value, index) => ({
          object: 'embedding',
          index,
          // 由內容雜湊出的固定向量：同輸入必得同向量，相似度比較才可斷言。
          embedding: deterministicVector(String(value)),
        })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }));
      return;
    }

    if (url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'e2e-model', object: 'model' }] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `fake OpenAI: unhandled ${req.method} ${url}`, type: 'not_found' } }));
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    addRule(rule) { rules.push(rule); },
    resetRules() { rules = [...DEFAULT_RULES]; },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(cacheDir, { recursive: true, force: true });
    },
  };
}

function deterministicVector(value: string): number[] {
  const hash = crypto.createHash('sha256').update(value).digest();
  const dims = 64;
  const out: number[] = [];
  for (let i = 0; i < dims; i++) out.push((hash[i % hash.length]! / 255) * 2 - 1);
  const norm = Math.sqrt(out.reduce((a, b) => a + b * b, 0)) || 1;
  return out.map((v) => v / norm);
}

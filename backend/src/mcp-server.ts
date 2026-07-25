/**
 * MCP (Model Context Protocol) server for makeslide.
 *
 * Exposes makeslide's presentation-generation pipeline as MCP tools so that
 * Claude Code or any other MCP-compatible agent can upload PDFs, trigger
 * generation runs, and retrieve the resulting video URLs without a browser.
 *
 * Transport: newline-delimited JSON over stdio (standard for Claude Code MCP).
 *
 * Configuration (environment variables):
 *   MAKESLIDE_URL         Base URL of the running makeslide backend
 *                         (default: http://localhost:3000)
 *   MAKESLIDE_MCP_TOKEN   Bearer token that matches the MCP_AUTH_TOKEN setting
 *                         in the makeslide backend .env file.
 *
 * To use with Claude Code, add to ~/.claude/mcp_servers.json. Recommended: fetch this file
 * straight from GitHub on every launch and run it with tsx — this file has zero external
 * dependencies (only node:fs/node:readline/global fetch), so it never needs the rest of the
 * makeslide monorepo (and its native-module deps like better-sqlite3/canvas/sharp) installed
 * anywhere. Always pulls the latest master; nothing is cached, so a fresh copy is re-downloaded
 * on every MCP client start:
 *   {
 *     "makeslide": {
 *       "command": "sh",
 *       "args": [
 *         "-c",
 *         "curl -fsSL https://raw.githubusercontent.com/wycc/makeslide/master/backend/src/mcp-server.ts -o /tmp/makeslide-mcp-server.ts && exec npx -y tsx /tmp/makeslide-mcp-server.ts"
 *       ],
 *       "env": {
 *         "MAKESLIDE_URL": "http://localhost:3000",
 *         "MAKESLIDE_MCP_TOKEN": "<your-token>"
 *       }
 *     }
 *   }
 *
 * If you already have a local checkout (e.g. developing makeslide itself), running from it
 * directly is faster and works offline:
 *   {
 *     "makeslide": {
 *       "command": "node",
 *       "args": ["/path/to/makeslide/backend/dist/mcp-server.js"],
 *       "env": {
 *         "MAKESLIDE_URL": "http://localhost:3000",
 *         "MAKESLIDE_MCP_TOKEN": "<your-token>"
 *       }
 *     }
 *   }
 *
 * Or with tsx straight from source (no build step):
 *   {
 *     "makeslide": {
 *       "command": "npx",
 *       "args": ["--prefix", "/path/to/makeslide/backend", "tsx", "src/mcp-server.ts"],
 *       "env": { "MAKESLIDE_URL": "...", "MAKESLIDE_MCP_TOKEN": "..." }
 *     }
 *   }
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';

const BASE_URL = (process.env.MAKESLIDE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const AUTH_TOKEN = process.env.MAKESLIDE_MCP_TOKEN ?? '';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiGetText(path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.text();
}

async function apiPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiUploadPdf(filePath: string): Promise<unknown> {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });
  const form = new (globalThis.FormData)();
  form.append('file', blob, filePath.split('/').pop() ?? 'upload.pdf');
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(`${BASE_URL}/api/pdfs`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`POST /api/pdfs → ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Upload a plain-text presentation outline as a new presentation.
 * Mirrors the browser's TXT-import path: POST /api/pdfs as multipart/form-data
 * with a text/plain file. The backend stores the outline as the source text and
 * (later, during generation) lets the AI paginate + write per-page scripts.
 *
 * When `filename` is 'prompt-outline.txt' the backend defers the presentation
 * title to the AI; otherwise it derives the title from the filename.
 */
async function apiUploadText(text: string, filename: string): Promise<unknown> {
  const blob = new Blob([text], { type: 'text/plain' });
  const form = new (globalThis.FormData)();
  form.append('file', blob, filename);
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(`${BASE_URL}/api/pdfs`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`POST /api/pdfs → ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_presentations',
    description: '列出 makeslide 中所有的簡報（PDF）。回傳簡報 ID、標題與目前狀態。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_presentation',
    description: '取得指定簡報的詳細資訊，包括頁數、各頁內容摘要與影片 URL（若已生成）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID（從 list_presentations 取得）' },
      },
      required: ['id'],
    },
  },
  {
    name: 'upload_pdf',
    description: '上傳本機 PDF 檔案至 makeslide，建立新的簡報。回傳新簡報的 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '本機 PDF 檔案的完整路徑（絕對路徑）' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'upload_txt',
    description:
      '上傳純文字的簡報大綱，建立一份新的簡報（不需要 PDF）。回傳新簡報的 ID，狀態為 awaiting_prompt——' +
      '接著必須呼叫 define_prompt 指定風格並正式開始生成。\n\n' +
      '【大綱格式】建議使用以下逐頁結構（AI 會依此分頁並為每頁撰寫逐字稿）：\n' +
      '  Slide 1: 這一頁的標題\n' +
      '  - 重點一\n' +
      '  - 重點二\n' +
      '\n' +
      '  Slide 2: 下一頁的標題\n' +
      '  - 重點一\n' +
      '  - 重點二\n' +
      '  - 重點三\n' +
      '\n' +
      '規則：每頁以「Slide N: 標題」開頭，其下用「- 」列出 2～6 個重點；頁與頁之間空一行分隔；' +
      '建議 3～20 頁。也接受自由格式的純文字（AI 會自動分頁），但上述結構化格式分頁結果最穩定。',
    inputSchema: {
      type: 'object',
      properties: {
        outline: {
          type: 'string',
          description: '簡報大綱純文字內容（UTF-8）。格式見工具說明。',
        },
        title: {
          type: 'string',
          description: '選填：簡報標題。省略時由 AI 依大綱內容自動命名。',
        },
      },
      required: ['outline'],
    },
  },
  {
    name: 'define_prompt',
    description:
      '為一份 awaiting_prompt 狀態的簡報指定生成設定（簡報風格、圖片風格、逐字稿長度、單／雙人模式），' +
      '並正式啟動 AI 生成流程（腳本→語音→影像→影片）。這是讓 upload_txt／upload_pdf 建立的簡報真正開始生成的步驟。' +
      '呼叫後用 get_generation_status 輪詢進度。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID（從 upload_txt／upload_pdf／list_presentations 取得）' },
        style_prompt: {
          type: 'string',
          description:
            '選填：簡報整體風格／語氣提示詞（例如「專業商務、精簡有力」「輕鬆口語、面向國中生」）。最長 2000 字。',
        },
        image_style_prompt: {
          type: 'string',
          description:
            '選填：圖片／視覺風格提示詞（例如「扁平插畫、藍色系」「寫實照片風」「手繪塗鴉風」）。最長 8000 字。',
        },
        script_max_chars_per_page: {
          type: 'number',
          description:
            '選填：每頁逐字稿長度上限（字元數，80～2000）。用來控制口白長短——短講約 150、適中約 400、詳細約 800。省略則用系統預設。',
        },
        host_mode: {
          type: 'string',
          enum: ['solo', 'dual'],
          description: '選填：口白模式。solo＝單人主講（預設）；dual＝雙人對談。',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'start_generation',
    description:
      '啟動簡報的 AI 生成流程（腳本→語音→影像→影片）。可選擇只重新生成特定階段。' +
      '回傳任務狀態。生成通常需要數分鐘，請用 get_generation_status 輪詢進度。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        stages: {
          type: 'array',
          items: { type: 'string', enum: ['scripts', 'audio', 'images', 'animations'] },
          description: '選填：只重新生成這些階段（省略表示全部重新生成）',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_generation_status',
    description: '查詢簡報的最新生成任務狀態。回傳 status（pending/running/done/failed）、各階段進度與錯誤訊息。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_page_script',
    description: '讀取簡報某一頁的 AI 生成腳本（逐字稿）。在啟動生成前可用此工具確認或提取已有的腳本內容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
      },
      required: ['id', 'page'],
    },
  },
  {
    name: 'set_page_script',
    description: '覆寫簡報某一頁的腳本（逐字稿），最長 4096 字元。可在啟動 AI 生成前用此工具自訂各頁文案，之後再呼叫 start_generation 僅重新生成語音（stages: ["audio"]）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '簡報 ID' },
        page: { type: 'number', description: '頁碼（從 1 開始）' },
        script: { type: 'string', description: '腳本內容，最長 4096 字元' },
      },
      required: ['id', 'page', 'script'],
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'list_presentations') {
    const data = await apiGet('/api/pdfs') as { pdfs?: Array<{ id: string; title?: string; status?: string }> };
    const list = data.pdfs ?? (Array.isArray(data) ? data : []);
    if (!list.length) return '目前沒有任何簡報。';
    return list
      .map((p: { id: string; title?: string; status?: string }) =>
        `• ID: ${p.id}  標題: ${p.title ?? '（無標題）'}  狀態: ${p.status ?? '—'}`,
      )
      .join('\n');
  }

  if (name === 'get_presentation') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const data = await apiGet(`/api/pdfs/${encodeURIComponent(id)}`) as Record<string, unknown>;
    return JSON.stringify(data, null, 2);
  }

  if (name === 'upload_pdf') {
    const filePath = String(args.file_path ?? '');
    if (!filePath) throw new Error('缺少 file_path 參數');
    if (!fs.existsSync(filePath)) throw new Error(`找不到檔案：${filePath}`);
    const data = await apiUploadPdf(filePath) as { id?: string; title?: string };
    return `上傳成功！簡報 ID：${data.id ?? '（未知）'}，標題：${data.title ?? '（無標題）'}`;
  }

  if (name === 'upload_txt') {
    const outline = String(args.outline ?? '');
    if (!outline.trim()) throw new Error('缺少 outline 參數（大綱內容不可為空）');
    const rawTitle = String(args.title ?? '').trim();
    // 'prompt-outline.txt' 是後端「把標題交給 AI 產生」的約定檔名；
    // 有指定 title 時則用 <title>.txt 讓後端沿用該標題。
    const safeTitle = rawTitle.replace(/[/\\]/g, '_').slice(0, 120);
    const filename = safeTitle ? `${safeTitle}.txt` : 'prompt-outline.txt';
    const data = await apiUploadText(outline, filename) as { id?: string; title?: string; status?: string };
    return (
      `大綱上傳成功！簡報 ID：${data.id ?? '（未知）'}，標題：${data.title ?? '（將由 AI 命名）'}，` +
      `狀態：${data.status ?? '—'}。\n接著請呼叫 define_prompt（帶入此 ID）指定風格並開始生成。`
    );
  }

  if (name === 'define_prompt') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const stylePrompt = args.style_prompt !== undefined ? String(args.style_prompt) : undefined;
    const imageStylePrompt = args.image_style_prompt !== undefined ? String(args.image_style_prompt) : undefined;
    const hostMode = args.host_mode !== undefined ? String(args.host_mode) : undefined;
    let scriptMaxChars: number | undefined;
    if (args.script_max_chars_per_page !== undefined) {
      scriptMaxChars = Number(args.script_max_chars_per_page);
      if (!Number.isInteger(scriptMaxChars) || scriptMaxChars < 80 || scriptMaxChars > 2000) {
        throw new Error('script_max_chars_per_page 必須是 80～2000 的整數');
      }
    }
    if (hostMode !== undefined && hostMode !== 'solo' && hostMode !== 'dual') {
      throw new Error('host_mode 必須是 solo 或 dual');
    }

    // host_mode 不在 /start 的 body 中，需先透過 PATCH /script-settings 設定，
    // 且必須在啟動 pipeline 前完成（/start 會立即排入生成佇列）。
    if (hostMode !== undefined) {
      await apiPatch(`/api/pdfs/${encodeURIComponent(id)}/script-settings`, {
        script_max_chars_per_page: scriptMaxChars ?? null,
        host_mode: hostMode,
      });
    }

    const startBody: Record<string, unknown> = {};
    if (stylePrompt !== undefined) startBody.prompt = stylePrompt;
    if (imageStylePrompt !== undefined) startBody.image_style_prompt = imageStylePrompt;
    if (scriptMaxChars !== undefined) startBody.script_max_chars_per_page = scriptMaxChars;
    const data = await apiPost(`/api/pdfs/${encodeURIComponent(id)}/start`, startBody) as Record<string, unknown>;

    const settingLines = [
      `  簡報風格：${stylePrompt ? stylePrompt : '（預設）'}`,
      `  圖片風格：${imageStylePrompt ? imageStylePrompt : '（預設）'}`,
      `  逐字稿長度上限：${scriptMaxChars !== undefined ? `${scriptMaxChars} 字/頁` : '（預設）'}`,
      `  口白模式：${hostMode ?? '（維持原設定，預設 solo）'}`,
    ].join('\n');
    return (
      `設定已套用並啟動生成。\n${settingLines}\n狀態：${data.status ?? '—'}。\n` +
      `使用 get_generation_status（id: ${id}）查詢進度。`
    );
  }

  if (name === 'start_generation') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const stages = args.stages as string[] | undefined;
    const body: Record<string, unknown> = {};
    if (stages && stages.length > 0) {
      body.scripts  = stages.includes('scripts');
      body.audio     = stages.includes('audio');
      body.images    = stages.includes('images');
      body.animations = stages.includes('animations');
    }
    const data = await apiPost(`/api/pdfs/${encodeURIComponent(id)}/regenerate`, body) as Record<string, unknown>;
    return `生成任務已啟動。狀態：${data.status ?? '—'}。使用 get_generation_status 查詢進度。\n${JSON.stringify(data, null, 2)}`;
  }

  if (name === 'get_generation_status') {
    const id = String(args.id ?? '');
    if (!id) throw new Error('缺少 id 參數');
    const data = await apiGet(`/api/pdfs/${encodeURIComponent(id)}/regenerate/status`) as Record<string, unknown>;
    const status = String(data.status ?? '—');
    const steps = (data.steps as Array<{ name: string; status: string }> | undefined) ?? [];
    const summary = steps.map((s) => `  ${s.name}: ${s.status}`).join('\n') || '  （無步驟資訊）';
    return `狀態：${status}\n階段進度：\n${summary}\n\n詳細資訊：\n${JSON.stringify(data, null, 2)}`;
  }

  if (name === 'get_page_script') {
    const id = String(args.id ?? '');
    const page = Number(args.page ?? 0);
    if (!id) throw new Error('缺少 id 參數');
    if (!Number.isInteger(page) || page < 1) throw new Error('page 必須是正整數');
    const text = await apiGetText(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/script`);
    return text || '（此頁腳本為空）';
  }

  if (name === 'set_page_script') {
    const id = String(args.id ?? '');
    const page = Number(args.page ?? 0);
    const script = String(args.script ?? '');
    if (!id) throw new Error('缺少 id 參數');
    if (!Number.isInteger(page) || page < 1) throw new Error('page 必須是正整數');
    if (script.length > 4096) throw new Error('script 不可超過 4096 字元');
    await apiPut(`/api/pdfs/${encodeURIComponent(id)}/pages/${page}/script`, { script });
    return `第 ${page} 頁腳本已更新（${script.length} 字元）。`;
  }

  throw new Error(`未知工具：${name}`);
}

// ── MCP stdio transport ────────────────────────────────────────────────────────

function sendMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function respond(id: string | number, result: unknown): void {
  sendMessage({ jsonrpc: '2.0', id, result });
}

function respondError(id: string | number, code: number, message: string): void {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: { jsonrpc: string; id?: string | number; method: string; params?: unknown };
  try {
    request = JSON.parse(trimmed);
  } catch {
    return; // ignore malformed JSON
  }

  const { id, method, params } = request;

  if (method === 'initialize') {
    respond(id!, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'makeslide', version: '1.0.0' },
    });
  } else if (method === 'initialized') {
    // notification — no response
  } else if (method === 'ping') {
    if (id !== undefined) respond(id, {});
  } else if (method === 'tools/list') {
    respond(id!, { tools: TOOLS });
  } else if (method === 'tools/call') {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const toolName = p?.name ?? '';
    const toolArgs = p?.arguments ?? {};
    callTool(toolName, toolArgs)
      .then((text) => {
        respond(id!, { content: [{ type: 'text', text }] });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        respond(id!, { content: [{ type: 'text', text: `錯誤：${msg}` }], isError: true });
      });
  } else if (id !== undefined) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

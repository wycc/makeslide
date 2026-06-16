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
 * To use with Claude Code, add to ~/.claude/mcp_servers.json:
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
 * Or with tsx for development:
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

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
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

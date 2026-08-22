/**
 * End-to-end tests for the MCP page-figure tools (`get_page_figures`,
 * `set_page_figure_selection`, `save_page_figure_image`).
 *
 * Driven over the real stdio transport for the same reason as mcp-page-assets.test.ts:
 * `mcp-server.ts` talks HTTP, so `app.inject()` cannot reach it.
 *
 * Figures are produced by the PDF-extraction worker step, not by any MCP-reachable action, so
 * this file seeds a `figures.json` manifest directly on disk (same shape as figure-assets.test.ts)
 * rather than driving a real upload+extraction pipeline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-figures-account';
const TOKEN = 'mcp-figures-test-token';

setSystemAuthSettings({ googleAuthEnabled: false });

interface McpClient {
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  callExpectingError(tool: string, args: Record<string, unknown>): Promise<string>;
  close(): void;
}

function startMcpServer(baseUrl: string): McpClient {
  const serverPath = fileURLToPath(new URL('../src/mcp-server.ts', import.meta.url));
  const tsxBin = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
  const child = spawn(tsxBin, [serverPath], {
    env: { ...process.env, MAKESLIDE_URL: baseUrl, MAKESLIDE_MCP_TOKEN: TOKEN },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  const pending = new Map<number, (msg: { result?: unknown }) => void>();
  let nextId = 1;
  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    if (!line.trim()) return;
    let msg: { id?: number; result?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') pending.get(msg.id)?.(msg);
  });

  function request(method: string, params?: unknown): Promise<{ result?: unknown }> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP request timed out: ${method}`)), 30_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async function rawCall(tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const msg = await request('tools/call', { name: tool, arguments: args });
    const result = msg.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
    return { text: result?.content?.[0]?.text ?? '', isError: result?.isError === true };
  }

  return {
    async call(tool, args) {
      const { text, isError } = await rawCall(tool, args);
      assert.equal(isError, false, `${tool} 不應失敗，但回了：${text}`);
      return text;
    },
    async callExpectingError(tool, args) {
      const { text, isError } = await rawCall(tool, args);
      assert.equal(isError, true, `${tool} 應該失敗，但成功了：${text}`);
      return text;
    },
    close() {
      child.kill();
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Seeds a ready one-page PDF owned by ACCOUNT with a two-figure manifest for page 1. */
function seedFigurePdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,?,'private',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', ACCOUNT, t, t);

  const pdfDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfDir, 'pages');
  const figuresDir = path.join(pdfDir, 'figures');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(figuresDir, { recursive: true });
  const uid = 'figpage1';
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
     VALUES (?,1,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
  ).run(pdfId, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));

  fs.writeFileSync(path.join(figuresDir, 'p1-large.png'), Buffer.from([137, 80, 78, 71, 1]));
  fs.writeFileSync(path.join(figuresDir, 'p1-small.png'), Buffer.from([137, 80, 78, 71, 2]));

  fs.writeFileSync(
    path.join(pdfDir, 'figures.json'),
    JSON.stringify({
      pdfId,
      generatedAt: t,
      pages: [
        {
          pageNumber: 1,
          figures: [
            {
              id: 'p1-large',
              imagePath: 'figures/p1-large.png',
              width: 200,
              height: 200,
              bbox: { xPct: 0.1, yPct: 0.1, widthPct: 0.6, heightPct: 0.6 },
              caption: 'Figure 1: 營收成長',
              context: 'Figure 1: 營收成長，2020-2025',
            },
            {
              id: 'p1-small',
              imagePath: 'figures/p1-small.png',
              width: 50,
              height: 50,
              bbox: { xPct: 0.7, yPct: 0.7, widthPct: 0.1, heightPct: 0.1 },
              caption: null,
              context: null,
            },
          ],
        },
      ],
    }),
    'utf8',
  );
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('MCP page-figure tools list, exclude, and save figure assets over stdio', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const pdfId = 'test-mcp-figures-01';
  cleanup(pdfId);
  seedFigurePdf(pdfId);

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-figures-'));

  t.after(async () => {
    mcp.close();
    await app.close();
    cleanup(pdfId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('get_page_figures lists both figures, neither excluded', async () => {
    const text = await mcp.call('get_page_figures', { id: pdfId, page: 1 });
    assert.match(text, /p1-large/);
    assert.match(text, /p1-small/);
    assert.match(text, /共 2 筆/);
    assert.match(text, /排除：否/);
    assert.doesNotMatch(text, /排除：是/);
  });

  await t.test('set_page_figure_selection excludes a figure, reflected by a later get', async () => {
    const text = await mcp.call('set_page_figure_selection', { id: pdfId, page: 1, excluded: ['p1-large'] });
    assert.match(text, /已排除 1 張/);
    assert.match(text, /p1-large/);

    const listed = await mcp.call('get_page_figures', { id: pdfId, page: 1 });
    const largeLine = listed.split('\n').find((l) => l.includes('p1-large'));
    const smallLine = listed.split('\n').find((l) => l.includes('p1-small'));
    assert.match(largeLine!, /排除：是/);
    assert.match(smallLine!, /排除：否/);
  });

  await t.test('set_page_figure_selection with an empty array clears exclusions', async () => {
    const text = await mcp.call('set_page_figure_selection', { id: pdfId, page: 1, excluded: [] });
    assert.match(text, /已清空/);
    const listed = await mcp.call('get_page_figures', { id: pdfId, page: 1 });
    assert.doesNotMatch(listed, /排除：是/);
  });

  await t.test('save_page_figure_image writes the figure PNG bytes to disk', async () => {
    const out = path.join(tmpDir, 'figure.png');
    const text = await mcp.call('save_page_figure_image', { id: pdfId, figure_id: 'p1-large', file_path: out });
    assert.match(text, /已存到/);
    assert.deepEqual(fs.readFileSync(out), Buffer.from([137, 80, 78, 71, 1]));
  });

  await t.test('save_page_figure_image reports an unknown figure id clearly', async () => {
    const text = await mcp.callExpectingError('save_page_figure_image', {
      id: pdfId,
      figure_id: 'does-not-exist',
      file_path: path.join(tmpDir, 'missing.png'),
    });
    assert.match(text, /FIGURE_NOT_FOUND|找不到/);
  });

  await t.test('get_page_figures reports an unknown page clearly', async () => {
    const text = await mcp.callExpectingError('get_page_figures', { id: pdfId, page: 99 });
    assert.match(text, /PAGE_NOT_FOUND|找不到這一頁/);
  });

  await t.test('a deck with no extracted figures says so', async () => {
    const blank = await mcp.call('create_blank_deck', { title: '無圖表測試' });
    const blankId = /ID：(\S+)/.exec(blank)![1]!;
    try {
      const text = await mcp.call('get_page_figures', { id: blankId, page: 1 });
      assert.match(text, /沒有偵測到任何圖表素材/);
    } finally {
      db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(blankId);
      db.prepare('DELETE FROM pdfs WHERE id = ?').run(blankId);
      fs.rmSync(path.join(config.storageRoot, blankId), { recursive: true, force: true });
    }
  });
});

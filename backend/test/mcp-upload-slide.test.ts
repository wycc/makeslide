/**
 * End-to-end test for the MCP `upload_slide` tool: a structured-JSON alternative to `upload_txt`
 * whose array index is guaranteed to be the final page_number (no AI re-pagination), so a local
 * reference image attached to a slide lands on the right page.
 *
 * Driven over the real stdio transport for the same reason as mcp-page-assets.test.ts:
 * `mcp-server.ts` talks HTTP, so `app.inject()` cannot reach it.
 *
 * Does NOT verify that a real generation run actually passes the reference image to the AI
 * image API — that needs a real provider API key the test environment doesn't have (same
 * trade-off as mcp-page-assets.test.ts's regenerate_page_image coverage). What IS verified is
 * that the created deck's data is wired up correctly for that to happen: the pre-existing
 * `get_page_figures` MCP tool (built for PDF-extracted figures) must see the uploaded reference
 * image unmodified, proving upload_slide's storage format is compatible with the rest of the
 * figure-reference system without any changes to it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import sharp from 'sharp';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-upload-slide-account';
const TOKEN = 'mcp-upload-slide-test-token';

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

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdf_sources WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('upload_slide creates pages in array order and get_page_figures sees the attached reference image', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-upload-slide-'));

  let pdfId = '';
  t.after(async () => {
    mcp.close();
    await app.close();
    if (pdfId) cleanup(pdfId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  const refPath = path.join(tmpDir, 'ref.png');
  await sharp({ create: { width: 6, height: 6, channels: 3, background: { r: 30, g: 60, b: 200 } } })
    .png()
    .toFile(refPath);

  await t.test('upload_slide creates the deck', async () => {
    const text = await mcp.call('upload_slide', {
      title: 'MCP 結構化大綱測試',
      slides: [
        { title: '第一頁', bullets: ['重點A'], reference_image_paths: [refPath] },
        { title: '第二頁', bullets: ['重點B', '重點C'], summary: '補充摘要文字' },
      ],
    });
    pdfId = /ID：(\S+?)，/.exec(text)![1]!;
    assert.ok(pdfId);
    assert.match(text, /awaiting_prompt/);
    assert.match(text, /頁數：2/);
    assert.match(text, /第 1 頁已附上參考圖/);
  });

  await t.test('pages were created in array order with pending status', async () => {
    const pages = db
      .prepare(`SELECT page_number, status FROM pages WHERE pdf_id = ? ORDER BY page_number`)
      .all(pdfId) as Array<{ page_number: number; status: string }>;
    assert.deepEqual(
      pages.map((p) => p.page_number),
      [1, 2],
    );
    assert.ok(pages.every((p) => p.status === 'pending'));
  });

  await t.test('get_page_figures (built for PDF-extracted figures) sees the uploaded reference on page 1', async () => {
    const text = await mcp.call('get_page_figures', { id: pdfId, page: 1 });
    assert.match(text, /共 1 筆/);
    assert.match(text, /排除：否/);
  });

  await t.test('page 2 has no figures', async () => {
    const text = await mcp.call('get_page_figures', { id: pdfId, page: 2 });
    assert.match(text, /沒有偵測到任何圖表素材/);
  });

  await t.test('upload_slide rejects a missing local reference file', async () => {
    const text = await mcp.callExpectingError('upload_slide', {
      slides: [{ title: '單頁', bullets: [], reference_image_paths: [path.join(tmpDir, 'missing.png')] }],
    });
    assert.match(text, /找不到檔案/);
  });

  await t.test('upload_slide rejects an empty slides array', async () => {
    const text = await mcp.callExpectingError('upload_slide', { slides: [] });
    assert.match(text, /至少一個元素/);
  });
});

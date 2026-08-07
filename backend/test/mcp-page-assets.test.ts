/**
 * End-to-end tests for the MCP per-page asset tools (phase 2 of the agent-authoring plan).
 *
 * Driven over the real stdio transport for the same reason as mcp-page-crud.test.ts:
 * `mcp-server.ts` talks HTTP, so `app.inject()` cannot reach it.
 *
 * What is deliberately NOT covered: the success paths of `regenerate_page_image`,
 * `rewrite_page_script`, and `regenerate_page_audio`. All three call a real model provider, and
 * there is no API key in the test environment. What IS covered is everything around them that
 * can break without anyone noticing — argument validation, the image round trip, and above all
 * `apply_image_candidate`, whose two-step download-then-reupload flow is assembled in this file
 * rather than provided by the backend. That flow is exercised by planting a candidate file on
 * disk, which skips the model call while still running the exact code path a real regeneration
 * would take afterwards.
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
import { safeJoinPdfPath } from '../src/services/storage';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-page-assets-account';
const TOKEN = 'mcp-page-assets-test-token';

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

function pageUid(pdfId: string, page: number): string {
  const row = db.prepare('SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = ?').get(pdfId, page) as
    | { page_uid: string }
    | undefined;
  assert.ok(row, `找不到第 ${page} 頁`);
  return row.page_uid;
}

/** A solid-colour JPEG of the given size — small, decodable by sharp, and distinguishable by colour. */
async function makeJpeg(width: number, height: number, rgb: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: rgb } })
    .jpeg()
    .toBuffer();
}

/** Average colour of an image, used to prove which picture actually landed on the page. */
async function dominantColour(file: string): Promise<{ r: number; g: number; b: number }> {
  const { data } = await sharp(file).resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

test('MCP per-page asset tools drive one page end to end over stdio', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-assets-'));

  let deckId = '';
  t.after(async () => {
    mcp.close();
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('setup: create a deck to work on', async () => {
    const text = await mcp.call('create_blank_deck', { title: '資產測試' });
    deckId = /ID：(\S+)/.exec(text)![1]!;
    assert.ok(deckId);
  });

  await t.test('page prompt round-trips and says the image did not change', async () => {
    const saved = await mcp.call('set_page_prompt', { id: deckId, page: 1, prompt: '藍色系的扁平插畫，一棵樹' });
    // The distinction between "prompt updated" and "image regenerated" is the one an agent is
    // most likely to conflate, so the tool has to state it and keep stating it.
    assert.match(saved, /畫面還沒有跟著變/);
    assert.match(saved, /regenerate_page_image/);
    const read = await mcp.call('get_page_prompt', { id: deckId, page: 1 });
    assert.equal(read.trim(), '藍色系的扁平插畫，一棵樹');
  });

  await t.test('save_page_image writes the current slide to disk', async () => {
    const out = path.join(tmpDir, 'page1.jpg');
    const text = await mcp.call('save_page_image', { id: deckId, page: 1, file_path: out });
    assert.match(text, /已存到/);
    assert.ok(fs.statSync(out).size > 0);
    // Must be a real decodable image, not an error page saved under a .jpg name.
    const meta = await sharp(out).metadata();
    assert.ok(meta.width && meta.height);
  });

  await t.test('replace_page_image swaps in a local file', async () => {
    const src = path.join(tmpDir, 'red.jpg');
    fs.writeFileSync(src, await makeJpeg(640, 360, { r: 220, g: 20, b: 20 }));
    await mcp.call('replace_page_image', { id: deckId, page: 1, file_path: src });

    const out = path.join(tmpDir, 'after-replace.jpg');
    await mcp.call('save_page_image', { id: deckId, page: 1, file_path: out });
    const meta = await sharp(out).metadata();
    // The backend normalises whatever it is given to 1920x1080.
    assert.equal(meta.width, 1920);
    assert.equal(meta.height, 1080);
    const colour = await dominantColour(out);
    assert.ok(colour.r > 150 && colour.g < 100, `換上去的應該是紅色圖，實際為 ${JSON.stringify(colour)}`);
  });

  await t.test('apply_image_candidate promotes a candidate to the real slide image', async () => {
    // Plant a candidate exactly where regenerate-image would write one. This skips the model
    // call while still exercising the download-then-reupload flow that promotes it — the part
    // this file assembles itself, and therefore the part most likely to be wrong.
    const candidateId = 'testcand01';
    const rel = path.posix.join('pages', `001.candidate.${candidateId}.jpg`);
    fs.writeFileSync(safeJoinPdfPath(deckId, rel), await makeJpeg(800, 450, { r: 20, g: 200, b: 20 }));

    const text = await mcp.call('apply_image_candidate', { id: deckId, page: 1, candidate_id: candidateId });
    assert.match(text, /已套用/);

    const out = path.join(tmpDir, 'after-apply.jpg');
    await mcp.call('save_page_image', { id: deckId, page: 1, file_path: out });
    const colour = await dominantColour(out);
    assert.ok(colour.g > 150 && colour.r < 100, `套用後應該是綠色圖，實際為 ${JSON.stringify(colour)}`);

    // The page's own image file changed on disk, not just whatever the API happened to serve.
    const onDisk = await dominantColour(safeJoinPdfPath(deckId, `pages/${pageUid(deckId, 1)}.jpg`));
    assert.ok(onDisk.g > 150 && onDisk.r < 100);
  });

  await t.test('save_page_image can fetch a candidate instead of the live image', async () => {
    const candidateId = 'testcand02';
    const rel = path.posix.join('pages', `001.candidate.${candidateId}.jpg`);
    fs.writeFileSync(safeJoinPdfPath(deckId, rel), await makeJpeg(800, 450, { r: 20, g: 20, b: 220 }));
    const out = path.join(tmpDir, 'candidate.jpg');
    await mcp.call('save_page_image', { id: deckId, page: 1, file_path: out, candidate_id: candidateId });
    const colour = await dominantColour(out);
    assert.ok(colour.b > 150, `應該取到藍色候選圖，實際為 ${JSON.stringify(colour)}`);
    // ...and the live image is untouched: fetching a candidate must never promote it.
    const live = path.join(tmpDir, 'still-green.jpg');
    await mcp.call('save_page_image', { id: deckId, page: 1, file_path: live });
    const liveColour = await dominantColour(live);
    assert.ok(liveColour.g > 150, '取候選圖不應該動到正式圖片');
  });

  await t.test('set_tts_settings persists and warns that existing audio is unchanged', async () => {
    const text = await mcp.call('set_tts_settings', { id: deckId, tts_voice: 'nova', tts_speed: 1.25 });
    assert.match(text, /既有的語音檔仍是舊設定產生的/);
    const row = db.prepare('SELECT tts_voice, tts_speed FROM pdfs WHERE id = ?').get(deckId) as {
      tts_voice: string;
      tts_speed: number;
    };
    assert.deepEqual(row, { tts_voice: 'nova', tts_speed: 1.25 });
  });

  await t.test('set_tts_settings rejects an out-of-range speed before sending anything', async () => {
    const text = await mcp.callExpectingError('set_tts_settings', { id: deckId, tts_voice: 'nova', tts_speed: 9 });
    assert.match(text, /0\.25～4/);
    const row = db.prepare('SELECT tts_speed FROM pdfs WHERE id = ?').get(deckId) as { tts_speed: number };
    assert.equal(row.tts_speed, 1.25, '被拒絕的設定不應該寫進資料庫');
  });

  await t.test('regenerate_page_audio refuses when the page has no script to speak', async () => {
    // A blank page has an empty script file. Catching this locally matters because the
    // alternative is a paid TTS call that synthesises nothing.
    const text = await mcp.callExpectingError('regenerate_page_audio', { id: deckId, page: 1 });
    assert.match(text, /沒有逐字稿/);
  });

  await t.test('replace_page_image reports a missing local file clearly', async () => {
    const text = await mcp.callExpectingError('replace_page_image', {
      id: deckId,
      page: 1,
      file_path: path.join(tmpDir, 'does-not-exist.jpg'),
    });
    assert.match(text, /找不到檔案/);
  });

  await t.test('get_page_prompt explains an empty prompt rather than returning nothing', async () => {
    await mcp.call('add_page', { id: deckId, after_page_number: 1 });
    const text = await mcp.call('get_page_prompt', { id: deckId, page: 2 });
    assert.match(text, /還沒有圖片提示詞/);
  });
});

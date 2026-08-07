/**
 * End-to-end tests for the MCP notebook tools (phase 3 of the agent-authoring plan), plus the
 * backend endpoint they needed: POST /api/pdfs/:id/pages/:n/convert-to-slide.
 *
 * That endpoint is the only genuinely new backend code in the whole plan. Before it,
 * `render_type` was one-way — `writeNotebookForPage()` hard-codes 'notebook' and nothing
 * anywhere set it back — so a page converted to a notebook could never be a slide again. The
 * tests below therefore care most about the round trip actually being a round trip: the notebook
 * survives, the animation render type comes back, and the deck's audio total is restored.
 *
 * `generate_page_notebook` is not covered: it calls a model provider and there is no API key in
 * the test environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { pageNotebookPath } from '../src/services/storage';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-notebook-account';
const TOKEN = 'mcp-notebook-test-token';

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

function pageRow(pdfId: string, page: number): { page_uid: string; render_type: string | null; notebook_path: string | null } {
  return db
    .prepare('SELECT page_uid, render_type, notebook_path FROM pages WHERE pdf_id = ? AND page_number = ?')
    .get(pdfId, page) as { page_uid: string; render_type: string | null; notebook_path: string | null };
}

function deckAudioTotal(pdfId: string): number {
  const row = db.prepare('SELECT total_audio_duration_seconds FROM pdfs WHERE id = ?').get(pdfId) as {
    total_audio_duration_seconds: number | null;
  };
  return row.total_audio_duration_seconds ?? 0;
}

/** Extract the JSON body a notebook tool appends after its human-readable header line. */
function parseNotebookFromToolOutput(text: string): { cells: Array<{ cell_type: string; source: string }> } {
  const start = text.indexOf('{');
  assert.ok(start >= 0, `工具輸出中找不到 JSON：${text}`);
  return JSON.parse(text.slice(start));
}

test('MCP notebook tools convert a page to a notebook and back', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);

  let deckId = '';
  t.after(async () => {
    mcp.close();
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('setup: create a two-page deck with audio on page 1', async () => {
    deckId = /ID：(\S+)/.exec(await mcp.call('create_blank_deck', { title: 'notebook 測試' }))![1]!;
    await mcp.call('add_page', { id: deckId, after_page_number: 1 });
    // Give page 1 a duration so the notebook conversion's effect on the deck total is visible.
    db.prepare('UPDATE pages SET audio_duration_seconds = 12 WHERE pdf_id = ? AND page_number = 1').run(deckId);
    db.prepare('UPDATE pdfs SET total_audio_duration_seconds = 12 WHERE id = ?').run(deckId);
  });

  await t.test('get_page_notebook says the page is not a notebook yet', async () => {
    const text = await mcp.call('get_page_notebook', { id: deckId, page: 1 });
    // The backend hands back a default notebook for any page, so "I got cells" must not be
    // mistaken for "this page is a notebook".
    assert.match(text, /還不是.*notebook 頁/);
    assert.equal(pageRow(deckId, 1).render_type, 'static-image');
  });

  await t.test('a POST with no body reaches the route instead of being rejected as empty JSON', async () => {
    // Declaring Content-Type: application/json on a body-less POST makes Fastify reject it with
    // FST_ERR_CTP_EMPTY_JSON_BODY before the route ever runs. Both convert_page_to_slide and
    // cancel_add_pages send exactly that shape of request, so this pins the header handling on
    // the cheaper of the two: with no job running the route itself answers INVALID_STATE, which
    // is only reachable if the request actually got there.
    const text = await mcp.callExpectingError('cancel_add_pages', { id: deckId });
    assert.match(text, /INVALID_STATE/);
    assert.doesNotMatch(text, /EMPTY_JSON_BODY/);
  });

  await t.test('set_page_notebook writes the document and converts the page', async () => {
    const notebook = {
      cells: [
        { cell_type: 'markdown', source: '# 標題', metadata: {} },
        { cell_type: 'code', source: 'print(1)', metadata: {}, outputs: [], execution_count: null },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    };
    const text = await mcp.call('set_page_notebook', { id: deckId, page: 1, notebook });
    assert.match(text, /2 個 cell/);

    const row = pageRow(deckId, 1);
    assert.equal(row.render_type, 'notebook');
    assert.ok(fs.existsSync(pageNotebookPath(deckId, row.page_uid)));
    // A notebook page plays no audio, so the deck total drops page 1's 12 seconds.
    assert.equal(deckAudioTotal(deckId), 0);
  });

  await t.test('passthrough fields survive a read-modify-write cycle', async () => {
    // The backend preserves unknown fields on purpose; edit_notebook_cells reads the whole
    // document and writes it back, which is exactly where they would get dropped.
    await mcp.call('edit_notebook_cells', {
      id: deckId,
      page: 1,
      operation: 'append',
      cell_type: 'markdown',
      source: '結尾',
    });
    const stored = JSON.parse(fs.readFileSync(pageNotebookPath(deckId, pageRow(deckId, 1).page_uid), 'utf8'));
    assert.deepEqual(stored.metadata.kernelspec, { name: 'python3' }, 'metadata.kernelspec 不應該在往返中消失');
  });

  await t.test('edit_notebook_cells inserts, replaces, and deletes by index', async () => {
    await mcp.call('edit_notebook_cells', {
      id: deckId,
      page: 1,
      operation: 'insert',
      index: 0,
      cell_type: 'markdown',
      source: '開場',
    });
    let cells = parseNotebookFromToolOutput(await mcp.call('get_page_notebook', { id: deckId, page: 1 })).cells;
    assert.equal(cells.length, 4);
    assert.equal(cells[0]!.source, '開場');

    const replaced = await mcp.call('edit_notebook_cells', {
      id: deckId,
      page: 1,
      operation: 'replace',
      index: 1,
      cell_type: 'markdown',
      source: '# 換過的標題',
    });
    assert.match(replaced, /執行結果已清除/);

    await mcp.call('edit_notebook_cells', { id: deckId, page: 1, operation: 'delete', index: 3 });
    cells = parseNotebookFromToolOutput(await mcp.call('get_page_notebook', { id: deckId, page: 1 })).cells;
    assert.equal(cells.length, 3);
    assert.equal(cells[1]!.source, '# 換過的標題');
  });

  await t.test('edit_notebook_cells rejects an out-of-range index with the actual count', async () => {
    const text = await mcp.callExpectingError('edit_notebook_cells', {
      id: deckId,
      page: 1,
      operation: 'replace',
      index: 99,
      cell_type: 'code',
      source: 'x',
    });
    assert.match(text, /index 超出範圍/);
    assert.match(text, /3 個 cell/, '錯誤訊息應該講出實際的 cell 數，agent 才知道該用什麼 index');
  });

  await t.test('convert_page_to_slide restores the page and its audio, keeping the notebook', async () => {
    const uid = pageRow(deckId, 1).page_uid;
    const before = fs.readFileSync(pageNotebookPath(deckId, uid), 'utf8');

    const text = await mcp.call('convert_page_to_slide', { id: deckId, page: 1 });
    assert.match(text, /一般投影片/);

    const row = pageRow(deckId, 1);
    assert.equal(row.render_type, 'static-image');
    assert.equal(row.notebook_path, null);
    // The whole point of the endpoint: the .ipynb stays, so the conversion is reversible.
    assert.equal(fs.readFileSync(pageNotebookPath(deckId, uid), 'utf8'), before);
    // The page can play audio again, so its 12 seconds come back into the deck total.
    assert.equal(deckAudioTotal(deckId), 12);
  });

  await t.test('converting back finds the notebook content still there', async () => {
    const uid = pageRow(deckId, 1).page_uid;
    await mcp.call('edit_notebook_cells', {
      id: deckId,
      page: 1,
      operation: 'append',
      cell_type: 'code',
      source: 'print(2)',
    });
    assert.equal(pageRow(deckId, 1).render_type, 'notebook');
    const cells = parseNotebookFromToolOutput(await mcp.call('get_page_notebook', { id: deckId, page: 1 })).cells;
    // Not a fresh default notebook — the three cells from before the conversion are still here.
    assert.equal(cells.length, 4);
    assert.equal(cells[1]!.source, '# 換過的標題');
    assert.ok(fs.existsSync(pageNotebookPath(deckId, uid)));
  });

  await t.test('convert_page_to_slide restores an animated page as gsap-image', async () => {
    // Page 2: give it an animation, turn it into a notebook, then convert back. Hard-coding
    // 'static-image' on the way back would silently strip the animation while leaving its spec
    // file on disk.
    const specResp = await app.inject({
      method: 'PUT',
      url: `/api/pdfs/${deckId}/pages/2/animation`,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: {
        spec: {
          version: 1,
          enabled: true,
          effects: [{ id: 'e1', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' }],
        },
      },
    });
    assert.equal(specResp.statusCode, 200);
    assert.equal(pageRow(deckId, 2).render_type, 'gsap-image');

    await mcp.call('set_page_notebook', {
      id: deckId,
      page: 2,
      notebook: { cells: [{ cell_type: 'code', source: 'pass', metadata: {}, outputs: [], execution_count: null }] },
    });
    assert.equal(pageRow(deckId, 2).render_type, 'notebook');

    const text = await mcp.call('convert_page_to_slide', { id: deckId, page: 2 });
    assert.match(text, /有動畫的投影片/);
    assert.equal(pageRow(deckId, 2).render_type, 'gsap-image');
  });

  await t.test('convert_page_to_slide refuses a page that is not a notebook', async () => {
    const text = await mcp.callExpectingError('convert_page_to_slide', { id: deckId, page: 2 });
    assert.match(text, /INVALID_STATE/);
    assert.equal(pageRow(deckId, 2).render_type, 'gsap-image', '被拒絕的轉換不應該動到頁面型別');
  });
});

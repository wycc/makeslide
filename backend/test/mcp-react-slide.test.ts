/**
 * End-to-end tests for the MCP React-slide tools.
 *
 * Before these, MCP could turn a page into a notebook and back but knew nothing about React
 * pages: an agent could read and write `.ipynb` documents while the JSX that draws a React slide
 * was reachable only from the browser. The four tools under test close that gap, so what matters
 * here is that they behave like the notebook ones — the page type really changes, the code really
 * lands on disk, and nothing is deleted on the way back.
 *
 * Two things shape how these tests are written:
 *
 *  1. **Entering React mode needs a browser.** The PUT route refuses the conversion when this
 *     deployment cannot bake (docs/page-overlay-and-fusion.md §3.2), and the test runner disables
 *     baking on purpose. Rather than skipping, the test asserts whichever behaviour is correct for
 *     the environment it is running in — the refusal must name the page type it left alone, and
 *     the success must actually flip `render_type`.
 *  2. **Editing a page that is already a React slide is not gated**, which is the case the tools
 *     exist for. The page is put into React mode directly through `writeReactSlideForPage()` so
 *     that case is covered whether or not a Chrome is present.
 *
 * `generate_page_react_slide` is not covered: it calls a model provider and there is no API key in
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
import { pageReactSlideSourcePath } from '../src/services/storage';
import { MAX_REACT_SLIDE_CODE_LENGTH, MAX_REACT_SLIDE_PROMPT_LENGTH } from '../src/services/reactSlide';
import { validateAndCompileReactSlide } from '../src/services/reactSlide';
import { writeReactSlideForPage } from '../src/services/reactSlidePage';
import { bakeAvailability } from '../src/services/reactSlideBake';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-react-slide-account';
const TOKEN = 'mcp-react-slide-test-token';

setSystemAuthSettings({ googleAuthEnabled: false });

const SLIDE_CODE = `function Slide() {
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--slide-bg)', color: 'var(--slide-fg)' }}>
      <h1 style={{ fontFamily: 'var(--slide-font-heading)' }}>MCP 寫進來的標題</h1>
    </div>
  );
}
window.SlideComponent = Slide;
`;

interface McpClient {
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  callExpectingError(tool: string, args: Record<string, unknown>): Promise<string>;
  listTools(): Promise<string[]>;
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
    async listTools() {
      const msg = await request('tools/list');
      const result = msg.result as { tools?: Array<{ name?: string }> } | undefined;
      return (result?.tools ?? []).map((tool) => tool.name ?? '');
    },
    close() {
      child.kill();
    },
  };
}

function pageRow(pdfId: string, page: number): { page_uid: string; render_type: string | null; react_slide_path: string | null } {
  return db
    .prepare('SELECT page_uid, render_type, react_slide_path FROM pages WHERE pdf_id = ? AND page_number = ?')
    .get(pdfId, page) as { page_uid: string; render_type: string | null; react_slide_path: string | null };
}

/** Make a page a React slide without going through the API, so the gated PUT is not in the way. */
async function forceIntoReactMode(pdfId: string, page: number, code: string): Promise<void> {
  const validation = await validateAndCompileReactSlide(code);
  assert.ok(validation.ok && validation.compiled, `測試用的程式碼本身應該編得過：${validation.message}`);
  await writeReactSlideForPage(pdfId, page, pageRow(pdfId, page).page_uid, code, validation.compiled!, new Date().toISOString());
}

test('MCP React slide tools read, write and revert a React page', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);
  const canBake = (await bakeAvailability()).available;

  let deckId = '';
  t.after(async () => {
    mcp.close();
    await app.close();
    if (deckId) db.prepare('DELETE FROM pdfs WHERE id = ?').run(deckId);
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('setup: create a two-page deck', async () => {
    deckId = /ID：(\S+)/.exec(await mcp.call('create_blank_deck', { title: 'React 投影片測試' }))![1]!;
    await mcp.call('add_page', { id: deckId, after_page_number: 1 });
    assert.equal(pageRow(deckId, 1).render_type, 'static-image');
  });

  await t.test('the four React tools are advertised', async () => {
    // tools/list is what an agent actually reads; a tool implemented but not listed is invisible.
    const names = await mcp.listTools();
    for (const tool of [
      'get_page_react_slide',
      'set_page_react_slide',
      'generate_page_react_slide',
      'convert_react_page_to_slide',
    ]) {
      assert.ok(names.includes(tool), `tools/list 應該包含 ${tool}`);
    }
  });

  await t.test('get_page_react_slide says the page is not a React page yet', async () => {
    const text = await mcp.call('get_page_react_slide', { id: deckId, page: 1 });
    // The backend hands back the default skeleton for any page, so "I got code" must not be
    // mistaken for "this page is a React slide" — the next call would overwrite something else.
    assert.match(text, /還不是.*React 頁/);
    assert.match(text, /window\.SlideComponent/, '骨架程式碼本身應該一併回傳');
    assert.match(text, /投影片主題/, '主題要一起給，否則寫出來的頁面跟其他頁長得不一樣');
    assert.equal(pageRow(deckId, 1).render_type, 'static-image', '讀取不應該改變頁面型別');
  });

  await t.test('set_page_react_slide refuses code that never assigns window.SlideComponent', async () => {
    // Refused inside the tool, before the request: the backend's own message talks about the
    // assignment too, but a round trip is not needed to notice a missing line.
    const text = await mcp.callExpectingError('set_page_react_slide', {
      id: deckId,
      page: 1,
      code: 'function Slide() { return <div />; }',
    });
    assert.match(text, /window\.SlideComponent/);
    assert.equal(pageRow(deckId, 1).render_type, 'static-image');
  });

  await t.test('set_page_react_slide refuses empty code', async () => {
    const text = await mcp.callExpectingError('set_page_react_slide', { id: deckId, page: 1, code: '   ' });
    assert.match(text, /不可為空/);
  });

  await t.test('entering React mode behaves correctly for this deployment', async () => {
    if (canBake) {
      const text = await mcp.call('set_page_react_slide', { id: deckId, page: 1, code: SLIDE_CODE });
      assert.match(text, /React 投影片頁/);
      assert.equal(pageRow(deckId, 1).render_type, 'react');
    } else {
      // Baking is off under the test runner. The conversion must be refused rather than half-done:
      // a React page this deployment cannot render would export the pre-conversion image forever.
      const text = await mcp.callExpectingError('set_page_react_slide', { id: deckId, page: 1, code: SLIDE_CODE });
      assert.match(text, /BAKE_UNAVAILABLE/);
      assert.equal(pageRow(deckId, 1).render_type, 'static-image', '被擋下的轉換不應該動到頁面型別');
    }
  });

  await t.test('set_page_react_slide rewrites the code of a page that is already React', async () => {
    // The case the tools exist for, and the one that is never gated: changing the script of a
    // page that is already a React slide.
    await forceIntoReactMode(deckId, 2, SLIDE_CODE);
    assert.equal(pageRow(deckId, 2).render_type, 'react');

    const updated = SLIDE_CODE.replace('MCP 寫進來的標題', '第二次寫入');
    const text = await mcp.call('set_page_react_slide', { id: deckId, page: 2, code: updated });
    assert.match(text, /已寫入/);

    const stored = fs.readFileSync(pageReactSlideSourcePath(deckId, pageRow(deckId, 2).page_uid), 'utf8');
    assert.match(stored, /第二次寫入/);
    assert.doesNotMatch(stored, /MCP 寫進來的標題/, '寫入應該整份取代，而不是附加');

    const read = await mcp.call('get_page_react_slide', { id: deckId, page: 2 });
    assert.match(read, /是 React 投影片頁/);
    assert.match(read, /第二次寫入/);
  });

  await t.test('set_page_react_slide leaves the stored code alone when the code will not compile', async () => {
    const before = fs.readFileSync(pageReactSlideSourcePath(deckId, pageRow(deckId, 2).page_uid), 'utf8');
    const text = await mcp.callExpectingError('set_page_react_slide', {
      id: deckId,
      page: 2,
      code: 'function Slide() { return <div>unclosed }\nwindow.SlideComponent = Slide;\n',
    });
    assert.match(text, /REACT_SLIDE_INVALID/);
    assert.equal(
      fs.readFileSync(pageReactSlideSourcePath(deckId, pageRow(deckId, 2).page_uid), 'utf8'),
      before,
      '編不過的程式碼不應該覆蓋掉還能用的那份',
    );
    assert.equal(pageRow(deckId, 2).render_type, 'react');
  });

  await t.test('set_page_react_slide refuses code past the length limit without calling the backend', async () => {
    const text = await mcp.callExpectingError('set_page_react_slide', {
      id: deckId,
      page: 2,
      code: `${'x'.repeat(MAX_REACT_SLIDE_CODE_LENGTH + 1)}\nwindow.SlideComponent = Slide;`,
    });
    assert.match(text, /不可超過/);
  });

  await t.test('convert_react_page_to_slide turns the page back and keeps the code on disk', async () => {
    const uid = pageRow(deckId, 2).page_uid;
    const before = fs.readFileSync(pageReactSlideSourcePath(deckId, uid), 'utf8');

    // force: baking is what writes the React page into the image, and it needs a browser this
    // environment may not have. Forcing is the documented way to convert anyway, and it is the
    // only branch that runs identically with or without Chrome.
    const text = await mcp.call('convert_react_page_to_slide', { id: deckId, page: 2, force: true });
    assert.match(text, /已轉回/);
    assert.match(text, /force/, 'force 會讓圖片退回舊版，訊息必須說出來');

    const row = pageRow(deckId, 2);
    assert.equal(row.render_type, 'static-image');
    assert.equal(row.react_slide_path, null);
    // The point of the endpoint: the JSX stays, so the conversion is reversible.
    assert.equal(fs.readFileSync(pageReactSlideSourcePath(deckId, uid), 'utf8'), before);
  });

  await t.test('the code is still there when the page becomes a React slide again', async () => {
    await forceIntoReactMode(deckId, 2, fs.readFileSync(pageReactSlideSourcePath(deckId, pageRow(deckId, 2).page_uid), 'utf8'));
    const text = await mcp.call('get_page_react_slide', { id: deckId, page: 2 });
    // Not the default skeleton — what was written before the round trip.
    assert.match(text, /第二次寫入/);
  });

  await t.test('convert_react_page_to_slide refuses a page that is not a React page', async () => {
    // A page of its own rather than page 1: whether page 1 is still an image depends on whether
    // this deployment could bake, and this assertion is about the refusal, not about that.
    await mcp.call('add_page', { id: deckId, after_page_number: 2 });
    assert.equal(pageRow(deckId, 3).render_type, 'static-image');

    const text = await mcp.callExpectingError('convert_react_page_to_slide', { id: deckId, page: 3 });
    assert.match(text, /INVALID_STATE/);
    assert.equal(pageRow(deckId, 3).render_type, 'static-image', '被拒絕的轉換不應該動到頁面型別');
  });
});

test('the limits the MCP tools enforce match the backend', () => {
  // mcp-server.ts copies these instead of importing them, because it must stay runnable as a
  // single dependency-free file. That copy is only safe while something notices it drifting.
  const source = fs.readFileSync(fileURLToPath(new URL('../src/mcp-server.ts', import.meta.url)), 'utf8');
  const codeLimit = /const MAX_REACT_SLIDE_CODE_LENGTH = (\d+);/.exec(source);
  const promptLimit = /const MAX_REACT_SLIDE_PROMPT_LENGTH = (\d+);/.exec(source);
  assert.ok(codeLimit && promptLimit, 'mcp-server.ts 應該有這兩個常數');
  assert.equal(Number(codeLimit![1]), MAX_REACT_SLIDE_CODE_LENGTH);
  assert.equal(Number(promptLimit![1]), MAX_REACT_SLIDE_PROMPT_LENGTH);
});

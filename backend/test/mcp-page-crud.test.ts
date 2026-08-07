/**
 * End-to-end tests for the MCP page-structure tools (phase 1 of the agent-authoring plan).
 *
 * These go through the real transport on purpose. `mcp-server.ts` talks to the backend over
 * `fetch`, so `app.inject()` — how every other route test drives the API — cannot reach it at
 * all. Instead the test listens on a real port, spawns the MCP server as a child process
 * exactly as an MCP client would, and drives it over stdio JSON-RPC. That is the only way to
 * cover what actually breaks in this layer: argument marshalling, response formatting, and the
 * page-number arithmetic reported back to the agent.
 *
 * The deck is owned by a real account reached through an MCP bearer token rather than created
 * anonymously. An anonymous deck has `owner_sub = null`, and every permission helper
 * short-circuits to `true` on that — so an anonymous test would exercise a path MCP never takes
 * in a real deployment and would prove nothing about permissions. With a token, `delete_page`
 * genuinely goes through `canDestructivelyEditPdf`'s authenticated-session branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-page-crud-account';
const TOKEN = 'mcp-page-crud-test-token';

setSystemAuthSettings({ googleAuthEnabled: false });

interface McpClient {
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  /** Same call, but asserts the tool reported an error and returns the message. */
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

  const pending = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
  let nextId = 1;
  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    if (!line.trim()) return;
    let msg: { id?: number; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') pending.get(msg.id)?.(msg);
  });

  function request(method: string, params?: unknown): Promise<{ result?: unknown; error?: unknown }> {
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

function pageCount(pdfId: string): number {
  const row = db.prepare('SELECT page_count FROM pdfs WHERE id = ?').get(pdfId) as { page_count: number } | undefined;
  return row?.page_count ?? 0;
}

/** Page UIDs in page order — the stable identity that lets us prove a page really moved. */
function pageUids(pdfId: string): string[] {
  return (
    db.prepare('SELECT page_uid FROM pages WHERE pdf_id = ? ORDER BY page_number ASC').all(pdfId) as Array<{
      page_uid: string;
    }>
  ).map((r) => r.page_uid);
}

test('MCP page-structure tools drive a deck end to end over stdio', async (t) => {
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

  await t.test('create_blank_deck creates a ready one-page deck owned by the token account', async () => {
    const text = await mcp.call('create_blank_deck', { title: 'MCP 測試簡報' });
    const match = /ID：(\S+)/.exec(text);
    assert.ok(match, `回應中找不到簡報 ID：${text}`);
    deckId = match[1]!;
    const row = db.prepare('SELECT status, page_count, owner_sub, title FROM pdfs WHERE id = ?').get(deckId) as
      | { status: string; page_count: number; owner_sub: string | null; title: string }
      | undefined;
    assert.deepEqual(row, { status: 'ready', page_count: 1, owner_sub: ACCOUNT, title: 'MCP 測試簡報' });
  });

  await t.test('add_page inserts at the requested position and reports the page-number shift', async () => {
    // Append: page 2. Nothing shifts, and the tool must say so rather than warn about a
    // renumbering that did not happen.
    const appended = await mcp.call('add_page', { id: deckId, after_page_number: 1 });
    assert.match(appended, /新頁為第 2 頁/);
    assert.match(appended, /共 2 頁/);
    assert.match(appended, /其他頁面的頁碼沒有變動/);
    assert.equal(pageCount(deckId), 2);

    // Insert at the very front: the two existing pages shift back by one, and the reported
    // range must match. This is the case an agent most easily gets wrong.
    const before = pageUids(deckId);
    const prepended = await mcp.call('add_page', { id: deckId, after_page_number: 0 });
    assert.match(prepended, /新頁為第 1 頁/);
    assert.match(prepended, /第 1～2 頁，頁碼各往後移了一位（現在是第 2～3 頁）/);
    assert.equal(pageCount(deckId), 3);
    // The originals really are the ones that moved, in their original relative order.
    assert.deepEqual(pageUids(deckId).slice(1), before);
  });

  await t.test('add_page defaults to inserting at the front when the position is omitted', async () => {
    const before = pageUids(deckId);
    const text = await mcp.call('add_page', { id: deckId });
    assert.match(text, /新頁為第 1 頁/);
    assert.deepEqual(pageUids(deckId).slice(1), before);
    // Put the deck back to 3 pages for the tests that follow.
    await mcp.call('delete_page', { id: deckId, page: 1 });
    assert.equal(pageCount(deckId), 3);
  });

  await t.test('move_page reorders pages and reports which range shifted', async () => {
    const before = pageUids(deckId);
    const text = await mcp.call('move_page', { id: deckId, from_page_number: 1, to_page_number: 3 });
    assert.match(text, /第 1 頁已搬到第 3 頁/);
    assert.match(text, /第 2～3 頁，頁碼各往前移了一位/);
    assert.deepEqual(pageUids(deckId), [before[1], before[2], before[0]]);
  });

  await t.test('move_page treats an identical source and destination as a no-op', async () => {
    const before = pageUids(deckId);
    const text = await mcp.call('move_page', { id: deckId, from_page_number: 2, to_page_number: 2 });
    assert.match(text, /頁面順序沒有改變/);
    assert.deepEqual(pageUids(deckId), before);
  });

  await t.test('delete_page removes the page and reports the renumbering', async () => {
    const before = pageUids(deckId);
    const text = await mcp.call('delete_page', { id: deckId, page: 1 });
    assert.match(text, /第 1 頁已刪除/);
    assert.match(text, /共 2 頁/);
    assert.match(text, /第 2～3 頁，頁碼各往前移了一位（現在是第 1～2 頁）/);
    assert.deepEqual(pageUids(deckId), before.slice(1));

    // Deleting the last page shifts nothing, and the message must not claim otherwise.
    const tail = await mcp.call('delete_page', { id: deckId, page: 2 });
    assert.match(tail, /其他頁面的頁碼沒有變動/);
    assert.equal(pageCount(deckId), 1);
  });

  await t.test('delete_page refuses to remove the only remaining page', async () => {
    const text = await mcp.callExpectingError('delete_page', { id: deckId, page: 1 });
    assert.match(text, /INVALID_STATE/);
    assert.equal(pageCount(deckId), 1, '被拒絕的刪除不應該動到任何資料');
  });

  await t.test('set_deck_title updates the title', async () => {
    await mcp.call('set_deck_title', { id: deckId, title: '改過的標題' });
    const row = db.prepare('SELECT title FROM pdfs WHERE id = ?').get(deckId) as { title: string };
    assert.equal(row.title, '改過的標題');
  });

  await t.test('get_deck_outline reflects the current structure', async () => {
    await mcp.call('add_page', { id: deckId, after_page_number: 1 });
    const text = await mcp.call('get_deck_outline', { id: deckId });
    assert.match(text, /簡報：改過的標題/);
    assert.match(text, /頁數：2/);
    assert.match(text, /第 1 頁/);
    assert.match(text, /第 2 頁/);
    assert.doesNotMatch(text, /第 3 頁/);
  });

  await t.test('errors carry the backend error code plus an actionable hint', async () => {
    const text = await mcp.callExpectingError('get_deck_outline', { id: 'no-such-deck' });
    assert.match(text, /PDF_NOT_FOUND/);
    // The hint is the whole point of the translation layer: without it an agent just retries
    // the identical call.
    assert.match(text, /提示：/);
    assert.match(text, /list_presentations/);
  });

  await t.test('page numbers are validated before any request is sent', async () => {
    const text = await mcp.callExpectingError('delete_page', { id: deckId, page: 0 });
    assert.match(text, /頁碼從 1 開始/);
  });
});

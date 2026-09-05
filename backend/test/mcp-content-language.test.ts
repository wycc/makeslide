/**
 * End-to-end tests for the MCP output-language parameter.
 *
 * Driven over the real stdio transport for the same reason as mcp-figures.test.ts: `mcp-server.ts`
 * talks HTTP, so `app.inject()` cannot reach it.
 *
 * Two things are checked, and they fail in different ways:
 *  - the *schemas* an agent reads (tools/list) actually offer `content_language` on every creation
 *    tool — a tool that silently lacks the parameter is invisible to an agent, which then has no
 *    way to ask for another language at all;
 *  - the value *arrives*, i.e. the deck row really carries it (and, when omitted, carries the
 *    account's configured language rather than being left to drift with the setting).
 *
 * `upload_pdf` and `define_prompt` are schema-only here: the first needs a real PDF for poppler to
 * page-count, the second starts the generation pipeline and would call the model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import {
  getAccountContentLanguage,
  persistEnvSettings,
  setRuntimeAiSettings,
  setSystemAuthSettings,
} from '../src/services/aiSettings';

const ACCOUNT = 'mcp-content-language-account';
const TOKEN = 'mcp-content-language-test-token';

setSystemAuthSettings({ googleAuthEnabled: false });

interface McpClient {
  call(tool: string, args: Record<string, unknown>): Promise<string>;
  callExpectingError(tool: string, args: Record<string, unknown>): Promise<string>;
  listTools(): Promise<Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>>;
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
      const msg = await request('tools/list', {});
      const result = msg.result as { tools?: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> } | undefined;
      return result?.tools ?? [];
    },
    close() {
      child.kill();
    },
  };
}

function deckLanguage(id: string): string | null {
  const row = db.prepare(`SELECT content_language FROM pdfs WHERE id = ?`).get(id) as
    | { content_language: string | null }
    | undefined;
  return row?.content_language ?? null;
}

/** Pulls the deck id out of a tool's human-readable success message. */
function idFromReply(text: string): string {
  const match = /ID：([A-Za-z0-9_-]+)/.exec(text);
  assert.ok(match, `回應中找不到簡報 ID：${text}`);
  return match[1]!;
}

function removeDeck(id: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdf_sources WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

test('MCP output-language parameter over stdio', async (t) => {
  setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: TOKEN });
  await persistEnvSettings(ACCOUNT, { mcpAuthToken: TOKEN });

  const app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object', '無法取得測試伺服器的位址');
  const mcp = startMcpServer(`http://127.0.0.1:${address.port}`);
  const created: string[] = [];

  t.after(async () => {
    mcp.close();
    await app.close();
    for (const id of created) removeDeck(id);
    setRuntimeAiSettings(ACCOUNT, { mcpAuthToken: '' });
    await persistEnvSettings(ACCOUNT, { mcpAuthToken: '' });
  });

  await t.test('每一個建立工具與 define_prompt 都對 agent 公開 content_language', async () => {
    const tools = await mcp.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ['upload_pdf', 'upload_txt', 'upload_slide', 'create_blank_deck', 'define_prompt']) {
      const schema = byName.get(name)?.inputSchema?.properties;
      assert.ok(schema, `${name} 應該存在且有 inputSchema`);
      const property = schema.content_language as { enum?: string[]; description?: string } | undefined;
      assert.ok(property, `${name} 應該有 content_language 參數`);
      assert.deepEqual(property.enum, ['zh-TW', 'en']);
      // 「不填會怎樣」是 agent 唯一需要知道的預設行為，說明裡一定要交代。
      assert.match(property.description ?? '', /省略/);
    }
    assert.ok(byName.has('set_content_language'), '應該要有 set_content_language 工具');
  });

  await t.test('create_blank_deck 帶語言就照著存，不帶就記下系統設定的語言', async () => {
    const en = idFromReply(await mcp.call('create_blank_deck', { title: 'MCP EN', content_language: 'en' }));
    created.push(en);
    assert.equal(deckLanguage(en), 'en');

    const inherited = idFromReply(await mcp.call('create_blank_deck', { title: 'MCP default' }));
    created.push(inherited);
    // 「預設值是系統的輸出語言」：不是留空跟著設定漂移，而是當下就記在這份簡報上。
    assert.equal(deckLanguage(inherited), getAccountContentLanguage(ACCOUNT));
  });

  await t.test('upload_txt 建立的簡報帶著指定的語言', async () => {
    const id = idFromReply(
      await mcp.call('upload_txt', {
        outline: 'Slide 1: Hello\n- first point\n- second point',
        title: 'MCP outline EN',
        content_language: 'en',
      }),
    );
    created.push(id);
    assert.equal(deckLanguage(id), 'en');
  });

  await t.test('upload_slide 建立的簡報帶著指定的語言', async () => {
    const id = idFromReply(
      await mcp.call('upload_slide', {
        title: 'MCP slides EN',
        slides: [{ title: 'Intro', bullets: ['first', 'second'] }],
        content_language: 'en',
      }),
    );
    created.push(id);
    assert.equal(deckLanguage(id), 'en');
  });

  await t.test('set_content_language 事後改得掉，get_presentation 讀得到新值', async () => {
    const id = idFromReply(await mcp.call('create_blank_deck', { title: 'MCP switch', content_language: 'zh-TW' }));
    created.push(id);

    const reply = await mcp.call('set_content_language', { id, content_language: 'en' });
    // 既有內容不會被翻譯，這件事必須講在回應裡，否則 agent 會以為改完就換好語言了。
    assert.match(reply, /英文/);
    assert.match(reply, /不會被翻譯/);
    assert.equal(deckLanguage(id), 'en');

    const detail = JSON.parse(await mcp.call('get_presentation', { id })) as {
      content_language?: string;
      account_content_language?: string;
    };
    assert.equal(detail.content_language, 'en');
    assert.equal(detail.account_content_language, getAccountContentLanguage(ACCOUNT));
  });

  await t.test('不支援的語言一律拒絕，簡報維持原本的設定', async () => {
    const id = idFromReply(await mcp.call('create_blank_deck', { title: 'MCP reject', content_language: 'zh-TW' }));
    created.push(id);

    await mcp.callExpectingError('set_content_language', { id, content_language: 'ja' });
    await mcp.callExpectingError('create_blank_deck', { title: 'MCP reject 2', content_language: 'ja' });
    assert.equal(deckLanguage(id), 'zh-TW');
  });
});

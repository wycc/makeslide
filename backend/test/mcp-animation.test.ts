/**
 * End-to-end tests for the MCP animation tools (phase 4 of the agent-authoring plan).
 *
 * The most valuable thing here is the drift check. `mcp-server.ts` is deliberately a
 * zero-dependency single file, so it cannot import ANIMATION_EFFECT_TYPES or ANIMATION_EASES
 * from the backend — it carries its own copy for `describe_animation_spec`. That copy is the
 * only thing telling an agent which effect types exist, and if the backend gains one and the
 * copy does not, nothing breaks loudly: the agent simply never learns the new type exists. The
 * tests below compare the real constants against what the tool actually says.
 *
 * `generate_animation_script` is not covered: it streams from a model provider and there is no
 * API key in the test environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { ANIMATION_EASES, ANIMATION_EFFECT_TYPES } from '../src/services/pageAnimation';
import { persistEnvSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';

const ACCOUNT = 'mcp-animation-account';
const TOKEN = 'mcp-animation-test-token';

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

function renderType(pdfId: string, page: number): string | null {
  const row = db.prepare('SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = ?').get(pdfId, page) as {
    render_type: string | null;
  };
  return row.render_type;
}

/** The JSON body a tool appends after its human-readable header line. */
function parseSpecFromToolOutput(text: string): { enabled: boolean; effects: Array<Record<string, unknown>> } {
  const start = text.indexOf('{');
  assert.ok(start >= 0, `工具輸出中找不到 JSON：${text}`);
  return JSON.parse(text.slice(start));
}

test('MCP animation tools describe and edit a page animation', async (t) => {
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

  await t.test('setup: create a deck', async () => {
    deckId = /ID：(\S+)/.exec(await mcp.call('create_blank_deck', { title: '動畫測試' }))![1]!;
    assert.ok(deckId);
  });

  await t.test('describe_animation_spec lists every effect type the backend accepts', async () => {
    // The drift check: mcp-server.ts keeps its own copy of this list because it cannot import
    // from the backend. A type the backend supports but the tool never mentions is invisible
    // to an agent — it would have no way to know it could ask for it.
    const overview = await mcp.call('describe_animation_spec', {});
    for (const type of ANIMATION_EFFECT_TYPES) {
      assert.ok(overview.includes(type), `describe_animation_spec 的概覽沒有提到效果型別 ${type}`);
    }
  });

  await t.test('describe_animation_spec lists every ease the backend accepts', async () => {
    const overview = await mcp.call('describe_animation_spec', {});
    for (const ease of ANIMATION_EASES) {
      assert.ok(overview.includes(ease), `describe_animation_spec 的概覽沒有提到緩動曲線 ${ease}`);
    }
  });

  await t.test('every effect type has its own field documentation', async () => {
    for (const type of ANIMATION_EFFECT_TYPES) {
      const doc = await mcp.call('describe_animation_spec', { effect_type: type });
      assert.match(doc, new RegExp(`^# ${type}`, 'm'), `${type} 沒有專屬的欄位說明`);
    }
  });

  await t.test('an unknown effect type is rejected with the list of valid ones', async () => {
    const text = await mcp.callExpectingError('describe_animation_spec', { effect_type: 'sparkle' });
    assert.match(text, /未知的效果型別/);
    assert.match(text, /highlight-box/, '錯誤訊息應該列出可用型別，agent 才有辦法自己更正');
  });

  await t.test('get_page_animation reports a page with no animation', async () => {
    const text = await mcp.call('get_page_animation', { id: deckId, page: 1 });
    assert.match(text, /未啟用/);
    assert.match(text, /效果數：0/);
  });

  await t.test('add_animation_effect appends, assigns an id, and enables the animation', async () => {
    const text = await mcp.call('add_animation_effect', {
      id: deckId,
      page: 1,
      effect: {
        type: 'highlight-box',
        start: 2,
        duration: 1,
        params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 15 },
      },
    });
    // Adding an effect to a spec whose `enabled` is false changes nothing visible — the tool
    // has to flip it, and say that it did.
    assert.match(text, /已一併啟用/);
    assert.equal(renderType(deckId, 1), 'gsap-image');

    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    assert.equal(spec.enabled, true);
    assert.equal(spec.effects.length, 1);
    assert.equal(spec.effects[0]!.type, 'highlight-box');
    assert.ok(spec.effects[0]!.id, '未指定 id 時應自動產生');
    assert.equal(spec.effects[0]!.ease, 'power1.out', '未指定 ease 時應套用預設值');
    assert.deepEqual(spec.effects[0]!.params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 15 });
  });

  await t.test('add_animation_effect keeps existing effects and avoids duplicate ids', async () => {
    await mcp.call('add_animation_effect', {
      id: deckId,
      page: 1,
      effect: { type: 'text-callout', start: 4, duration: 0.5, ease: 'none', text: '重點在這裡' },
    });
    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    assert.equal(spec.effects.length, 2, '既有的效果不應該被取代');
    const ids = spec.effects.map((e) => e.id);
    assert.equal(new Set(ids).size, 2, '兩個效果的 id 必須不同，否則其中一個會被覆蓋掉');
    assert.equal(spec.effects[1]!.text, '重點在這裡');
  });

  await t.test('add_animation_effect rejects an unknown type before touching the deck', async () => {
    const text = await mcp.callExpectingError('add_animation_effect', {
      id: deckId,
      page: 1,
      effect: { type: 'sparkle', start: 0, duration: 1 },
    });
    assert.match(text, /未知的效果型別/);
    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    assert.equal(spec.effects.length, 2, '被拒絕的效果不應該寫進 spec');
  });

  await t.test('startTrigger survives the round trip', async () => {
    // An effect anchored to a transcript sentence resolves its start time at playback. Losing
    // the anchor would silently fall back to the literal `start`, i.e. the wrong moment.
    await mcp.call('add_animation_effect', {
      id: deckId,
      page: 1,
      effect: {
        type: 'pointer',
        start: 0,
        duration: 1,
        startTrigger: { type: 'transcript-line', line: 2, anchor: 'end' },
      },
    });
    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    assert.deepEqual(spec.effects[2]!.startTrigger, { type: 'transcript-line', line: 2, anchor: 'end' });
  });

  await t.test('set_page_animation replaces the whole spec', async () => {
    await mcp.call('set_page_animation', {
      id: deckId,
      page: 1,
      spec: {
        version: 1,
        enabled: true,
        effects: [{ id: 'only', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' }],
      },
    });
    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    assert.equal(spec.effects.length, 1);
    assert.equal(spec.effects[0]!.id, 'only');
  });

  await t.test('set_page_animation warns when a disabled spec leaves the page static', async () => {
    const text = await mcp.call('set_page_animation', {
      id: deckId,
      page: 1,
      spec: {
        version: 1,
        enabled: false,
        effects: [{ id: 'only', target: 'slide', type: 'fade-in', start: 0, duration: 1, ease: 'none' }],
      },
    });
    // The effects are still stored, but nothing plays — worth saying out loud rather than
    // letting the agent conclude the animation is live.
    assert.match(text, /動畫並未啟用/);
    assert.equal(renderType(deckId, 1), 'static-image');
  });

  await t.test('an invalid spec is rejected with the offending field named', async () => {
    const text = await mcp.callExpectingError('set_page_animation', {
      id: deckId,
      page: 1,
      spec: {
        version: 1,
        enabled: true,
        effects: [{ id: 'bad', target: 'slide', type: 'fade-in', start: 0, duration: 0, ease: 'none' }],
      },
    });
    assert.match(text, /INVALID_ANIMATION_SPEC/);
    assert.match(text, /duration/, '後端的驗證訊息會指出是哪個欄位，這一點要原樣傳給 agent');
  });

  await t.test('update_animation_effect changes one effect and leaves the others alone', async () => {
    // Why these tools exist: set_page_animation makes the caller resend every other effect —
    // including one carrying 20 KB of generated code — and an omission deletes them.
    await mcp.call('set_page_animation', {
      id: deckId,
      page: 1,
      spec: {
        version: 1,
        enabled: false,
        effects: [
          { id: 'a', target: 'slide', type: 'highlight-box', start: 0, duration: 1, ease: 'none', params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 } },
          { id: 'b', target: 'slide', type: 'text-callout', start: 1, duration: 1, ease: 'none', text: '保持原樣', exitDuration: 2 },
        ],
      },
    });

    const text = await mcp.call('update_animation_effect', {
      id: deckId,
      page: 1,
      effect_id: 'a',
      patch: { duration: 3, params: { xPct: 55 } },
    });
    assert.match(text, /highlight-box/);
    // Turning the page's animation back on is part of the job: an edit that cannot play is a
    // silent no-op, exactly as with add_animation_effect.
    assert.match(text, /已一併啟用/);

    const spec = parseSpecFromToolOutput(await mcp.call('get_page_animation', { id: deckId, page: 1 }));
    const [a, b] = spec.effects;
    assert.equal(spec.enabled, true);
    assert.equal(a!.duration, 3);
    // params merges per field: asking to move the box must not reset its size.
    assert.deepEqual(a!.params, { xPct: 55, yPct: 20, widthPct: 30, heightPct: 40 });
    assert.equal(b!.text, '保持原樣', 'the other effect survives untouched');
    assert.equal(b!.exitDuration, 2);
  });

  await t.test('update_animation_effect can remove a field, which a merge cannot express', async () => {
    // Dropping exitDuration is how an overlay stops auto-hiding; no value means "not set".
    const text = await mcp.call('update_animation_effect', {
      id: deckId,
      page: 1,
      effect_id: 'b',
      unset: ['exitDuration'],
    });
    assert.match(text, /-exitDuration/);
    const read = (await mcp.call('get_page_animation', { id: deckId, page: 1 })) as string;
    assert.equal(read.includes('exitDuration'), false);
  });

  await t.test('update_animation_effect refuses an unknown id, a protected field and an empty patch', async () => {
    const unknown = await mcp.callExpectingError('update_animation_effect', {
      id: deckId,
      page: 1,
      effect_id: 'nope',
      patch: { duration: 1 },
    });
    // The agent's next move is to pick a real id, so the error has to say what they are.
    assert.match(unknown, /a \(highlight-box\)/);

    const renamed = await mcp.callExpectingError('update_animation_effect', {
      id: deckId,
      page: 1,
      effect_id: 'a',
      patch: { id: 'hijack' },
    });
    assert.match(renamed, /不能透過 patch 修改/);

    const empty = await mcp.callExpectingError('update_animation_effect', { id: deckId, page: 1, effect_id: 'a' });
    assert.match(empty, /至少要有一個內容/);
  });

  await t.test('delete_animation_effect removes one effect, and the last one turns the page static', async () => {
    const first = await mcp.call('delete_animation_effect', { id: deckId, page: 1, effect_id: 'a' });
    assert.match(first, /還有 1 個效果/);

    const last = await mcp.call('delete_animation_effect', { id: deckId, page: 1, effect_id: 'b' });
    assert.match(last, /回到沒有動畫的狀態/);
    const read = (await mcp.call('get_page_animation', { id: deckId, page: 1 })) as string;
    assert.match(read, /static-image/);

    const gone = await mcp.callExpectingError('delete_animation_effect', { id: deckId, page: 1, effect_id: 'a' });
    assert.match(gone, /沒有任何效果/);
  });

  await t.test('add_animation_effect stops at the 20-effect limit', async () => {
    const effects = Array.from({ length: 20 }, (_, i) => ({
      id: `e${i}`,
      target: 'slide',
      type: 'fade-in',
      start: i,
      duration: 1,
      ease: 'none',
    }));
    await mcp.call('set_page_animation', { id: deckId, page: 1, spec: { version: 1, enabled: true, effects } });
    const text = await mcp.callExpectingError('add_animation_effect', {
      id: deckId,
      page: 1,
      effect: { type: 'fade-in', start: 21, duration: 1 },
    });
    assert.match(text, /20 個效果/);
  });
});

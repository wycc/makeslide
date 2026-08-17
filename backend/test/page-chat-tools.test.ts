import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { setOpenAIClientForTest } from '../src/services/openai';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { buildApp } from '../src/server';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER = `chat-owner-${RUN}`;

function cookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@e.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function seed(pdfId: string, owner: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'public',?,?)`,
  ).run(pdfId, 'D', 'd.pdf', owner, t, t);
  const uid = `pc${RUN}`;
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,text_path,script_path,status,created_at,updated_at)
     VALUES (?,1,?,?,?,'audio_ready',?,?)`,
  ).run(pdfId, uid, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
  const dir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${uid}.text.txt`), 'Slide 1: Topic\n- point', 'utf8');
  fs.writeFileSync(path.join(dir, `${uid}.script.txt`), '這一頁的逐字稿。', 'utf8');
}


/** Pull one event's payload out of an SSE body. */
function parseSseEvent(body: string, wanted: string): { answer?: string; proposals?: unknown[] } | null {
  for (const block of body.split('\n\n')) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
    }
    if (event === wanted && data) return JSON.parse(data);
  }
  return null;
}

/** Captures the tools offered to the model, which is the whole question here. */
let offered: string[] | null = null;
function mockChat(answer: string): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { tools?: Array<{ function: { name: string } }> }) => {
          offered = (args.tools ?? []).map((t) => t.function.name);
          return {
            choices: [{ message: { content: JSON.stringify({ answer }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);
}

test('POST chat — the editor is offered the edit-proposal tools', async (t) => {
  // The page Q&A panel is where the user describes what is wrong with the page, so this is where
  // the tools belong. They were first wired to /ask (the tutor panel) by mistake, and this panel
  // just answered in prose.
  const pdfId = `chat-tools-${RUN}`;
  seed(pdfId, OWNER);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  mockChat('好的。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/chat`,
      headers: { cookie: `makeslide_session=${encodeURIComponent(cookie(OWNER))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '把這頁的圖改成深色背景', history: [] }),
    });
    assert.equal(resp.statusCode, 200, resp.body);
    assert.ok(offered, 'the model should have been offered tools');
    assert.ok(offered!.includes('propose_page_image_edit'), `image tool missing from ${offered}`);
    assert.ok(offered!.includes('propose_script_edit'), `script tool missing from ${offered}`);
    // Read-only tools stay available; the proposal tools are added, not swapped in.
    assert.ok(offered!.includes('get_page_text'));
    // The panel now streams, so the answer arrives in an `event: done` frame rather than a JSON
    // body — that is what lets it report a running image generation instead of appearing to hang.
    const done = parseSseEvent(resp.body, 'done');
    assert.equal(done?.answer, '好的。');
    // No proposal was produced (the mock never called a tool), and the shape says so rather than
    // omitting the field.
    assert.deepEqual(done?.proposals, []);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST chat — a viewer without edit rights is not offered them', async (t) => {
  const pdfId = `chat-viewer-${RUN}`;
  seed(pdfId, `someone-else-${RUN}`);
  // Public but not editable: readable by anyone, changed by nobody but the owner.
  db.prepare(`UPDATE pdfs SET visibility='public' WHERE id=?`).run(pdfId);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));
  mockChat('好的。');
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/chat`,
      headers: { cookie: `makeslide_session=${encodeURIComponent(cookie(`viewer-${RUN}`))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '改一下圖', history: [] }),
    });
    // Whether the panel answers at all is the route's existing permission rule; what matters here
    // is that the tools are never offered to someone who could not apply them.
    if (resp.statusCode === 200) {
      assert.ok(offered, 'tools list should have been captured');
      assert.ok(!offered!.includes('propose_page_image_edit'), 'a viewer must not be offered the image tool');
      assert.ok(!offered!.includes('propose_script_edit'), 'a viewer must not be offered the script tool');
    }
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST chat — a running tool is announced before the answer arrives', async (t) => {
  // The whole reason this endpoint streams: an image proposal runs for ten seconds or more, and
  // without a `tool` frame the panel has nothing to show between the question and the answer.
  const pdfId = `chat-progress-${RUN}`;
  seed(pdfId, OWNER);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));

  // A model that calls a read-only tool once, then answers.
  let round = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => {
          round += 1;
          if (round === 1) {
            return {
              choices: [{
                message: {
                  content: '',
                  tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_page_text', arguments: '{"page":1}' } }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          return {
            choices: [{ message: { content: JSON.stringify({ answer: '看過了。' }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/chat`,
      headers: { cookie: `makeslide_session=${encodeURIComponent(cookie(OWNER))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '這頁在講什麼', history: [] }),
    });
    assert.equal(resp.statusCode, 200, resp.body);
    // The tool frame must come before the answer, or it cannot serve as progress.
    assert.ok(resp.body.indexOf('event: tool') >= 0, 'no tool event was sent');
    assert.ok(
      resp.body.indexOf('event: tool') < resp.body.indexOf('event: done'),
      'the tool event must precede the answer',
    );
    assert.match(resp.body, /get_page_text/);
    assert.equal(parseSseEvent(resp.body, 'done')?.answer, '看過了。');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST chat — a proposal produced by a tool reaches the done frame', async (t) => {
  // The gap this covers: the earlier cases only ever asserted `proposals: []`. A user reported the
  // panel showing nothing after a long wait while a candidate image *was* written to disk, which
  // is exactly what a proposal lost between the tool and the response would look like.
  const pdfId = `chat-proposal-${RUN}`;
  seed(pdfId, OWNER);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));

  let call = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (args: { messages: Array<{ role: string; content: unknown }> }) => {
          call += 1;
          // 1st: the page-chat model asks for a script rewrite.
          if (call === 1) {
            return {
              choices: [{
                message: {
                  content: '',
                  tool_calls: [{
                    id: 't1',
                    type: 'function',
                    function: { name: 'propose_script_edit', arguments: JSON.stringify({ page: 1, instruction: '精簡一點' }) },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          // 2nd: the rewrite call inside the tool. Keyed on the call count rather than the
          // message text — both calls mention 逐字稿, which made this branch swallow the third.
          if (call === 2) {
            return {
              choices: [{ message: { content: JSON.stringify({ script: '改寫後的逐字稿。' }) }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          // 3rd: the page-chat model's final answer.
          return {
            choices: [{ message: { content: JSON.stringify({ answer: '我提了一版精簡的逐字稿。' }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/chat`,
      headers: { cookie: `makeslide_session=${encodeURIComponent(cookie(OWNER))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '這頁逐字稿太囉唆', history: [] }),
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const done = parseSseEvent(resp.body, 'done') as { answer?: string; proposals?: Array<Record<string, unknown>> } | null;
    assert.ok(done, `no done frame; body was: ${JSON.stringify(resp.body).slice(0, 600)}`);
    assert.equal(done!.proposals?.length, 1, `the proposal did not reach the response: ${resp.body.slice(0, 400)}`);
    const proposal = done!.proposals![0]!;
    assert.equal(proposal.kind, 'script');
    assert.equal(proposal.page, 1);
    assert.equal(proposal.proposed, '改寫後的逐字稿。');
    // The original travels with it, so the diff is against what the script was when proposed.
    assert.equal(proposal.original, '這一頁的逐字稿。');
    // And nothing was written: the page keeps its script until the user applies the proposal.
    const uid = (db.prepare(`SELECT page_uid FROM pages WHERE pdf_id=?`).get(pdfId) as { page_uid: string }).page_uid;
    assert.equal(
      fs.readFileSync(path.join(config.storageRoot, pdfId, 'pages', `${uid}.script.txt`), 'utf8'),
      '這一頁的逐字稿。',
    );
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST chat — a proposal survives a final answer that will not parse', async (t) => {
  // Reported symptom: a long wait, then nothing — no result and no visible error — while a
  // candidate image sat on disk. The tool had succeeded and been paid for; the model's closing
  // message then failed schema validation and took the whole response down with it.
  const pdfId = `chat-salvage-${RUN}`;
  seed(pdfId, OWNER);
  t.after(() => fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true }));

  let call = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => {
          call += 1;
          if (call === 1) {
            return {
              choices: [{
                message: {
                  content: '',
                  tool_calls: [{
                    id: 't1',
                    type: 'function',
                    function: { name: 'propose_script_edit', arguments: JSON.stringify({ page: 1, instruction: '精簡' }) },
                  }],
                },
                finish_reason: 'tool_calls',
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          if (call === 2) {
            return {
              choices: [{ message: { content: JSON.stringify({ script: '改寫後的逐字稿。' }) }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          // Everything after: an answer with no `answer` field, retried and still wrong.
          return {
            choices: [{ message: { content: JSON.stringify({ notTheField: 'oops' }) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/chat`,
      headers: { cookie: `makeslide_session=${encodeURIComponent(cookie(OWNER))}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: '精簡一下', history: [] }),
    });
    assert.equal(resp.statusCode, 200, resp.body);
    const done = parseSseEvent(resp.body, 'done') as { answer?: string; proposals?: unknown[] } | null;
    assert.ok(done, `the proposal was lost with the answer: ${resp.body.slice(0, 300)}`);
    assert.equal(done!.proposals?.length, 1);
    // No wording survived, and the response says that by being empty rather than inventing one.
    assert.equal(done!.answer, '');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

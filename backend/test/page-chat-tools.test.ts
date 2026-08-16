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
    // No proposal was produced (the mock never called a tool), and the shape says so rather than
    // omitting the field.
    assert.deepEqual(JSON.parse(resp.body).proposals, []);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { accountIdFromOwnerSub } from '../src/services/accountContext';
import { getReadonlyAiTools, toOpenAiTools, executeAiTool, type AiToolContext } from '../src/services/aiTools';

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER_A = `aitool-A-${RUN}`;
const OWNER_B = `aitool-B-${RUN}`;
const ACC_A = accountIdFromOwnerSub(OWNER_A);
const ACC_B = accountIdFromOwnerSub(OWNER_B);

function seed(pdfId: string, owner: string, pages: { text: string; script: string }[]): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',?,?,'private',?,?)`,
  ).run(pdfId, `Deck ${pdfId}`, 'd.pdf', pages.length, owner, t, t);
  const dir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  pages.forEach((p, idx) => {
    const n = idx + 1;
    const uid = `u${RUN}-${pdfId}-${n}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,text_path,script_path,status,created_at,updated_at)
       VALUES (?,?,?,?,?,'audio_ready',?,?)`,
    ).run(pdfId, n, uid, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(dir, `${uid}.text.txt`), p.text, 'utf8');
    fs.writeFileSync(path.join(dir, `${uid}.script.txt`), p.script, 'utf8');
  });
}

const tools = getReadonlyAiTools();
const ctxA: AiToolContext = { accountId: ACC_A };
const ctxB: AiToolContext = { accountId: ACC_B };

test('toOpenAiTools exposes only read-only tools with function schema', () => {
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_page_script', 'get_page_text', 'get_presentation', 'list_presentations']);
  // No mutating tools leaked in.
  for (const bad of ['upload_pdf', 'start_generation', 'set_page_script']) {
    assert.ok(!names.includes(bad), `${bad} must not be exposed`);
  }
  const openai = toOpenAiTools(tools);
  assert.equal(openai.length, tools.length);
  assert.ok(openai.every((t) => t.type === 'function' && typeof t.function.name === 'string'));
});

test('list_presentations only returns the current account\'s decks', async () => {
  const pa = `aitool-deck-a-${RUN}`;
  const pb = `aitool-deck-b-${RUN}`;
  seed(pa, OWNER_A, [{ text: 'A頁一文字', script: 'A頁一腳本' }]);
  seed(pb, OWNER_B, [{ text: 'B頁一文字', script: 'B頁一腳本' }]);

  const out = await executeAiTool(tools, 'list_presentations', {}, ctxA);
  assert.match(out, new RegExp(pa));
  assert.doesNotMatch(out, new RegExp(pb), 'must not list another account\'s deck');
});

test('get_page_text / get_page_script read the right page, scoped to account', async () => {
  const pa = `aitool-deck-a-${RUN}`;
  seed(pa, OWNER_A, [
    { text: '第一頁投影片文字ALPHA', script: '第一頁腳本' },
    { text: '第二頁投影片文字BETA', script: '第二頁腳本SCRIPT2' },
  ]);
  assert.match(await executeAiTool(tools, 'get_page_text', { id: pa, page: 2 }, ctxA), /BETA/);
  assert.match(await executeAiTool(tools, 'get_page_script', { id: pa, page: 2 }, ctxA), /SCRIPT2/);
  // default id from ctx.pdfId when omitted
  assert.match(await executeAiTool(tools, 'get_page_text', { page: 1 }, { accountId: ACC_A, pdfId: pa }), /ALPHA/);
});

test('cross-account access is denied for get_presentation / get_page_text', async () => {
  const pa = `aitool-deck-a-${RUN}`;
  seed(pa, OWNER_A, [{ text: 'secretA', script: 's' }]);
  // Account B must not read account A's deck.
  assert.match(await executeAiTool(tools, 'get_presentation', { id: pa }, ctxB), /找不到|無權/);
  assert.match(await executeAiTool(tools, 'get_page_text', { id: pa, page: 1 }, ctxB), /找不到|無權/);
});

test('unknown tool and non-existent page return error strings, never throw', async () => {
  const pa = `aitool-deck-a-${RUN}`;
  seed(pa, OWNER_A, [{ text: 'x', script: 'y' }]);
  assert.match(await executeAiTool(tools, 'does_not_exist', {}, ctxA), /未知工具/);
  assert.match(await executeAiTool(tools, 'get_page_text', { id: pa, page: 99 }, ctxA), /不存在/);
});

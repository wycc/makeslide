import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';

setSystemAuthSettings({ googleAuthEnabled: false });

function testSessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('nbgen-owner'))}` };
const OTHER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('nbgen-other'))}` };

function nowIso(): string { return new Date().toISOString(); }

function seedPdf(id: string, ownerSub = 'nbgen-owner'): void {
  const t = nowIso();
  fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,?,?,?)`,
  ).run(id, 't', 't.pdf', ownerSub, 'private', t, t);
  const pagesDir = path.join(config.storageRoot, id, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,status,created_at,updated_at)
     VALUES (?,1,'nbgenuid1',?,'audio_ready',?,?)`,
  ).run(id, `pages/nbgenuid1.jpg`, t, t);
  fs.writeFileSync(path.join(pagesDir, 'nbgenuid1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
}

function cleanup(id: string): void {
  fs.rmSync(path.join(config.storageRoot, id), { recursive: true, force: true });
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
}

/** Mock the LLM to return a fixed notebook outline JSON. */
function mockOutlineLlm(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                cells: [
                  { type: 'markdown', source: '# 排序演算法' },
                  { type: 'code', source: 'print(sorted([3,1,2]))' },
                ],
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 },
        }),
      },
    },
  } as never);
}

test('POST notebook/generate writes an AI notebook and flips render_type for the owner', async () => {
  const id = `nbgen-200-${Date.now()}`;
  seedPdf(id);
  mockOutlineLlm();
  const app = await buildApp();
  try {
    // Give the (only) page a stored audio duration + deck total, so we can verify converting it
    // to a notebook drops it from the total (phase 5b).
    db.prepare(`UPDATE pages SET audio_duration_seconds = 12 WHERE pdf_id = ? AND page_number = 1`).run(id);
    db.prepare(`UPDATE pdfs SET total_audio_duration_seconds = 12 WHERE id = ?`).run(id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/pages/1/notebook/generate`,
      headers: OWNER_HEADERS,
      payload: { topic: '排序演算法' },
    });
    assert.equal(res.statusCode, 200, `expected 200 but got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    const body = res.json() as { render_type: string; notebook: { cells: Array<{ cell_type: string }> } };
    assert.equal(body.render_type, 'notebook');
    assert.equal(body.notebook.cells.length, 2);
    assert.equal(body.notebook.cells[0].cell_type, 'markdown');
    assert.equal(body.notebook.cells[1].cell_type, 'code');

    // DB flipped to notebook + .ipynb persisted
    const row = db.prepare(`SELECT render_type, notebook_path FROM pages WHERE pdf_id = ? AND page_number = 1`).get(id) as { render_type: string; notebook_path: string };
    assert.equal(row.render_type, 'notebook');
    assert.equal(fs.existsSync(path.join(config.storageRoot, id, 'pages', 'nbgenuid1.ipynb')), true);

    // The deck total was recomputed with the now-notebook page excluded → back to null.
    const pdf = db.prepare(`SELECT total_audio_duration_seconds FROM pdfs WHERE id = ?`).get(id) as { total_audio_duration_seconds: number | null };
    assert.equal(pdf.total_audio_duration_seconds, null);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(id);
    await app.close();
  }
});

test('POST notebook/generate rejects an empty topic with 400', async () => {
  const id = `nbgen-400-${Date.now()}`;
  seedPdf(id);
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/pages/1/notebook/generate`,
      headers: OWNER_HEADERS,
      payload: { topic: '   ' },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    cleanup(id);
    await app.close();
  }
});

test('POST notebook/generate returns 403 for a non-owner', async () => {
  const id = `nbgen-403-${Date.now()}`;
  seedPdf(id, 'nbgen-owner');
  const app = await buildApp();
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/pages/1/notebook/generate`,
      headers: OTHER_HEADERS,
      payload: { topic: '排序演算法' },
    });
    assert.equal(res.statusCode, 403);
  } finally {
    cleanup(id);
    await app.close();
  }
});

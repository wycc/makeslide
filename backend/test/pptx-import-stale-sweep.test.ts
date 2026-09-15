/**
 * The periodic rescan must not kill a pptx import that is still running.
 *
 * `rescanPendingOnStartup` is named for boot but runs every 30 seconds (startServer), and several
 * backend processes can share one database. It used to mark every `processing` pptx import as
 * "interrupted by a restart" — so an import died within 30 seconds of starting, in whichever
 * process ticked next, and the user was told the server had restarted when it had not. An import
 * is dead only when its heartbeat has gone quiet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { failStalePptxImports, PPTX_IMPORT_HEARTBEAT_MS, PPTX_IMPORT_STALE_MS } from '../src/worker/pipeline';

setSystemAuthSettings({ googleAuthEnabled: false });

function cookie(sub = 'stale-sweep-owner'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
const HEADERS = { cookie: `makeslide_session=${encodeURIComponent(cookie())}`, 'content-type': 'application/json' };

function statusOf(id: string): { status: string; error_message: string | null } {
  return db.prepare('SELECT status, error_message FROM pdfs WHERE id = ?').get(id) as { status: string; error_message: string | null };
}

test('only an import whose heartbeat has gone quiet is failed', async (t) => {
  const app = await buildApp();
  const ids: string[] = [];
  t.after(async () => {
    await app.close();
    for (const id of ids) db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
  });

  async function deck(kind: 'pptx' | null, updatedAgoMs: number, now: number): Promise<string> {
    const resp = await app.inject({ method: 'POST', url: '/api/pdfs/blank', headers: HEADERS, payload: { title: 'sweep', category: '課程' } });
    assert.equal(resp.statusCode, 201);
    const id = (resp.json() as { id: string }).id;
    ids.push(id);
    db.prepare(`UPDATE pdfs SET status = 'processing', updated_at = ? WHERE id = ?`).run(new Date(now - updatedAgoMs).toISOString(), id);
    if (kind === 'pptx') {
      db.prepare(
        `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at) VALUES (?, 'pptx', 'x.pptx', '', ?, ?)`,
      ).run(id, new Date(now).toISOString(), new Date(now).toISOString());
    }
    return id;
  }

  const now = Date.now();
  const running = await deck('pptx', 5_000, now);
  const justMissedBeats = await deck('pptx', PPTX_IMPORT_STALE_MS - 1_000, now);
  const dead = await deck('pptx', PPTX_IMPORT_STALE_MS + 1_000, now);
  const pdfPipeline = await deck(null, PPTX_IMPORT_STALE_MS + 60_000, now);

  failStalePptxImports(now);

  // The regression: an import that heard from itself seconds ago was being failed.
  assert.equal(statusOf(running).status, 'processing', '剛回報過心跳的匯入不可以被判定中斷');
  assert.equal(statusOf(justMissedBeats).status, 'processing', 'a few missed beats are tolerated');
  assert.equal(statusOf(dead).status, 'failed');
  assert.match(statusOf(dead).error_message ?? '', /停止回報進度/);
  // Not a pptx deck: the PDF pipeline's own recovery owns it, this sweep must not touch it.
  assert.equal(statusOf(pdfPipeline).status, 'processing');
});

test('the heartbeat is far more frequent than the staleness threshold', () => {
  // A healthy import must never look stale between two beats, even with a delayed timer.
  assert.ok(PPTX_IMPORT_STALE_MS >= PPTX_IMPORT_HEARTBEAT_MS * 5, 'several beats must be missed before an import is declared dead');
});

test('the import beats while it runs and stops when it ends; the rescan uses the stale check', () => {
  const route = fs.readFileSync(fileURLToPath(new URL('../src/routes/pdfs/pptx-import.ts', import.meta.url)), 'utf8');
  const start = route.indexOf('function startImportJob(');
  const body = route.slice(start, route.indexOf('\n}\n', start));
  assert.match(body, /const heartbeat = setInterval\(/);
  assert.match(body, /UPDATE pdfs SET updated_at = \? WHERE id = \? AND status = 'processing'/);
  assert.match(body, /PPTX_IMPORT_HEARTBEAT_MS\)/);
  assert.match(body, /finally \{\s*\n\s*clearInterval\(heartbeat\);/, 'a finished import must stop touching the row');

  const pipeline = fs.readFileSync(fileURLToPath(new URL('../src/worker/pipeline.ts', import.meta.url)), 'utf8');
  const rescan = pipeline.slice(pipeline.indexOf('export function rescanPendingOnStartup('));
  assert.match(rescan.slice(0, 2000), /failStalePptxImports\(\);/);
  // The blanket version must not come back.
  assert.doesNotMatch(pipeline, /PPTX 匯入因伺服器重啟而中斷/);
});

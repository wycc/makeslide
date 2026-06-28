import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import crypto from 'node:crypto';

function testSessionCookie(sub = 'account-1'): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const OWNER_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(testSessionCookie('account-1'))}`, 'content-type': 'application/json' };

setSystemAuthSettings({ googleAuthEnabled: false });

function seedPdf(pdfId: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,'account-1','public',?,?)`,
  ).run(pdfId, 't', `${pdfId}.pdf`, t, t);
}

/** Owner joins as master, then a follower submits one question; returns the question id. */
async function seedOneQuestion(app: Awaited<ReturnType<typeof buildApp>>, id: string): Promise<string> {
  const master = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/sync/join`, headers: OWNER_HEADERS, payload: { client_id: 'master-1' } });
  assert.equal(master.statusCode, 200);
  // share-join the follower so roleFor() === 'follower' for question submission
  await app.inject({ method: 'POST', url: `/api/pdfs/${id}/sync/share-join`, payload: { client_id: 'follower-1' } });
  const q = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/sync/questions`, payload: { client_id: 'follower-1', question: 'hello?' } });
  assert.equal(q.statusCode, 201);
  return (q.json() as { id: string }).id;
}

test('master can delete a single follower question', async () => {
  seedPdf('syncq-del-01');
  const app = await buildApp();
  try {
    const questionId = await seedOneQuestion(app, 'syncq-del-01');
    const del = await app.inject({ method: 'POST', url: '/api/pdfs/syncq-del-01/sync/questions/delete', payload: { client_id: 'master-1', question_id: questionId } });
    assert.equal(del.statusCode, 200);
    const state = await app.inject({ method: 'GET', url: '/api/pdfs/syncq-del-01/sync/state?client_id=master-1' });
    assert.equal((state.json() as { follower_questions: unknown[] }).follower_questions.length, 0);
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run('syncq-del-01');
    await app.close();
  }
});

test('master can clear all follower questions', async () => {
  seedPdf('syncq-clear-01');
  const app = await buildApp();
  try {
    await seedOneQuestion(app, 'syncq-clear-01');
    const clear = await app.inject({ method: 'POST', url: '/api/pdfs/syncq-clear-01/sync/questions/clear', payload: { client_id: 'master-1' } });
    assert.equal(clear.statusCode, 200);
    const state = await app.inject({ method: 'GET', url: '/api/pdfs/syncq-clear-01/sync/state?client_id=master-1' });
    assert.equal((state.json() as { follower_questions: unknown[] }).follower_questions.length, 0);
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run('syncq-clear-01');
    await app.close();
  }
});

test('a non-master client cannot delete or clear follower questions', async () => {
  seedPdf('syncq-perm-01');
  const app = await buildApp();
  try {
    const questionId = await seedOneQuestion(app, 'syncq-perm-01');
    const del = await app.inject({ method: 'POST', url: '/api/pdfs/syncq-perm-01/sync/questions/delete', payload: { client_id: 'follower-1', question_id: questionId } });
    assert.equal(del.statusCode, 403);
    const clear = await app.inject({ method: 'POST', url: '/api/pdfs/syncq-perm-01/sync/questions/clear', payload: { client_id: 'follower-1' } });
    assert.equal(clear.statusCode, 403);
    const state = await app.inject({ method: 'GET', url: '/api/pdfs/syncq-perm-01/sync/state?client_id=master-1' });
    assert.equal((state.json() as { follower_questions: unknown[] }).follower_questions.length, 1, 'question must survive an unauthorized delete/clear');
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run('syncq-perm-01');
    await app.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { buildApp } from '../src/server';

setSystemAuthSettings({ googleAuthEnabled: false });

const RUN = crypto.randomBytes(4).toString('hex');
const OWNER = `narr-owner-${RUN}`;
const OTHER = `narr-other-${RUN}`;

function cookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}
const OWNER_HEADERS = { cookie: cookie(OWNER) };
const OTHER_HEADERS = { cookie: cookie(OTHER) };

function seedPdf(id: string, owner: string): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(id);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(id);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',2,?,'private',?,?)`,
  ).run(id, 'Deck', 'd.pdf', owner, t, t);
}

// multipart body: a `timeline` text field followed by the audio file part.
function narrationBody(timeline: unknown, audio: Buffer): Buffer {
  const head = Buffer.from(
    '------narr\r\n'
    + 'Content-Disposition: form-data; name="timeline"\r\n\r\n'
    + `${JSON.stringify(timeline)}\r\n`
    + '------narr\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n'
    + 'Content-Type: audio/webm\r\n\r\n',
    'utf8',
  );
  const tail = Buffer.from('\r\n------narr--\r\n', 'utf8');
  return Buffer.concat([head, audio, tail]);
}

const MP = 'multipart/form-data; boundary=----narr';
const TIMELINE = { durationMs: 30000, segments: [{ page: 1, startMs: 0, endMs: 15000 }, { page: 2, startMs: 15000, endMs: 30000 }] };
const AUDIO = Buffer.from('fake-webm-opus-bytes', 'utf8');

test('narration round-trip: upload -> get -> audio -> delete (owner)', async () => {
  const id = `narr-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    // before recording: not present
    const before = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal(before.statusCode, 200);
    assert.equal((before.json() as { exists: boolean }).exists, false);

    // upload
    const up = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/narration`,
      headers: { ...OWNER_HEADERS, 'content-type': MP },
      payload: narrationBody(TIMELINE, AUDIO),
    });
    assert.equal(up.statusCode, 201);
    assert.equal((up.json() as { duration_ms: number }).duration_ms, 30000);

    // get metadata
    const meta = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal(meta.statusCode, 200);
    const body = meta.json() as { exists: boolean; duration_ms: number; segments: Array<{ page: number }> };
    assert.equal(body.exists, true);
    assert.equal(body.duration_ms, 30000);
    assert.deepEqual(body.segments.map((s) => s.page), [1, 2]);

    // stream audio
    const audio = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration/audio`, headers: OWNER_HEADERS });
    assert.equal(audio.statusCode, 200);
    assert.equal(audio.headers['content-type'], 'audio/webm');
    assert.equal(audio.rawPayload.toString('utf8'), 'fake-webm-opus-bytes');

    // delete
    const del = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal(del.statusCode, 200);
    const after = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal((after.json() as { exists: boolean }).exists, false);
  } finally {
    await app.close();
  }
});

test('narration upload requires edit permission (non-owner -> 403)', async () => {
  const id = `narr-perm-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/narration`,
      headers: { ...OTHER_HEADERS, 'content-type': MP },
      payload: narrationBody(TIMELINE, AUDIO),
    });
    assert.equal(resp.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('narration upload rejects an invalid timeline (400)', async () => {
  const id = `narr-bad-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/narration`,
      headers: { ...OWNER_HEADERS, 'content-type': MP },
      payload: narrationBody({ durationMs: 'nope', segments: 'bad' }, AUDIO),
    });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});

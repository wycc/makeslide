import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
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
     VALUES (?,?,?,'ready',3,?,'private',?,?)`,
  ).run(id, 'Deck', 'd.pdf', owner, t, t);
}

// multipart body: a `timeline` text field followed by the audio file part.
function segmentBody(timeline: unknown, audio: Buffer): Buffer {
  const head = Buffer.from(
    '------narr\r\n'
    + 'Content-Disposition: form-data; name="timeline"\r\n\r\n'
    + `${JSON.stringify(timeline)}\r\n`
    + '------narr\r\n'
    + 'Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n'
    + 'Content-Type: audio/webm\r\n\r\n',
    'utf8',
  );
  return Buffer.concat([head, audio, Buffer.from('\r\n------narr--\r\n', 'utf8')]);
}
const MP = 'multipart/form-data; boundary=----narr';
const TL1 = { durationMs: 10000, segments: [{ page: 1, startMs: 0, endMs: 10000 }] };
const TL2 = { durationMs: 20000, segments: [{ page: 2, startMs: 0, endMs: 8000 }, { page: 3, startMs: 8000, endMs: 20000 }] };
const AUDIO = Buffer.from('fake-webm-bytes', 'utf8');

async function addSegment(app: Awaited<ReturnType<typeof buildApp>>, id: string, tl: unknown, headers = OWNER_HEADERS) {
  return app.inject({ method: 'POST', url: `/api/pdfs/${id}/narration/segments`, headers: { ...headers, 'content-type': MP }, payload: segmentBody(tl, AUDIO) });
}

test('narration segments: add, list (with pages), reorder, re-record, stream, delete', async () => {
  const id = `narr-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    // empty
    const empty = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual((empty.json() as { segments: unknown[] }).segments, []);

    // add two segments
    const a = await addSegment(app, id, TL1);
    assert.equal(a.statusCode, 201);
    const segA = (a.json() as { id: string }).id;
    const b = await addSegment(app, id, TL2);
    assert.equal(b.statusCode, 201);
    const segB = (b.json() as { id: string }).id;

    // list: two segments, pages per segment
    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    const segs = (list.json() as { segments: Array<{ id: string; pages: number[]; duration_ms: number }> }).segments;
    assert.equal(segs.length, 2);
    assert.deepEqual(segs.map((s) => s.id), [segA, segB]);
    assert.deepEqual(segs[0]!.pages, [1]);
    assert.deepEqual(segs[1]!.pages, [2, 3]);

    // reorder -> [segB, segA]
    const ro = await app.inject({ method: 'PUT', url: `/api/pdfs/${id}/narration/order`, headers: { ...OWNER_HEADERS, 'content-type': 'application/json' }, payload: JSON.stringify({ order: [segB, segA] }) });
    assert.equal(ro.statusCode, 200);
    const list2 = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.deepEqual((list2.json() as { segments: Array<{ id: string }> }).segments.map((s) => s.id), [segB, segA]);

    // re-record segA with a new timeline
    const rr = await app.inject({ method: 'PUT', url: `/api/pdfs/${id}/narration/segments/${segA}`, headers: { ...OWNER_HEADERS, 'content-type': MP }, payload: segmentBody({ durationMs: 5000, segments: [{ page: 3, startMs: 0, endMs: 5000 }] }, AUDIO) });
    assert.equal(rr.statusCode, 200);
    const list3 = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    const after = (list3.json() as { segments: Array<{ id: string; pages: number[] }> }).segments;
    assert.deepEqual(after.find((s) => s.id === segA)!.pages, [3]);

    // stream segment audio
    const audio = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration/segments/${segB}/audio`, headers: OWNER_HEADERS });
    assert.equal(audio.statusCode, 200);
    assert.equal(audio.headers['content-type'], 'audio/webm');
    assert.equal(audio.rawPayload.toString('utf8'), 'fake-webm-bytes');

    // delete segA
    const del = await app.inject({ method: 'DELETE', url: `/api/pdfs/${id}/narration/segments/${segA}`, headers: OWNER_HEADERS });
    assert.equal(del.statusCode, 200);
    const list4 = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.deepEqual((list4.json() as { segments: Array<{ id: string }> }).segments.map((s) => s.id), [segB]);
  } finally {
    await app.close();
  }
});

test('narration transcribe: STT -> per-page transcript, then manual edit', async () => {
  const id = `narr-tr-${RUN}`;
  seedPdf(id, OWNER);
  // mock Whisper word-timestamp transcription
  setOpenAIClientForTest({
    audio: {
      transcriptions: {
        create: async () => ({
          words: [
            { word: 'hello', start: 1, end: 2 },
            { word: 'world', start: 4, end: 5 },
            { word: 'next', start: 12, end: 13 },
          ],
        }),
      },
    },
  } as never);
  const app = await buildApp();
  try {
    const a = await addSegment(app, id, { durationMs: 20000, segments: [{ page: 1, startMs: 0, endMs: 10000 }, { page: 2, startMs: 10000, endMs: 20000 }] });
    const segId = (a.json() as { id: string }).id;

    const tr = await app.inject({ method: 'POST', url: `/api/pdfs/${id}/narration/segments/${segId}/transcribe`, headers: OWNER_HEADERS });
    assert.equal(tr.statusCode, 200);
    assert.deepEqual((tr.json() as { transcript_by_page: Record<string, string> }).transcript_by_page, { '1': 'hello world', '2': 'next' });

    // GET reflects the transcript + word cues (for timed on-slide subtitles)
    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    const seg = (list.json() as { segments: Array<{ id: string; transcript_by_page: Record<string, string>; word_cues: Array<{ tMs: number; word: string }> }> }).segments[0]!;
    assert.equal(seg.transcript_by_page['1'], 'hello world');
    assert.equal(seg.word_cues.length, 3);
    assert.deepEqual(seg.word_cues[0], { tMs: 1000, word: 'hello' });

    // manual edit
    const ed = await app.inject({ method: 'PUT', url: `/api/pdfs/${id}/narration/segments/${segId}/transcript`, headers: { ...OWNER_HEADERS, 'content-type': 'application/json' }, payload: JSON.stringify({ transcript_by_page: { '1': 'edited page one', '2': 'edited two' } }) });
    assert.equal(ed.statusCode, 200);
    const list2 = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    assert.equal((list2.json() as { segments: Array<{ transcript_by_page: Record<string, string> }> }).segments[0]!.transcript_by_page['1'], 'edited page one');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('narration stores and returns cursor + draw tracks', async () => {
  const id = `narr-track-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    const tl = {
      durationMs: 5000,
      segments: [{ page: 1, startMs: 0, endMs: 5000 }],
      cursorTrack: [{ tMs: 0, x: 0.1, y: 0.2 }, { tMs: 100, x: 0.3, y: 0.4 }],
      drawTrack: [{ tMs: 50, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }],
      drawSnapshots: [
        { tMs: 0, data: { strokes: [] } },
        { tMs: 120, data: { strokes: [{ color: '#ef4444', lineWidth: 6, points: [[0.1, 0.1], [0.2, 0.2]] }] } },
        { tMs: 300, data: { strokes: [{ color: '#3b82f6', lineWidth: 3, points: [[0.3, 0.3], [0.4, 0.4]], isEraser: true }] } },
      ],
      audioCues: [
        { startMs: 1000, endMs: 3000, page: 1, fromSec: 0 },
        { startMs: 4000, endMs: 4500, page: 1, fromSec: 2.5 },
      ],
    };
    const a = await addSegment(app, id, tl);
    assert.equal(a.statusCode, 201);
    const list = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/narration`, headers: OWNER_HEADERS });
    const seg = (list.json() as { segments: Array<{ cursor_track: unknown[]; draw_track: Array<{ points: unknown[] }>; draw_snapshots: Array<{ tMs: number; data: { strokes: unknown[] } }>; audio_cues: Array<{ startMs: number; page: number; fromSec: number }> }> }).segments[0]!;
    assert.equal(seg.cursor_track.length, 2);
    assert.equal(seg.draw_track.length, 1);
    assert.equal(seg.draw_track[0]!.points.length, 2);
    assert.equal(seg.draw_snapshots.length, 3);
    assert.equal(seg.draw_snapshots[2]!.data.strokes.length, 1);
    assert.equal(seg.draw_snapshots[1]!.tMs, 120);
    assert.equal(seg.audio_cues.length, 2);
    assert.equal(seg.audio_cues[1]!.fromSec, 2.5);
  } finally {
    await app.close();
  }
});

test('narration segment add requires edit permission (non-owner -> 403)', async () => {
  const id = `narr-perm-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    const resp = await addSegment(app, id, TL1, OTHER_HEADERS);
    assert.equal(resp.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('narration segment add rejects an invalid timeline (400)', async () => {
  const id = `narr-bad-${RUN}`;
  seedPdf(id, OWNER);
  const app = await buildApp();
  try {
    const resp = await addSegment(app, id, { durationMs: 'nope', segments: 'bad' });
    assert.equal(resp.statusCode, 400);
  } finally {
    await app.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';

// Must call this before any HTTP requests to disable Google OAuth on this host
setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

interface SeedOptions {
  ownerSub?: string | null;
  visibility?: string;
  pages?: Array<{
    pageUid: string;
    pageNumber: number;
    audioDurationSeconds?: number | null;
    script?: string;
    timeline?: Array<{ text: string; start: number; end: number }>;
  }>;
}

function seedPdf(pdfId: string, opts: SeedOptions = {}): void {
  const t = nowIso();
  const ownerSub = opts.ownerSub !== undefined ? opts.ownerSub : null;
  const visibility = opts.visibility ?? 'public';

  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
  ).run(pdfId, `Test PDF ${pdfId}`, `${pdfId}.pdf`, (opts.pages?.length ?? 0), ownerSub, visibility, t, t);

  const pdfStorageDir = path.join(config.storageRoot, pdfId);
  const pagesDir = path.join(pdfStorageDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  for (const page of opts.pages ?? []) {
    db.prepare(
      `INSERT INTO pages (pdf_id, page_uid, page_number, status, audio_duration_seconds, created_at, updated_at)
       VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
    ).run(pdfId, page.pageUid, page.pageNumber, page.audioDurationSeconds ?? null, t, t);

    if (page.script !== undefined) {
      fs.writeFileSync(path.join(pagesDir, `${page.pageUid}.script.txt`), page.script, 'utf8');
    }
    if (page.timeline !== undefined) {
      fs.writeFileSync(
        path.join(pagesDir, `${page.pageUid}.timeline.json`),
        JSON.stringify(page.timeline),
        'utf8',
      );
    }
  }
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  const dir = path.join(config.storageRoot, pdfId);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── SRT format with timeline ──────────────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.srt returns SRT format when timeline exists', async () => {
  const pdfId = 'subtitle-srt-timeline01';
  seedPdf(pdfId, {
    pages: [
      {
        pageUid: 'uid-srt-001',
        pageNumber: 1,
        audioDurationSeconds: 10,
        timeline: [
          { text: '第一句話', start: 0, end: 2.5 },
          { text: '第二句話', start: 2.5, end: 5.0 },
        ],
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.srt` });
    assert.equal(resp.statusCode, 200);
    assert.ok(resp.headers['content-type']?.toString().includes('subrip') || resp.headers['content-type']?.toString().includes('text'), 'expected SRT content-type');
    const body = resp.body;
    assert.ok(body.includes('1\n'), 'should contain SRT entry number 1');
    assert.ok(body.includes('00:00:00,000 --> 00:00:02,500'), 'should have correct SRT timestamp for entry 1');
    assert.ok(body.includes('第一句話'), 'should contain first sentence text');
    assert.ok(body.includes('2\n'), 'should contain SRT entry number 2');
    assert.ok(body.includes('00:00:02,500 --> 00:00:05,000'), 'should have correct SRT timestamp for entry 2');
    assert.ok(body.includes('第二句話'), 'should contain second sentence text');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

// ─── VTT format with timeline ──────────────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.vtt returns VTT format when timeline exists', async () => {
  const pdfId = 'subtitle-vtt-timeline01';
  seedPdf(pdfId, {
    pages: [
      {
        pageUid: 'uid-vtt-001',
        pageNumber: 1,
        audioDurationSeconds: 10,
        timeline: [
          { text: 'First sentence', start: 0, end: 2.5 },
          { text: 'Second sentence', start: 2.5, end: 5.0 },
        ],
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.vtt` });
    assert.equal(resp.statusCode, 200);
    assert.ok(resp.headers['content-type']?.toString().includes('vtt'), 'expected VTT content-type');
    const body = resp.body;
    assert.ok(body.startsWith('WEBVTT'), 'should start with WEBVTT header');
    // VTT uses . instead of , for millisecond separator
    assert.ok(body.includes('00:00:00.000 --> 00:00:02.500'), 'should have VTT format timestamp (dot separator)');
    assert.ok(body.includes('First sentence'), 'should contain first sentence text');
    assert.ok(body.includes('00:00:02.500 --> 00:00:05.000'), 'should have correct second VTT timestamp');
    assert.ok(body.includes('Second sentence'), 'should contain second sentence text');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

// ─── Fallback (no timeline, uses script) ────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.srt returns 200 with fallback estimate when no timeline exists', async () => {
  const pdfId = 'subtitle-fallback-srt01';
  seedPdf(pdfId, {
    pages: [
      {
        pageUid: 'uid-fb-001',
        pageNumber: 1,
        audioDurationSeconds: 6,
        script: '第一句。第二句。第三句。',
        // no timeline file
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.srt` });
    assert.equal(resp.statusCode, 200, 'should return 200 even when timeline is missing');
    const body = resp.body;
    // Should have some subtitle content from the script fallback
    assert.ok(body.length > 0, 'should have non-empty body');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

// ─── No audio duration fallback ─────────────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.vtt returns valid empty-ish subtitles when no audio duration', async () => {
  const pdfId = 'subtitle-no-duration01';
  seedPdf(pdfId, {
    pages: [
      {
        pageUid: 'uid-nd-001',
        pageNumber: 1,
        audioDurationSeconds: null,
        script: '一句話。',
        // no timeline file
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.vtt` });
    assert.equal(resp.statusCode, 200, 'should return 200 even with null audio duration');
    const body = resp.body;
    assert.ok(body.startsWith('WEBVTT'), 'should still start with WEBVTT header');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

// ─── 404 for non-existent PDF ────────────────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.srt returns 404 for non-existent PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent01/subtitles.srt' });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('GET /api/pdfs/:id/subtitles.vtt returns 404 for non-existent PDF', async () => {
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/pdfs/nonexistent01/subtitles.vtt' });
    assert.equal(resp.statusCode, 404);
  } finally {
    await app.close();
  }
});

// ─── 403 for private PDF without auth ───────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.srt returns 403 when PDF is private and user is not owner', async () => {
  const pdfId = 'subtitle-private-srt01';
  seedPdf(pdfId, {
    ownerSub: 'google-oauth2|owner-user',
    visibility: 'private',
    pages: [
      {
        pageUid: 'uid-priv-001',
        pageNumber: 1,
        audioDurationSeconds: 5,
        timeline: [{ text: 'secret content', start: 0, end: 5 }],
      },
    ],
  });

  const app = await buildApp();
  try {
    // No session cookie → anonymous request
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.srt` });
    assert.equal(resp.statusCode, 403, 'should return 403 for private PDF without auth');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

test('GET /api/pdfs/:id/subtitles.vtt returns 403 when PDF is private and user is not owner', async () => {
  const pdfId = 'subtitle-private-vtt01';
  seedPdf(pdfId, {
    ownerSub: 'google-oauth2|owner-user',
    visibility: 'private',
    pages: [
      {
        pageUid: 'uid-priv-002',
        pageNumber: 1,
        audioDurationSeconds: 5,
        timeline: [{ text: 'secret content', start: 0, end: 5 }],
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.vtt` });
    assert.equal(resp.statusCode, 403, 'should return 403 for private PDF without auth');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

// ─── Multi-page global offset ────────────────────────────────────────────────

test('GET /api/pdfs/:id/subtitles.srt applies correct global time offset across multiple pages', async () => {
  const pdfId = 'subtitle-multipage-srt01';
  seedPdf(pdfId, {
    pages: [
      {
        pageUid: 'uid-mp-001',
        pageNumber: 1,
        audioDurationSeconds: 10,
        timeline: [
          { text: 'Page 1 sentence', start: 0, end: 5 },
        ],
      },
      {
        pageUid: 'uid-mp-002',
        pageNumber: 2,
        audioDurationSeconds: 8,
        timeline: [
          { text: 'Page 2 sentence', start: 0, end: 4 },
        ],
      },
    ],
  });

  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: `/api/pdfs/${pdfId}/subtitles.srt` });
    assert.equal(resp.statusCode, 200);
    const body = resp.body;
    // Page 1 sentence starts at 0
    assert.ok(body.includes('00:00:00,000 --> 00:00:05,000'), 'page 1 sentence should start at 0');
    // Page 2 sentence should be offset by page 1 audio_duration_seconds (10s)
    assert.ok(body.includes('00:00:10,000 --> 00:00:14,000'), 'page 2 sentence should be offset by 10s');
    assert.ok(body.includes('Page 1 sentence'), 'should contain page 1 text');
    assert.ok(body.includes('Page 2 sentence'), 'should contain page 2 text');
  } finally {
    await app.close();
    cleanup(pdfId);
  }
});

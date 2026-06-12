import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { defaultAnimationSpec, validateAnimationSpec } from '../src/services/pageAnimation';
import { mapAutoFocusResponseToEffects } from '../src/services/animationAutoFocus';

const PDF_ID = 'test-page-animation-01';
const SESSION_COOKIE =
  'eyJwcm92aWRlciI6Imdvb2dsZSIsInN1YiI6ImFjY291bnQtMSIsImVtYWlsIjoiYWNjb3VudC0xQGV4YW1wbGUuY29tIn0.mDkylBa8ZqLOib7FEOYl6YtwwODNJwieo4kUfAIIimw';
const AUTH_HEADERS = { cookie: `makeslide_session=${encodeURIComponent(SESSION_COOKIE)}` };

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedAnimationPdf(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,owner_sub,visibility,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,'account-1','public',NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `animuid${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  }
}

function validSpec(effects: unknown[] = []): Record<string, unknown> {
  return { version: 1, enabled: true, effects };
}

function fadeIn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'effect-1',
    target: 'slide',
    type: 'fade-in',
    start: 0,
    duration: 0.8,
    ease: 'power1.out',
    ...overrides,
  };
}

// ── validateAnimationSpec ─────────────────────────────────────────────────────

test('validateAnimationSpec accepts a valid spec with multiple effects', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn(),
      fadeIn({ id: 'effect-2', type: 'zoom-in', duration: 8, ease: 'none', params: { fromScale: 1, toScale: 1.1 } }),
      fadeIn({ id: 'effect-3', type: 'pan-left', params: { distancePct: 5 } }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects.length, 3);
    assert.deepEqual(result.spec.effects[1].params, { fromScale: 1, toScale: 1.1 });
  }
});

test('validateAnimationSpec rejects wrong version', () => {
  assert.equal(validateAnimationSpec({ version: 2, enabled: true, effects: [] }).ok, false);
});

test('validateAnimationSpec rejects invalid start/duration values', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ start: -1 })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ duration: 0 })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ duration: -5 })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ duration: 601 })])).ok, false);
});

test('validateAnimationSpec enforces effect count limit of 20', () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => fadeIn({ id: `effect-${i + 1}` }));
  assert.equal(validateAnimationSpec(validSpec(make(20))).ok, true);
  assert.equal(validateAnimationSpec(validSpec(make(21))).ok, false);
});

test('validateAnimationSpec rejects unknown effect type, ease and target', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'spin' })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ ease: 'bounce.out' })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ target: 'title' })])).ok, false);
});

test('validateAnimationSpec strips unknown and non-numeric params', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ type: 'zoom-in', params: { toScale: 1.2, evil: 'alert(1)', fromScale: 'x' } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { toScale: 1.2 });
  }
});

test('validateAnimationSpec rejects non-object input', () => {
  assert.equal(validateAnimationSpec(null).ok, false);
  assert.equal(validateAnimationSpec('spec').ok, false);
});

test('validateAnimationSpec accepts and preserves a transcript-line startTrigger', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 2 } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].startTrigger, { type: 'transcript-line', line: 2 });
  }
});

test('validateAnimationSpec rejects an invalid startTrigger', () => {
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: -1 } })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 1.5 } })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 1000 } })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ startTrigger: { type: 'word', line: 0 } })])).ok,
    false,
  );
});

test('validateAnimationSpec accepts and preserves a startTrigger offsetSeconds', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 2, offsetSeconds: 1.5 } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].startTrigger, {
      type: 'transcript-line',
      line: 2,
      offsetSeconds: 1.5,
    });
  }
});

test('validateAnimationSpec accepts highlight-box and spotlight effects with focus params', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({ id: 'effect-1', type: 'highlight-box', params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 } }),
      fadeIn({ id: 'effect-2', type: 'spotlight', params: { xPct: 5, yPct: 5, widthPct: 25, heightPct: 25 } }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 });
    assert.deepEqual(result.spec.effects[1].params, { xPct: 5, yPct: 5, widthPct: 25, heightPct: 25 });
  }
});

test('validateAnimationSpec strips unknown params from highlight-box/spotlight effects', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ type: 'highlight-box', params: { xPct: 10, distancePct: 5, evil: 'alert(1)' } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10 });
  }
});

test('validateAnimationSpec rejects an out-of-range startTrigger offsetSeconds', () => {
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 0, offsetSeconds: -1 } })]),
    ).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ startTrigger: { type: 'transcript-line', line: 0, offsetSeconds: 61 } })]),
    ).ok,
    false,
  );
});

test('validateAnimationSpec accepts a text-callout effect with text and overlay params', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'text-callout',
        text: '重點：這裡是關鍵字',
        params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 15 },
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].text, '重點：這裡是關鍵字');
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 15 });
  }
});

test('validateAnimationSpec rejects a text-callout effect whose text exceeds the max length', () => {
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'text-callout', text: 'x'.repeat(81) })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'text-callout', text: 'x'.repeat(80) })])).ok,
    true,
  );
});

test('validateAnimationSpec accepts and preserves an exitDuration on an overlay effect', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ id: 'effect-1', type: 'highlight-box', exitDuration: 2.5 })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].exitDuration, 2.5);
  }
});

test('validateAnimationSpec omits exitDuration when not provided', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ type: 'highlight-box' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].exitDuration, undefined);
  }
});

test('validateAnimationSpec rejects a negative or out-of-range exitDuration', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'highlight-box', exitDuration: -1 })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'highlight-box', exitDuration: 601 })])).ok, false);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'highlight-box', exitDuration: 0 })])).ok, true);
});

test('validateAnimationSpec accepts and preserves per-sentence hints', () => {
  const result = validateAnimationSpec({ ...validSpec([fadeIn()]), hints: { '0': '放大顯示標題', '2': '指向圖表右下角' } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.hints, { '0': '放大顯示標題', '2': '指向圖表右下角' });
  }
});

test('validateAnimationSpec omits an empty hints object', () => {
  const result = validateAnimationSpec({ ...validSpec([fadeIn()]), hints: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.hints, undefined);
  }
});

test('validateAnimationSpec rejects hints with non-numeric keys', () => {
  assert.equal(validateAnimationSpec({ ...validSpec([fadeIn()]), hints: { foo: 'bar' } }).ok, false);
});

test('validateAnimationSpec rejects a hint value exceeding the max length', () => {
  assert.equal(validateAnimationSpec({ ...validSpec([fadeIn()]), hints: { '0': 'x'.repeat(201) } }).ok, false);
  assert.equal(validateAnimationSpec({ ...validSpec([fadeIn()]), hints: { '0': 'x'.repeat(200) } }).ok, true);
});

test('validateAnimationSpec rejects more than 50 hint entries', () => {
  const hints: Record<string, string> = {};
  for (let i = 0; i < 51; i++) hints[String(i)] = 'hint';
  assert.equal(validateAnimationSpec({ ...validSpec([fadeIn()]), hints }).ok, false);

  const ok: Record<string, string> = {};
  for (let i = 0; i < 50; i++) ok[String(i)] = 'hint';
  assert.equal(validateAnimationSpec({ ...validSpec([fadeIn()]), hints: ok }).ok, true);
});

// ── API ───────────────────────────────────────────────────────────────────────

test('GET animation returns default spec when no file exists', async () => {
  seedAnimationPdf(PDF_ID, 2);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: AUTH_HEADERS,
  });
  assert.equal(resp.statusCode, 200);
  const body = resp.json() as { page_number: number; render_type: string; spec: unknown };
  assert.equal(body.page_number, 1);
  assert.equal(body.render_type, 'static-image');
  assert.deepEqual(body.spec, defaultAnimationSpec());
  await app.close();
});

test('PUT animation with enabled spec writes file and flips render_type', async () => {
  seedAnimationPdf(PDF_ID, 2);
  const app = await buildApp();
  const spec = validSpec([
    fadeIn({ startTrigger: { type: 'transcript-line', line: 0, offsetSeconds: 1.5 } }),
    fadeIn({ id: 'effect-2', type: 'zoom-in', duration: 8, ease: 'none' }),
  ]);
  const putResp = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { spec },
  });
  assert.equal(putResp.statusCode, 200);
  const putBody = putResp.json() as { render_type: string; animation_spec_url: string };
  assert.equal(putBody.render_type, 'gsap-image');
  assert.equal(putBody.animation_spec_url, `api/pdfs/${PDF_ID}/pages/1/animation/spec`);

  const specFile = path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.animation.json');
  assert.equal(fs.existsSync(specFile), true);

  const row = db
    .prepare(`SELECT render_type, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = 1`)
    .get(PDF_ID) as { render_type: string; animation_spec_path: string };
  assert.equal(row.render_type, 'gsap-image');
  assert.equal(row.animation_spec_path, 'pages/animuid1.animation.json');

  // GET /animation/spec serves the stored spec with no-store
  const specResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation/spec`,
    headers: AUTH_HEADERS,
  });
  assert.equal(specResp.statusCode, 200);
  assert.equal(specResp.headers['cache-control'], 'no-store');
  const served = specResp.json() as { enabled: boolean; effects: Array<{ startTrigger?: unknown }> };
  assert.equal(served.enabled, true);
  assert.equal(served.effects.length, 2);
  assert.deepEqual(served.effects[0].startTrigger, { type: 'transcript-line', line: 0, offsetSeconds: 1.5 });

  // detail API exposes render_type and animation_spec_url
  const detailResp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${PDF_ID}`,
    headers: AUTH_HEADERS,
  });
  assert.equal(detailResp.statusCode, 200);
  const detail = detailResp.json() as {
    pages: Array<{ page_number: number; render_type: string; animation_spec_url: string | null }>;
  };
  assert.equal(detail.pages[0].render_type, 'gsap-image');
  assert.equal(detail.pages[0].animation_spec_url, `api/pdfs/${PDF_ID}/pages/1/animation/spec`);
  assert.equal(detail.pages[1].render_type, 'static-image');
  assert.equal(detail.pages[1].animation_spec_url, null);

  await app.close();
});

test('PUT animation with enabled=false keeps the spec file but resets render_type', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  await app.inject({
    method: 'PUT',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { spec: validSpec([fadeIn()]) },
  });
  const resp = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { spec: { version: 1, enabled: false, effects: [fadeIn()] } },
  });
  assert.equal(resp.statusCode, 200);
  assert.equal((resp.json() as { render_type: string }).render_type, 'static-image');
  const row = db
    .prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = 1`)
    .get(PDF_ID) as { render_type: string };
  assert.equal(row.render_type, 'static-image');
  const specFile = path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.animation.json');
  assert.equal(fs.existsSync(specFile), true);
  await app.close();
});

test('PUT animation rejects an invalid spec without touching the page row', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'PUT',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { spec: validSpec([fadeIn({ duration: 0 })]) },
  });
  assert.equal(resp.statusCode, 400);
  const body = resp.json() as { error: { code: string } };
  assert.equal(body.error.code, 'INVALID_ANIMATION_SPEC');
  const row = db
    .prepare(`SELECT render_type, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = 1`)
    .get(PDF_ID) as { render_type: string; animation_spec_path: string | null };
  assert.equal(row.render_type, 'static-image');
  assert.equal(row.animation_spec_path, null);
  await app.close();
});

test('animation endpoints return 404 for an unknown page', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  for (const url of [
    `/api/pdfs/${PDF_ID}/pages/99/animation`,
    `/api/pdfs/${PDF_ID}/pages/99/animation/spec`,
  ]) {
    const resp = await app.inject({ method: 'GET', url, headers: AUTH_HEADERS });
    assert.equal(resp.statusCode, 404);
  }
  await app.close();
});

test('GET animation falls back to the default spec when the stored file is corrupted', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const specFile = path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.animation.json');
  fs.writeFileSync(specFile, '{not-json', 'utf8');
  const app = await buildApp();
  const resp = await app.inject({
    method: 'GET',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation`,
    headers: AUTH_HEADERS,
  });
  assert.equal(resp.statusCode, 200);
  assert.deepEqual((resp.json() as { spec: unknown }).spec, defaultAnimationSpec());
  await app.close();
});

// ── mapAutoFocusResponseToEffects ──────────────────────────────────────────────

test('mapAutoFocusResponseToEffects keeps only show:true items and fills startTrigger/params', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: false },
        { line: 1, show: true, type: 'spotlight', xPct: 10, yPct: 20, widthPct: 30, heightPct: 25, exitDuration: 2 },
        { line: 2, show: true },
      ],
    },
    3,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'spotlight');
  assert.deepEqual(effects[0].startTrigger, { type: 'transcript-line', line: 1 });
  assert.deepEqual(effects[0].params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 25 });
  assert.equal(effects[0].exitDuration, 2);
  assert.equal(effects[1].type, 'highlight-box');
  assert.deepEqual(effects[1].startTrigger, { type: 'transcript-line', line: 2 });
  assert.equal(effects[1].params?.xPct, 30);
  assert.equal(effects[1].exitDuration, undefined);
});

test('mapAutoFocusResponseToEffects drops out-of-range/duplicate lines and clamps values', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, xPct: 200, widthPct: 0, exitDuration: 100 },
        { line: 0, show: true, xPct: 5 },
        { line: 5, show: true },
      ],
    },
    2,
  );
  assert.equal(effects.length, 1);
  assert.equal(effects[0].params?.xPct, 95);
  assert.equal(effects[0].params?.widthPct, 5);
  assert.equal(effects[0].exitDuration, 30);
});

test('mapAutoFocusResponseToEffects output passes validateAnimationSpec', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'highlight-box', xPct: 10, yPct: 10, widthPct: 50, heightPct: 50, exitDuration: 1.5 },
      ],
    },
    1,
  );
  const result = validateAnimationSpec({ version: 1, enabled: true, effects });
  assert.equal(result.ok, true);
});

// ── POST animation/auto-focus-ai ────────────────────────────────────────────────

test('POST animation/auto-focus-ai returns AI-generated effects mapped from sentences', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題\n圖表顯示營收成長', 'utf8');
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  effects: [
                    { line: 0, show: false },
                    { line: 1, show: true, type: 'highlight-box', xPct: 10, yPct: 15, widthPct: 40, heightPct: 30, exitDuration: 2 },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/auto-focus-ai`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { sentences: ['這是開場白。', '請看這張圖表的營收成長。'] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { effects: Array<Record<string, unknown>> };
    assert.equal(body.effects.length, 1);
    assert.deepEqual(body.effects[0].startTrigger, { type: 'transcript-line', line: 1 });
    assert.equal(body.effects[0].type, 'highlight-box');
    assert.deepEqual(body.effects[0].params, { xPct: 10, yPct: 15, widthPct: 40, heightPct: 30 });
    assert.equal(body.effects[0].exitDuration, 2);

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: body.effects });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/auto-focus-ai returns empty effects without calling the LLM when sentences is empty', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${PDF_ID}/pages/1/animation/auto-focus-ai`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { sentences: [] },
  });
  assert.equal(resp.statusCode, 200);
  assert.deepEqual(resp.json(), { effects: [] });
  await app.close();
});

test('POST animation/auto-focus-ai returns 404 for an unknown page', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${PDF_ID}/pages/99/animation/auto-focus-ai`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { sentences: ['句子'] },
  });
  assert.equal(resp.statusCode, 404);
  await app.close();
});

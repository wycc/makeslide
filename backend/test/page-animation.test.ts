import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { getRuntimeAiSettings, setRuntimeAiSettings, setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import {
  ANIMATION_SHAPE_KINDS,
  MAX_CUSTOM_SCRIPT_CODE_LENGTH,
  MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES,
  MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
  MAX_FORMULA_LENGTH,
  MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH,
  MAX_STEP_LIST_ITEMS,
  MAX_STEP_LIST_ITEM_LENGTH,
  MAX_TEXT_CALLOUT_LENGTH,
  defaultAnimationSpec,
  validateAnimationSpec,
} from '../src/services/pageAnimation';
import { fillCustomScriptEffectsCode, mapAutoFocusResponseToEffects } from '../src/services/animationAutoFocus';
import { findCustomScriptContractIssue, findUnsafeScriptPattern } from '../src/services/animationCustomScript';

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

test('validateAnimationSpec accepts a shape effect with each shape kind and overlay params', () => {
  for (const shape of ['circle', 'rect', 'ellipse', 'arrow'] as const) {
    const result = validateAnimationSpec(
      validSpec([
        fadeIn({
          id: 'effect-1',
          type: 'shape',
          shape,
          params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 },
        }),
      ]),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.spec.effects[0].shape, shape);
      assert.deepEqual(result.spec.effects[0].params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 });
    }
  }
});

test('validateAnimationSpec rejects a shape effect with an invalid shape kind', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'shape', shape: 'triangle' })])).ok, false);
});

test('validateAnimationSpec accepts a shape effect without an explicit shape (defaults applied by frontend)', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ id: 'effect-1', type: 'shape' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].shape, undefined);
  }
});

test('validateAnimationSpec strips unknown params from shape effects', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ type: 'shape', shape: 'circle', params: { xPct: 10, distancePct: 5, evil: 'alert(1)' } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10 });
  }
});

test('validateAnimationSpec accepts a step-list effect with items and overlay params', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'step-list',
        items: ['第一步：開啟檔案', '第二步：點選工具', '第三步：完成'],
        params: { xPct: 8, yPct: 18, widthPct: 44, heightPct: 40 },
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].items, ['第一步：開啟檔案', '第二步：點選工具', '第三步：完成']);
    assert.deepEqual(result.spec.effects[0].params, { xPct: 8, yPct: 18, widthPct: 44, heightPct: 40 });
  }
});

test('validateAnimationSpec accepts a step-list effect without items (frontend applies empty default)', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ id: 'effect-1', type: 'step-list' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].items, undefined);
  }
});

test('validateAnimationSpec rejects a step-list effect with more than MAX_STEP_LIST_ITEMS items', () => {
  const items = Array.from({ length: MAX_STEP_LIST_ITEMS }, (_, i) => `item ${i}`);
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'step-list', items })])).ok, true);
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'step-list', items: [...items, 'one too many'] })])).ok,
    false,
  );
});

test('validateAnimationSpec rejects a step-list item exceeding MAX_STEP_LIST_ITEM_LENGTH', () => {
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'step-list', items: ['x'.repeat(MAX_STEP_LIST_ITEM_LENGTH) ] })])).ok,
    true,
  );
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ type: 'step-list', items: ['x'.repeat(MAX_STEP_LIST_ITEM_LENGTH + 1)] })]),
    ).ok,
    false,
  );
});

test('validateAnimationSpec strips unknown params from step-list effects', () => {
  const result = validateAnimationSpec(
    validSpec([fadeIn({ type: 'step-list', params: { xPct: 8, distancePct: 5, evil: 'alert(1)' } })]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 8 });
  }
});

test('validateAnimationSpec accepts an overlay-image effect with a figureId and overlay params', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'overlay-image',
        figureId: 'fig-1',
        params: { xPct: 55, yPct: 55, widthPct: 35, heightPct: 35 },
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].figureId, 'fig-1');
    assert.deepEqual(result.spec.effects[0].params, { xPct: 55, yPct: 55, widthPct: 35, heightPct: 35 });
  }
});

test('validateAnimationSpec accepts an overlay-image effect without a figureId (not yet configured)', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ id: 'effect-1', type: 'overlay-image' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].figureId, undefined);
  }
});

test('validateAnimationSpec rejects an overlay-image effect with an empty figureId', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'overlay-image', figureId: '' })])).ok, false);
});

test('validateAnimationSpec rejects an overlay-image figureId exceeding MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH', () => {
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ type: 'overlay-image', figureId: 'x'.repeat(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH) })]),
    ).ok,
    true,
  );
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ type: 'overlay-image', figureId: 'x'.repeat(MAX_OVERLAY_IMAGE_FIGURE_ID_LENGTH + 1) })]),
    ).ok,
    false,
  );
});

test('validateAnimationSpec strips unknown params from overlay-image effects', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({ type: 'overlay-image', figureId: 'fig-1', params: { xPct: 10, distancePct: 5, evil: 'alert(1)' } }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10 });
  }
});

test('validateAnimationSpec accepts a formula effect with a formula and overlay params', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'formula',
        formula: 'E = mc^2',
        params: { xPct: 30, yPct: 40, widthPct: 40, heightPct: 20 },
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].formula, 'E = mc^2');
    assert.deepEqual(result.spec.effects[0].params, { xPct: 30, yPct: 40, widthPct: 40, heightPct: 20 });
  }
});

test('validateAnimationSpec accepts a formula effect without a formula (not yet configured)', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ id: 'effect-1', type: 'formula' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].formula, undefined);
  }
});

test('validateAnimationSpec rejects a formula effect with an empty formula', () => {
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'formula', formula: '' })])).ok, false);
});

test('validateAnimationSpec rejects a formula exceeding MAX_FORMULA_LENGTH', () => {
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'formula', formula: 'x'.repeat(MAX_FORMULA_LENGTH) })])).ok,
    true,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'formula', formula: 'x'.repeat(MAX_FORMULA_LENGTH + 1) })])).ok,
    false,
  );
});

test('validateAnimationSpec strips unknown params from formula effects', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({ type: 'formula', formula: 'E = mc^2', params: { xPct: 10, distancePct: 5, evil: 'alert(1)' } }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10 });
  }
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

test('validateAnimationSpec accepts a custom-script effect with code and prompt', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'custom-script',
        code: 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };',
        prompt: '畫一個會旋轉的圓形',
        params: { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 },
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.spec.effects[0].code ?? '', /renderAnimation/);
    assert.equal(result.spec.effects[0].prompt, '畫一個會旋轉的圓形');
    assert.deepEqual(result.spec.effects[0].params, { xPct: 10, yPct: 20, widthPct: 30, heightPct: 40 });
  }
});

test('validateAnimationSpec rejects a custom-script effect whose code or prompt exceed the max length', () => {
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', code: 'x'.repeat(24001) })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', code: 'x'.repeat(24000) })])).ok,
    true,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', prompt: 'x'.repeat(301) })])).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', prompt: 'x'.repeat(300) })])).ok,
    true,
  );
});

test('validateAnimationSpec accepts and preserves a custom-script effect with conversation history', () => {
  const result = validateAnimationSpec(
    validSpec([
      fadeIn({
        id: 'effect-1',
        type: 'custom-script',
        code: 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };',
        conversation: [
          { role: 'user', content: '畫一個圓形' },
          { role: 'assistant', content: '已產生動畫程式碼' },
        ],
      }),
    ]),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.spec.effects[0].conversation, [
      { role: 'user', content: '畫一個圓形' },
      { role: 'assistant', content: '已產生動畫程式碼' },
    ]);
  }
});

test('validateAnimationSpec omits conversation when not provided', () => {
  const result = validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script' })]));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spec.effects[0].conversation, undefined);
  }
});

test('validateAnimationSpec rejects a conversation with an invalid role or over-length content', () => {
  assert.equal(
    validateAnimationSpec(
      validSpec([fadeIn({ type: 'custom-script', conversation: [{ role: 'system', content: 'x' }] })]),
    ).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(
      validSpec([
        fadeIn({
          type: 'custom-script',
          conversation: [{ role: 'user', content: 'x'.repeat(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH + 1) }],
        }),
      ]),
    ).ok,
    false,
  );
  assert.equal(
    validateAnimationSpec(
      validSpec([
        fadeIn({
          type: 'custom-script',
          conversation: [{ role: 'user', content: 'x'.repeat(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH) }],
        }),
      ]),
    ).ok,
    true,
  );
});

test('validateAnimationSpec rejects a conversation exceeding MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES', () => {
  const tooMany = Array.from({ length: MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES + 1 }, () => ({
    role: 'user' as const,
    content: 'x',
  }));
  assert.equal(
    validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', conversation: tooMany })])).ok,
    false,
  );

  const ok = Array.from({ length: MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES }, () => ({
    role: 'user' as const,
    content: 'x',
  }));
  assert.equal(validateAnimationSpec(validSpec([fadeIn({ type: 'custom-script', conversation: ok })])).ok, true);
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

test('mapAutoFocusResponseToEffects maps text-callout items with text, truncating to MAX_TEXT_CALLOUT_LENGTH', () => {
  const longText = 'A'.repeat(MAX_TEXT_CALLOUT_LENGTH + 20);
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'text-callout', text: '營收成長 35%', xPct: 8, yPct: 78, widthPct: 40, heightPct: 14, exitDuration: 3 },
        { line: 1, show: true, type: 'text-callout', text: longText },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'text-callout');
  assert.equal(effects[0].text, '營收成長 35%');
  assert.deepEqual(effects[0].params, { xPct: 8, yPct: 78, widthPct: 40, heightPct: 14 });
  assert.equal(effects[0].exitDuration, 3);
  assert.equal(effects[1].type, 'text-callout');
  assert.equal(effects[1].text?.length, MAX_TEXT_CALLOUT_LENGTH);
});

test('mapAutoFocusResponseToEffects falls back text-callout without text to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'text-callout' },
        { line: 1, show: true, type: 'text-callout', text: '   ' },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'highlight-box');
  assert.equal(effects[0].text, undefined);
  assert.equal(effects[1].type, 'highlight-box');
  assert.equal(effects[1].text, undefined);
});

test('mapAutoFocusResponseToEffects text-callout output passes validateAnimationSpec', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'text-callout', text: '重點摘要', xPct: 10, yPct: 80, widthPct: 40, heightPct: 12 },
      ],
    },
    1,
  );
  const result = validateAnimationSpec({ version: 1, enabled: true, effects });
  assert.equal(result.ok, true);
});

test('mapAutoFocusResponseToEffects maps shape items with the given shape kind', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'shape', shape: 'arrow', xPct: 40, yPct: 35, widthPct: 15, heightPct: 15, exitDuration: 2 },
        { line: 1, show: true, type: 'shape' },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'shape');
  assert.equal(effects[0].shape, 'arrow');
  assert.equal(effects[0].exitDuration, 2);
  assert.equal(effects[1].type, 'shape');
  assert.equal(effects[1].shape, undefined);
});

test('mapAutoFocusResponseToEffects shape output passes validateAnimationSpec', () => {
  for (const shape of ANIMATION_SHAPE_KINDS) {
    const effects = mapAutoFocusResponseToEffects(
      { effects: [{ line: 0, show: true, type: 'shape', shape, xPct: 10, yPct: 10, widthPct: 30, heightPct: 30 }] },
      1,
    );
    const result = validateAnimationSpec({ version: 1, enabled: true, effects });
    assert.equal(result.ok, true);
  }
});

test('mapAutoFocusResponseToEffects maps step-list items, dropping blanks and capping count/length', () => {
  const longItem = 'A'.repeat(MAX_STEP_LIST_ITEM_LENGTH + 20);
  const tooMany = Array.from({ length: MAX_STEP_LIST_ITEMS + 3 }, (_, i) => `步驟 ${i + 1}`);
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        {
          line: 0,
          show: true,
          type: 'step-list',
          items: ['  第一步  ', '', '   ', longItem],
          xPct: 55,
          yPct: 60,
          widthPct: 35,
          heightPct: 30,
          exitDuration: 4,
        },
        { line: 1, show: true, type: 'step-list', items: tooMany },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'step-list');
  assert.deepEqual(effects[0].items, ['第一步', longItem.slice(0, MAX_STEP_LIST_ITEM_LENGTH)]);
  assert.equal(effects[0].exitDuration, 4);
  assert.equal(effects[1].type, 'step-list');
  assert.equal(effects[1].items?.length, MAX_STEP_LIST_ITEMS);
});

test('mapAutoFocusResponseToEffects falls back step-list without usable items to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'step-list' },
        { line: 1, show: true, type: 'step-list', items: ['   ', ''] },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'highlight-box');
  assert.equal(effects[0].items, undefined);
  assert.equal(effects[1].type, 'highlight-box');
  assert.equal(effects[1].items, undefined);
});

test('mapAutoFocusResponseToEffects step-list output passes validateAnimationSpec', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'step-list', items: ['第一步', '第二步', '第三步'], xPct: 55, yPct: 60, widthPct: 35, heightPct: 30 },
      ],
    },
    1,
  );
  const result = validateAnimationSpec({ version: 1, enabled: true, effects });
  assert.equal(result.ok, true);
});

test('mapAutoFocusResponseToEffects maps custom-script items, truncating scriptPrompt and clamping scriptDurationSeconds', () => {
  const longPrompt = 'A'.repeat(MAX_CUSTOM_SCRIPT_PROMPT_LENGTH + 20);
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        {
          line: 0,
          show: true,
          type: 'custom-script',
          scriptPrompt: longPrompt,
          scriptDurationSeconds: 100,
          xPct: 50,
          yPct: 50,
          widthPct: 40,
          heightPct: 40,
          exitDuration: 2,
        },
      ],
    },
    1,
  );
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'custom-script');
  assert.equal(effects[0].prompt?.length, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH);
  assert.equal(effects[0].duration, 20);
  assert.equal(effects[0].code, undefined);
  assert.equal(effects[0].exitDuration, 2);
});

test('mapAutoFocusResponseToEffects defaults custom-script duration to 6s when scriptDurationSeconds is omitted', () => {
  const effects = mapAutoFocusResponseToEffects(
    { effects: [{ line: 0, show: true, type: 'custom-script', scriptPrompt: '畫一個會成長的長條圖' }] },
    1,
  );
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'custom-script');
  assert.equal(effects[0].prompt, '畫一個會成長的長條圖');
  assert.equal(effects[0].duration, 6);
});

test('mapAutoFocusResponseToEffects falls back custom-script without scriptPrompt to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'custom-script' },
        { line: 1, show: true, type: 'custom-script', scriptPrompt: '   ' },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'highlight-box');
  assert.equal(effects[0].prompt, undefined);
  assert.equal(effects[0].duration, 1.2);
  assert.equal(effects[1].type, 'highlight-box');
  assert.equal(effects[1].prompt, undefined);
  assert.equal(effects[1].duration, 1.2);
});

test('mapAutoFocusResponseToEffects caps custom-script effects at one per page, falling back extras to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        { line: 0, show: true, type: 'custom-script', scriptPrompt: '畫一個座標平面，顯示一個點沿曲線移動' },
        { line: 1, show: true, type: 'custom-script', scriptPrompt: '畫一個長條圖，顯示數值逐漸增加' },
      ],
    },
    2,
  );
  assert.equal(effects.length, 2);
  assert.equal(effects[0].type, 'custom-script');
  assert.equal(effects[0].prompt, '畫一個座標平面，顯示一個點沿曲線移動');
  assert.equal(effects[1].type, 'highlight-box');
  assert.equal(effects[1].prompt, undefined);
});

test('mapAutoFocusResponseToEffects custom-script output (with prompt, no code) passes validateAnimationSpec', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        {
          line: 0,
          show: true,
          type: 'custom-script',
          scriptPrompt: '畫一個座標平面，顯示一個點沿曲線移動',
          xPct: 50,
          yPct: 50,
          widthPct: 40,
          heightPct: 40,
        },
      ],
    },
    1,
  );
  const result = validateAnimationSpec({ version: 1, enabled: true, effects });
  assert.equal(result.ok, true);
});

test('mapAutoFocusResponseToEffects maps formula items, carrying formulaLatex as effect.formula', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        {
          line: 0,
          show: true,
          type: 'formula',
          formulaLatex: 'E = mc^2',
          xPct: 30,
          yPct: 40,
          widthPct: 40,
          heightPct: 15,
          exitDuration: 3,
        },
      ],
    },
    1,
  );
  assert.equal(effects.length, 1);
  assert.equal(effects[0]?.type, 'formula');
  assert.equal(effects[0]?.formula, 'E = mc^2');
  assert.equal(effects[0]?.exitDuration, 3);
});

test('mapAutoFocusResponseToEffects truncates formulaLatex to MAX_FORMULA_LENGTH', () => {
  const longLatex = 'x'.repeat(MAX_FORMULA_LENGTH + 10);
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [{ line: 0, show: true, type: 'formula', formulaLatex: longLatex, xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }],
    },
    1,
  );
  assert.equal(effects[0]?.type, 'formula');
  assert.equal(effects[0]?.formula?.length, MAX_FORMULA_LENGTH);
});

test('mapAutoFocusResponseToEffects falls back formula without formulaLatex to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [{ line: 0, show: true, type: 'formula', xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }],
    },
    1,
  );
  assert.equal(effects[0]?.type, 'highlight-box');
  assert.equal(effects[0]?.formula, undefined);
});

test('mapAutoFocusResponseToEffects falls back formula with empty formulaLatex to highlight-box', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [{ line: 0, show: true, type: 'formula', formulaLatex: '   ', xPct: 10, yPct: 10, widthPct: 30, heightPct: 10 }],
    },
    1,
  );
  assert.equal(effects[0]?.type, 'highlight-box');
  assert.equal(effects[0]?.formula, undefined);
});

test('mapAutoFocusResponseToEffects formula output passes validateAnimationSpec', () => {
  const effects = mapAutoFocusResponseToEffects(
    {
      effects: [
        {
          line: 0,
          show: true,
          type: 'formula',
          formulaLatex: '\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
          xPct: 20,
          yPct: 30,
          widthPct: 60,
          heightPct: 20,
        },
      ],
    },
    1,
  );
  const result = validateAnimationSpec({ version: 1, enabled: true, effects });
  assert.equal(result.ok, true);
  assert.equal(result.spec?.effects[0]?.formula, '\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}');
});

// ── fillCustomScriptEffectsCode ─────────────────────────────────────────────────

test('fillCustomScriptEffectsCode fills in code for a custom-script effect generated from its prompt', async () => {
  const generatedCode =
    'window.renderAnimation = function (root, api) { api.onFrame(function (frame) { root.style.opacity = String(Math.min(1, frame.t)); }); };';
  let capturedMessages: Array<{ role: string; content: unknown }> | undefined;
  setOpenAIClientForTest(streamingChatClient(generatedCode, (messages) => { capturedMessages = messages; }) as never);
  try {
    const effects = mapAutoFocusResponseToEffects(
      { effects: [{ line: 0, show: true, type: 'custom-script', scriptPrompt: '畫一個會旋轉的圓形' }] },
      1,
    );
    const filled = await fillCustomScriptEffectsCode(effects, { pageText: '頁面標題：銷售趨勢', label: 'test' });
    assert.equal(filled.length, 1);
    assert.equal(filled[0].type, 'custom-script');
    assert.equal(filled[0].code, generatedCode);
    assert.equal(filled[0].prompt, '畫一個會旋轉的圓形');

    const userMessage = capturedMessages?.find((m) => m.role === 'user');
    assert.match(String(userMessage?.content), /畫一個會旋轉的圓形/);

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: filled });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('fillCustomScriptEffectsCode falls back to highlight-box when generated code is unsafe', async () => {
  setOpenAIClientForTest(streamingChatClient('fetch("https://evil.example").then(function () {});') as never);
  try {
    const effects = mapAutoFocusResponseToEffects(
      { effects: [{ line: 0, show: true, type: 'custom-script', scriptPrompt: '畫一個會旋轉的圓形' }] },
      1,
    );
    const filled = await fillCustomScriptEffectsCode(effects, { pageText: '頁面標題', label: 'test' });
    assert.equal(filled.length, 1);
    assert.equal(filled[0].type, 'highlight-box');
    assert.equal(filled[0].code, undefined);
    assert.equal(filled[0].prompt, undefined);
    assert.equal(filled[0].duration, 1.2);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('fillCustomScriptEffectsCode falls back to highlight-box when generated code misses the render contract', async () => {
  setOpenAIClientForTest(streamingChatClient('var canvas = document.createElement("canvas");') as never);
  try {
    const effects = mapAutoFocusResponseToEffects(
      { effects: [{ line: 0, show: true, type: 'custom-script', scriptPrompt: '畫一個會旋轉的圓形' }] },
      1,
    );
    const filled = await fillCustomScriptEffectsCode(effects, { pageText: '頁面標題', label: 'test' });
    assert.equal(filled.length, 1);
    assert.equal(filled[0].type, 'highlight-box');
    assert.equal(filled[0].code, undefined);
    assert.equal(filled[0].prompt, undefined);
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('fillCustomScriptEffectsCode leaves non-custom-script effects untouched without calling the LLM', async () => {
  let called = false;
  setOpenAIClientForTest({
    chat: { completions: { create: async () => { called = true; throw new Error('should not be called'); } } },
  } as never);
  try {
    const effects = mapAutoFocusResponseToEffects(
      { effects: [{ line: 0, show: true, type: 'highlight-box', xPct: 10, yPct: 10, widthPct: 30, heightPct: 30 }] },
      1,
    );
    const filled = await fillCustomScriptEffectsCode(effects, { pageText: '頁面標題', label: 'test' });
    assert.equal(filled.length, 1);
    assert.equal(filled[0].type, 'highlight-box');
    assert.equal(called, false);
  } finally {
    setOpenAIClientForTest(null);
  }
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

test('POST animation/auto-focus-ai returns a text-callout effect with caption text', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題\n圖表顯示營收成長 35%', 'utf8');
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  effects: [
                    {
                      line: 0,
                      show: true,
                      type: 'text-callout',
                      text: '營收成長 35%',
                      xPct: 8,
                      yPct: 78,
                      widthPct: 40,
                      heightPct: 14,
                      exitDuration: 3,
                    },
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
      payload: { sentences: ['請看這張圖表，營收成長了 35%。'] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { effects: Array<Record<string, unknown>> };
    assert.equal(body.effects.length, 1);
    assert.equal(body.effects[0].type, 'text-callout');
    assert.equal(body.effects[0].text, '營收成長 35%');
    assert.deepEqual(body.effects[0].params, { xPct: 8, yPct: 78, widthPct: 40, heightPct: 14 });

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: body.effects });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/auto-focus-ai returns shape and step-list effects', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '操作步驟說明\n請依箭頭指示完成三個步驟', 'utf8');
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  effects: [
                    {
                      line: 0,
                      show: true,
                      type: 'shape',
                      shape: 'arrow',
                      xPct: 40,
                      yPct: 35,
                      widthPct: 15,
                      heightPct: 15,
                      exitDuration: 2,
                    },
                    {
                      line: 1,
                      show: true,
                      type: 'step-list',
                      items: ['第一步：開啟設定', '第二步：選擇選項', '第三步：儲存'],
                      xPct: 55,
                      yPct: 55,
                      widthPct: 35,
                      heightPct: 30,
                      exitDuration: 4,
                    },
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
      payload: { sentences: ['請看這個箭頭指向的按鈕。', '依照清單上的三個步驟操作。'] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { effects: Array<Record<string, unknown>> };
    assert.equal(body.effects.length, 2);
    assert.equal(body.effects[0].type, 'shape');
    assert.equal(body.effects[0].shape, 'arrow');
    assert.equal(body.effects[1].type, 'step-list');
    assert.deepEqual(body.effects[1].items, ['第一步：開啟設定', '第二步：選擇選項', '第三步：儲存']);

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: body.effects });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

/**
 * Builds an OpenAI client stub for `/auto-focus-ai`'s combined flow: the main
 * (non-streaming) `callChatJSON` call returns `jsonResponse`, and any
 * follow-up streaming call (from `fillCustomScriptEffectsCode`'s
 * `generateCustomScriptCodeStream`) streams `generatedCode` — distinguished
 * by the `stream` flag on the request body.
 */
function autoFocusCustomScriptClient(jsonResponse: unknown, generatedCode: string) {
  return {
    chat: {
      completions: {
        create: async (body: unknown) => {
          const { stream } = body as { stream?: boolean };
          if (stream) {
            const chunkSize = Math.max(1, Math.ceil(generatedCode.length / 3));
            const pieces: string[] = [];
            for (let i = 0; i < generatedCode.length; i += chunkSize) pieces.push(generatedCode.slice(i, i + chunkSize));
            return {
              [Symbol.asyncIterator]: async function* () {
                for (const piece of pieces) {
                  yield { choices: [{ delta: { content: piece }, finish_reason: null }] };
                }
                yield {
                  choices: [{ delta: {}, finish_reason: 'stop' }],
                  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
                };
              },
            };
          }
          return {
            choices: [{ message: { content: JSON.stringify(jsonResponse) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  };
}

test('POST animation/auto-focus-ai returns a custom-script effect with AI-generated code', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題\n數值從 10 成長到 100', 'utf8');
  const generatedCode =
    'window.renderAnimation = function (root, api) { api.onFrame(function (frame) { root.style.opacity = String(Math.min(1, frame.t)); }); };';
  setOpenAIClientForTest(
    autoFocusCustomScriptClient(
      {
        effects: [
          {
            line: 0,
            show: true,
            type: 'custom-script',
            scriptPrompt: '畫一個座標平面，顯示一個點沿曲線從左下移動到右上，代表數值隨時間成長',
            scriptDurationSeconds: 8,
            xPct: 50,
            yPct: 50,
            widthPct: 40,
            heightPct: 40,
            exitDuration: 2,
          },
        ],
      },
      generatedCode,
    ) as never,
  );

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/auto-focus-ai`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { sentences: ['數值從 10 成長到 100。'] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { effects: Array<Record<string, unknown>> };
    assert.equal(body.effects.length, 1);
    assert.equal(body.effects[0].type, 'custom-script');
    assert.equal(body.effects[0].code, generatedCode);
    assert.equal(body.effects[0].prompt, '畫一個座標平面，顯示一個點沿曲線從左下移動到右上，代表數值隨時間成長');
    assert.equal(body.effects[0].duration, 8);

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: body.effects });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/auto-focus-ai falls back a custom-script effect to highlight-box when generated code is unsafe', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題\n數值從 10 成長到 100', 'utf8');
  setOpenAIClientForTest(
    autoFocusCustomScriptClient(
      {
        effects: [
          {
            line: 0,
            show: true,
            type: 'custom-script',
            scriptPrompt: '畫一個座標平面，顯示一個點沿曲線從左下移動到右上，代表數值隨時間成長',
            xPct: 50,
            yPct: 50,
            widthPct: 40,
            heightPct: 40,
          },
        ],
      },
      'fetch("https://evil.example").then(function () {});',
    ) as never,
  );

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/auto-focus-ai`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { sentences: ['數值從 10 成長到 100。'] },
    });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { effects: Array<Record<string, unknown>> };
    assert.equal(body.effects.length, 1);
    assert.equal(body.effects[0].type, 'highlight-box');
    assert.equal(body.effects[0].code, undefined);
    assert.equal(body.effects[0].prompt, undefined);

    const validated = validateAnimationSpec({ version: 1, enabled: true, effects: body.effects });
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/auto-focus-ai attaches the page image as vision input when available', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題\n圖表顯示營收成長', 'utf8');
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.jpg'), jpeg);

  let capturedMessages: Array<{ role: string; content: unknown }> | undefined;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async (body: unknown) => {
          capturedMessages = (body as { messages: Array<{ role: string; content: unknown }> }).messages;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    effects: [{ line: 0, show: true, type: 'spotlight', xPct: 5, yPct: 5, widthPct: 20, heightPct: 20 }],
                  }),
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          };
        },
      },
    },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/auto-focus-ai`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { sentences: ['請看這張圖表的營收成長。'] },
    });
    assert.equal(resp.statusCode, 200);

    const userMessage = capturedMessages?.find((m) => m.role === 'user');
    const parts = userMessage?.content as Array<{ type: string; image_url?: { url: string } }> | undefined;
    assert.ok(Array.isArray(parts));
    const imagePart = parts.find((p) => p.type === 'image_url');
    assert.ok(imagePart);
    assert.match(imagePart!.image_url!.url, /^data:image\/jpeg;base64,/);
    assert.ok(parts.some((p) => p.type === 'text'));
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

// ── findUnsafeScriptPattern ──────────────────────────────────────────────────

test('findUnsafeScriptPattern returns null for safe canvas-based code', () => {
  const code = [
    'window.renderAnimation = function (root, api) {',
    '  var canvas = document.createElement("canvas");',
    '  root.appendChild(canvas);',
    '  api.onFrame(function (frame) {',
    '    var ctx = canvas.getContext("2d");',
    '    ctx.clearRect(0, 0, canvas.width, canvas.height);',
    '    ctx.fillRect(0, 0, frame.t * 10, 10);',
    '  });',
    '};',
  ].join('\n');
  assert.equal(findUnsafeScriptPattern(code), null);
});

test('findUnsafeScriptPattern flags each disallowed API', () => {
  assert.equal(findUnsafeScriptPattern('fetch("https://evil.example")'), 'fetch');
  assert.equal(findUnsafeScriptPattern('new XMLHttpRequest()'), 'XMLHttpRequest');
  assert.equal(findUnsafeScriptPattern('new WebSocket("wss://evil.example")'), 'WebSocket');
  assert.equal(findUnsafeScriptPattern('import("./evil.js")'), 'import');
  assert.equal(findUnsafeScriptPattern('require("fs")'), 'require');
  assert.equal(findUnsafeScriptPattern('eval("alert(1)")'), 'eval');
  assert.equal(findUnsafeScriptPattern('new Function("return 1")()'), 'new Function');
  assert.equal(findUnsafeScriptPattern('document.cookie = "x=1"'), 'document.cookie');
  assert.equal(findUnsafeScriptPattern('localStorage.getItem("x")'), 'localStorage');
  assert.equal(findUnsafeScriptPattern('sessionStorage.getItem("x")'), 'sessionStorage');
  assert.equal(findUnsafeScriptPattern('indexedDB.open("db")'), 'indexedDB');
  assert.equal(findUnsafeScriptPattern('window.parent.postMessage("x", "*")'), 'window.parent');
  assert.equal(findUnsafeScriptPattern('window.top.location'), 'window.top');
  assert.equal(findUnsafeScriptPattern('window.frameElement'), 'frameElement');
});

test('findUnsafeScriptPattern flags common member-access variants', () => {
  assert.equal(findUnsafeScriptPattern('document [ "cookie" ] = "x=1"'), 'document.cookie');
  assert.equal(findUnsafeScriptPattern('globalThis.parent.postMessage("x", "*")'), 'window.parent');
  assert.equal(findUnsafeScriptPattern('self["parent"].postMessage("x", "*")'), 'window.parent');
  assert.equal(findUnsafeScriptPattern('globalThis.top.location.href = "https://evil.example"'), 'window.top');
  assert.equal(findUnsafeScriptPattern('self["top"].location'), 'window.top');
});

test('findUnsafeScriptPattern allows Manim.tex call patterns without flagging them', () => {
  // Manim.tex() internally uses window.parent.postMessage, but the AI-generated
  // code only calls Manim.tex() — it doesn't write window.parent directly.
  const manualTeXUsage = `
window.renderAnimation = async function (root, api) {
  const el = await Manim.tex('E = mc^2', { color: 'white', fontSize: '1.5em' });
  root.appendChild(el);
  api.onFrame(function ({ t }) {
    el.style.opacity = Math.min(t / api.duration, 1);
  });
};`;
  assert.equal(findUnsafeScriptPattern(manualTeXUsage), null, 'Manim.tex() call should be safe');

  const thenChain = `
window.renderAnimation = function (root, api) {
  Manim.tex('\\\\frac{a}{b}').then(function (el) { root.appendChild(el); });
  api.onFrame(function () {});
};`;
  assert.equal(findUnsafeScriptPattern(thenChain), null, 'Manim.tex().then() chain should be safe');

  // Bare identifiers like "parent" or "postMessage" in variable names / strings
  // must NOT be flagged — only qualified window.parent / globalThis.parent accesses.
  assert.equal(findUnsafeScriptPattern('var parentEl = root.parentElement;'), null, '"parent" as identifier should be safe');
  assert.equal(findUnsafeScriptPattern('el.postMessage = function () {};'), null, 'arbitrary .postMessage property should be safe');
});

test('findCustomScriptContractIssue validates renderAnimation and onFrame contract', () => {
  assert.equal(findCustomScriptContractIssue('var x = 1;'), 'Generated code must define window.renderAnimation(root, api)');
  assert.equal(
    findCustomScriptContractIssue('window.renderAnimation = function (root, api) { root.textContent = "hi"; };'),
    'Generated code must call api.onFrame(callback) so playback can stay synchronized',
  );
  assert.equal(
    findCustomScriptContractIssue('window.renderAnimation = function (root, api) { api.onFrame(function () {}); };'),
    null,
  );
});

// ── POST animation/custom-script ─────────────────────────────────────────────

/**
 * Builds an OpenAI client stub whose `chat.completions.create` returns an
 * async-iterable stream of `ChatCompletionChunk`-shaped objects, splitting
 * `text` into a few delta chunks followed by a final chunk carrying
 * `finish_reason` and `usage` — mirroring `stream: true` responses.
 */
function streamingChatClient(
  text: string,
  onMessages?: (messages: Array<{ role: string; content: unknown }>) => void,
) {
  return {
    chat: {
      completions: {
        create: async (body: unknown) => {
          const { messages } = body as { messages: Array<{ role: string; content: unknown }> };
          onMessages?.(messages);
          const chunkSize = Math.max(1, Math.ceil(text.length / 3));
          const pieces: string[] = [];
          for (let i = 0; i < text.length; i += chunkSize) pieces.push(text.slice(i, i + chunkSize));
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const piece of pieces) {
                yield { choices: [{ delta: { content: piece }, finish_reason: null }] };
              }
              yield {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
              };
            },
          };
        },
      },
    },
  };
}

/**
 * Builds an OpenAI client stub like `streamingChatClient`, but returns
 * `planText` for the step-1 (plan) system prompt and `codeText` for the
 * step-2 (code) system prompt — distinguished by whether the system prompt
 * mentions `window.renderAnimation` (only the code prompt does). `onCall` is
 * invoked with each call's `messages`, in call order.
 */
function twoPhaseStreamingChatClient(
  planText: string,
  codeText: string,
  onCall?: (messages: Array<{ role: string; content: unknown }>) => void,
) {
  return {
    chat: {
      completions: {
        create: async (body: unknown) => {
          const { messages } = body as { messages: Array<{ role: string; content: unknown }> };
          onCall?.(messages);
          const isCodeStep = String(messages[0]?.content ?? '').includes('window.renderAnimation');
          const text = isCodeStep ? codeText : planText;
          const chunkSize = Math.max(1, Math.ceil(text.length / 3));
          const pieces: string[] = [];
          for (let i = 0; i < text.length; i += chunkSize) pieces.push(text.slice(i, i + chunkSize));
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const piece of pieces) {
                yield { choices: [{ delta: { content: piece }, finish_reason: null }] };
              }
              yield {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
              };
            },
          };
        },
      },
    },
  };
}

/** Parses an SSE response body (`event: x\ndata: {...}\n\n` blocks) into `{ event, data }` entries. */
function parseSseEvents(payload: string): Array<{ event: string; data: unknown }> {
  return payload
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => {
      const lines = block.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event:'));
      const dataLine = lines.find((l) => l.startsWith('data:'));
      const event = eventLine ? eventLine.slice('event:'.length).trim() : '';
      const dataRaw = dataLine ? dataLine.slice('data:'.length).trim() : '';
      return { event, data: dataRaw ? JSON.parse(dataRaw) : undefined };
    });
}

test('GET animation/custom-script returns 405 diagnostic response because generation is POST-only', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: AUTH_HEADERS,
    });
    assert.equal(resp.statusCode, 405);
    assert.equal(resp.headers.allow, 'POST');
    assert.equal((resp.json() as { error: { code: string } }).error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await app.close();
  }
});

test('POST animation/custom-script streams AI-generated code via SSE and ends with a done event', async () => {
  seedAnimationPdf(PDF_ID, 1);
  fs.writeFileSync(path.join(config.storageRoot, PDF_ID, 'pages', 'animuid1.text.txt'), '頁面標題：銷售趨勢', 'utf8');
  const generatedCode =
    'window.renderAnimation = function (root, api) { api.onFrame(function (frame) { root.style.opacity = String(Math.min(1, frame.t)); }); };';
  let capturedMessages: Array<{ role: string; content: unknown }> | undefined;
  setOpenAIClientForTest(streamingChatClient(generatedCode, (messages) => { capturedMessages = messages; }) as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個會旋轉的圓形' },
    });
    assert.equal(resp.statusCode, 200);
    assert.match(String(resp.headers['content-type']), /^text\/event-stream/);

    const events = parseSseEvents(resp.payload);
    const deltaText = events
      .filter((e) => e.event === 'delta')
      .map((e) => (e.data as { text: string }).text)
      .join('');
    assert.equal(deltaText, generatedCode);
    assert.ok(events.length > 1, 'expected multiple delta events plus a done event');

    const doneEvent = events.find((e) => e.event === 'done');
    assert.deepEqual(doneEvent?.data, { code: generatedCode });
    assert.equal(events[events.length - 1]?.event, 'done');

    const userMessage = capturedMessages?.find((m) => m.role === 'user');
    assert.match(String(userMessage?.content), /銷售趨勢/);
    assert.match(String(userMessage?.content), /畫一個會旋轉的圓形/);

    // round-trips through validateAnimationSpec when stored as a custom-script effect
    const validated = validateAnimationSpec(
      validSpec([fadeIn({ type: 'custom-script', code: (doneEvent?.data as { code: string }).code })]),
    );
    assert.equal(validated.ok, true);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script streams an implementation plan (plan-delta/plan-done) before the code, and the plan is fed into the code prompt', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const planText = '1. 建立一個藍色圓形\n2. 隨動畫進度放大圓形';
  const generatedCode = [
    'window.renderAnimation = function (root, api) {',
    '  // 步驟 1：建立一個藍色圓形',
    '  // 步驟 2：隨動畫進度放大圓形',
    '  api.onFrame(function () {});',
    '};',
  ].join('\n');
  const calls: Array<Array<{ role: string; content: unknown }>> = [];
  setOpenAIClientForTest(twoPhaseStreamingChatClient(planText, generatedCode, (messages) => calls.push(messages)) as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個會放大的藍色圓形' },
    });
    assert.equal(resp.statusCode, 200);
    const events = parseSseEvents(resp.payload);

    // plan-delta(s) → plan-done → delta(s) → done, in that order
    const planDeltaIdx = events.findIndex((e) => e.event === 'plan-delta');
    const planDoneIdx = events.findIndex((e) => e.event === 'plan-done');
    const deltaIdx = events.findIndex((e) => e.event === 'delta');
    assert.ok(planDeltaIdx === 0, 'expected the first event to be plan-delta');
    assert.ok(planDeltaIdx < planDoneIdx && planDoneIdx < deltaIdx);
    assert.equal(events[events.length - 1]?.event, 'done');

    const planDeltaText = events
      .filter((e) => e.event === 'plan-delta')
      .map((e) => (e.data as { text: string }).text)
      .join('');
    assert.equal(planDeltaText, planText);
    assert.deepEqual(events[planDoneIdx]?.data, { plan: planText });

    const doneEvent = events.find((e) => e.event === 'done');
    assert.deepEqual(doneEvent?.data, { code: generatedCode });

    // step 2 (code) receives step 1's plan as part of its user prompt
    assert.equal(calls.length, 2);
    const codeUserMessage = calls[1]?.find((m) => m.role === 'user');
    assert.match(String(codeUserMessage?.content), /【實作步驟】/);
    assert.match(String(codeUserMessage?.content), /建立一個藍色圓形/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script sends an INTERNAL_ERROR event and stops if the plan step fails', async () => {
  seedAnimationPdf(PDF_ID, 1);
  setOpenAIClientForTest({
    chat: { completions: { create: async () => { throw new Error('boom'); } } },
  } as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個圓形' },
    });
    assert.equal(resp.statusCode, 200);
    const events = parseSseEvents(resp.payload);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, 'error');
    assert.equal((events[0]?.data as { code: string }).code, 'INTERNAL_ERROR');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

/** Builds a Gemini `streamGenerateContent?alt=sse` response body: `data: {...}\n\n` blocks, each carrying one `candidates[0].content.parts[0].text` chunk. */
function geminiSseStream(textPieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      textPieces.forEach((piece, i) => {
        const chunk: Record<string, unknown> = {
          candidates: [{ content: { role: 'model', parts: [{ text: piece }] } }],
        };
        if (i === textPieces.length - 1) {
          (chunk.candidates as Array<Record<string, unknown>>)[0]!.finishReason = 'STOP';
          chunk.usageMetadata = { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 };
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      });
      controller.close();
    },
  });
}

test('POST animation/custom-script streams Gemini-generated code incrementally when LLM_PROVIDER=gemini', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const generatedCode =
    'window.renderAnimation = function (root, api) { api.onFrame(function (frame) { root.style.opacity = String(Math.min(1, frame.t)); }); };';
  const chunkSize = Math.max(1, Math.ceil(generatedCode.length / 3));
  const pieces: string[] = [];
  for (let i = 0; i < generatedCode.length; i += chunkSize) pieces.push(generatedCode.slice(i, i + chunkSize));

  const original = getRuntimeAiSettings('account-1');
  setRuntimeAiSettings('account-1', { llmProvider: 'gemini', geminiApiKey: 'test-gemini-key' });

  const fetchCalls: string[] = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      fetchCalls.push(url);
      return new Response(geminiSseStream(pieces), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return prevFetch(input as never, init);
  }) as unknown as typeof fetch;

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個會旋轉的圓形' },
    });
    assert.equal(resp.statusCode, 200);
    assert.match(String(resp.headers['content-type']), /^text\/event-stream/);

    const events = parseSseEvents(resp.payload);
    const deltaEvents = events.filter((e) => e.event === 'delta');
    assert.ok(deltaEvents.length > 1, 'expected multiple incremental delta events from the Gemini stream');
    const deltaText = deltaEvents.map((e) => (e.data as { text: string }).text).join('');
    assert.equal(deltaText, generatedCode);

    const doneEvent = events.find((e) => e.event === 'done');
    assert.deepEqual(doneEvent?.data, { code: generatedCode });

    // one streamGenerateContent call for the plan step, one for the code step
    assert.equal(fetchCalls.length, 2);
    for (const url of fetchCalls) assert.match(url, /streamGenerateContent\?alt=sse/);
  } finally {
    globalThis.fetch = prevFetch;
    setRuntimeAiSettings('account-1', {
      llmProvider: original.llmProvider,
      geminiApiKey: original.geminiApiKey,
      geminiLlmModel: original.geminiLlmModel,
    });
    await app.close();
  }
});

test('POST animation/custom-script includes previousCode in the prompt when iterating', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const previousCode = 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };';
  let capturedMessages: Array<{ role: string; content: unknown }> | undefined;
  setOpenAIClientForTest(streamingChatClient(previousCode, (messages) => { capturedMessages = messages; }) as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '改成藍色', previousCode },
    });
    assert.equal(resp.statusCode, 200);
    const userMessage = capturedMessages?.find((m) => m.role === 'user');
    assert.match(String(userMessage?.content), /改成藍色/);
    assert.match(String(userMessage?.content), /renderAnimation/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script forwards conversation history as prior chat turns before the final prompt', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const generatedCode = 'window.renderAnimation = function (root, api) { api.onFrame(function () {}); };';
  let capturedMessages: Array<{ role: string; content: unknown }> | undefined;
  setOpenAIClientForTest(streamingChatClient(generatedCode, (messages) => { capturedMessages = messages; }) as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: {
        prompt: '改成藍色',
        history: [
          { role: 'user', content: '畫一個圓形' },
          { role: 'assistant', content: '已產生動畫程式碼' },
        ],
      },
    });
    assert.equal(resp.statusCode, 200);
    assert.ok(capturedMessages);
    const messages = capturedMessages!;
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[1]?.role, 'user');
    assert.equal(messages[1]?.content, '畫一個圓形');
    assert.equal(messages[2]?.role, 'assistant');
    assert.equal(messages[2]?.content, '已產生動畫程式碼');
    const finalMessage = messages[messages.length - 1];
    assert.equal(finalMessage?.role, 'user');
    assert.match(String(finalMessage?.content), /改成藍色/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script returns 400 when history contains an invalid role or over-length content', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  try {
    const invalidRole = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個圓形', history: [{ role: 'system', content: 'x' }] },
    });
    assert.equal(invalidRole.statusCode, 400);

    const tooLong = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: {
        prompt: '畫一個圓形',
        history: [{ role: 'user', content: 'x'.repeat(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGE_LENGTH + 1) }],
      },
    });
    assert.equal(tooLong.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('POST animation/custom-script sends an UNSAFE_SCRIPT error event when the generated code is disallowed', async () => {
  seedAnimationPdf(PDF_ID, 1);
  setOpenAIClientForTest(streamingChatClient('fetch("https://evil.example").then(function () {});') as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '從遠端載入資料並顯示' },
    });
    assert.equal(resp.statusCode, 200);
    const events = parseSseEvents(resp.payload);
    const errorEvent = events.find((e) => e.event === 'error');
    assert.equal((errorEvent?.data as { code: string } | undefined)?.code, 'UNSAFE_SCRIPT');
    assert.ok(!events.some((e) => e.event === 'done'));
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script sends an INVALID_SCRIPT_CONTRACT error event when generated code misses render contract', async () => {
  seedAnimationPdf(PDF_ID, 1);
  setOpenAIClientForTest(streamingChatClient('var canvas = document.createElement("canvas");') as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個圓形' },
    });
    assert.equal(resp.statusCode, 200);
    const events = parseSseEvents(resp.payload);
    const errorEvent = events.find((e) => e.event === 'error');
    assert.equal((errorEvent?.data as { code: string } | undefined)?.code, 'INVALID_SCRIPT_CONTRACT');
    assert.ok(!events.some((e) => e.event === 'done'));
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script sends an INTERNAL_ERROR error event when the model returns blank code', async () => {
  seedAnimationPdf(PDF_ID, 1);
  setOpenAIClientForTest(streamingChatClient('   ') as never);

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '畫一個圓形' },
    });
    assert.equal(resp.statusCode, 200);
    const events = parseSseEvents(resp.payload);
    const errorEvent = events.find((e) => e.event === 'error');
    assert.equal((errorEvent?.data as { code: string } | undefined)?.code, 'INTERNAL_ERROR');
    assert.ok(!events.some((e) => e.event === 'done'));
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('POST animation/custom-script returns 400 for an empty or too-long prompt', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  try {
    const empty = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: '' },
    });
    assert.equal(empty.statusCode, 400);

    const tooLong = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${PDF_ID}/pages/1/animation/custom-script`,
      headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
      payload: { prompt: 'x'.repeat(301) },
    });
    assert.equal(tooLong.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('POST animation/custom-script returns 404 for an unknown page', async () => {
  seedAnimationPdf(PDF_ID, 1);
  const app = await buildApp();
  const resp = await app.inject({
    method: 'POST',
    url: `/api/pdfs/${PDF_ID}/pages/99/animation/custom-script`,
    headers: { ...AUTH_HEADERS, 'content-type': 'application/json' },
    payload: { prompt: '畫一個圓形' },
  });
  assert.equal(resp.statusCode, 404);
  await app.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { pageAnimationSpecPath } from '../src/services/storage';
import type { AnimationSpec } from '../src/services/pageAnimation';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedRegenAnimationPdf(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'regenerate-animations', 'regenerate-animations.pdf', pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `reganim${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), `第 ${i} 頁的頁面文字內容`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `這是第 ${i} 頁的逐字稿句子。`, 'utf8');
  }
}

async function waitForRegenerateCompletion(
  app: Awaited<ReturnType<typeof buildApp>>,
  id: string,
): Promise<{ status: string; [key: string]: unknown }> {
  let finalState: { status: string; [key: string]: unknown } = { status: 'pending' };
  for (let i = 0; i < 80; i++) {
    const status = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/regenerate/status` });
    assert.equal(status.statusCode, 200);
    finalState = status.json();
    if (['completed', 'failed', 'cancelled'].includes(finalState.status)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return finalState;
}

test('regenerate animations: calls AI per page, maps effects, and preserves existing hints', async () => {
  const id = 'regen-animations-ai-01';
  seedRegenAnimationPdf(id, 2);

  // Page 1 已有焦點動畫 hints 與舊的（規則式）效果，重生時應沿用 hints 作為提示，並整份覆寫效果。
  fs.writeFileSync(
    pageAnimationSpecPath(id, 'reganim1'),
    JSON.stringify({
      version: 1,
      enabled: true,
      effects: [
        {
          id: 'old-effect',
          target: 'slide',
          type: 'highlight-box',
          start: 0,
          duration: 1.2,
          ease: 'power1.out',
          startTrigger: { type: 'transcript-line', line: 0 },
          params: { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 },
        },
      ],
      hints: { '0': '強調營收數字' },
    }),
    'utf8',
  );

  let calls = 0;
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    effects: [
                      { line: 0, show: true, type: 'highlight-box', xPct: 12, yPct: 22, widthPct: 33, heightPct: 44, exitDuration: 2.5 },
                    ],
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
    const started = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/regenerate`,
      payload: { animations: {} },
    });
    assert.equal(started.statusCode, 202);

    const finalState = await waitForRegenerateCompletion(app, id);
    assert.equal(finalState.status, 'completed');
    assert.equal(calls, 2);

    const spec1 = JSON.parse(fs.readFileSync(pageAnimationSpecPath(id, 'reganim1'), 'utf8')) as AnimationSpec;
    assert.equal(spec1.enabled, true);
    assert.equal(spec1.effects.length, 1);
    assert.notEqual(spec1.effects[0].id, 'old-effect');
    assert.equal(spec1.effects[0].type, 'highlight-box');
    assert.deepEqual(spec1.effects[0].startTrigger, { type: 'transcript-line', line: 0 });
    assert.deepEqual(spec1.effects[0].params, { xPct: 12, yPct: 22, widthPct: 33, heightPct: 44 });
    assert.equal(spec1.effects[0].exitDuration, 2.5);
    assert.deepEqual(spec1.hints, { '0': '強調營收數字' });

    const spec2 = JSON.parse(fs.readFileSync(pageAnimationSpecPath(id, 'reganim2'), 'utf8')) as AnimationSpec;
    assert.equal(spec2.enabled, true);
    assert.equal(spec2.effects.length, 1);
    assert.equal(spec2.hints, undefined);

    const rows = db
      .prepare(`SELECT page_number, render_type, animation_spec_path FROM pages WHERE pdf_id = ? ORDER BY page_number`)
      .all(id) as Array<{ page_number: number; render_type: string; animation_spec_path: string | null }>;
    for (const row of rows) {
      assert.equal(row.render_type, 'gsap-image');
      assert.equal(row.animation_spec_path, `pages/reganim${row.page_number}.animation.json`);
    }
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

test('regenerate animations: writes a disabled empty spec when AI hides every sentence', async () => {
  const id = 'regen-animations-ai-02';
  seedRegenAnimationPdf(id, 1);

  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: { content: JSON.stringify({ effects: [{ line: 0, show: false }] }) },
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
    const started = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${id}/regenerate`,
      payload: { animations: {} },
    });
    assert.equal(started.statusCode, 202);

    const finalState = await waitForRegenerateCompletion(app, id);
    assert.equal(finalState.status, 'completed');

    const spec = JSON.parse(fs.readFileSync(pageAnimationSpecPath(id, 'reganim1'), 'utf8')) as AnimationSpec;
    assert.equal(spec.enabled, false);
    assert.deepEqual(spec.effects, []);

    const row = db.prepare(`SELECT render_type FROM pages WHERE pdf_id = ? AND page_number = 1`).get(id) as {
      render_type: string;
    };
    assert.equal(row.render_type, 'static-image');
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings, setRuntimeAiSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { pageAnimationSpecPath } from '../src/services/storage';
import { maybeAutoGenerateAnimations } from '../src/worker/pipeline';

setSystemAuthSettings({ googleAuthEnabled: false });

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'audio_ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 'auto-anim-test', 'auto-anim-test.pdf', pageCount, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  for (let i = 1; i <= pageCount; i++) {
    const uid = `autoanim${pdfId.replace(/-/g, '')}p${i}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, i, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), `第 ${i} 頁的頁面文字`, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), `這是第 ${i} 頁的逐字稿句子。`, 'utf8');
  }
}

function mockOpenAI(): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  effects: [
                    { line: 0, show: true, type: 'highlight-box', xPct: 10, yPct: 20, widthPct: 30, heightPct: 40, exitDuration: 1.5 },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      },
    },
  } as never);
}

test('maybeAutoGenerateAnimations: generates animation.json for each page when setting is enabled', async () => {
  const id = 'auto-anim-enabled-01';
  seedPdf(id, 2);
  mockOpenAI();
  setRuntimeAiSettings('default', { autoGenerateAnimation: true });

  try {
    await maybeAutoGenerateAnimations(null, id, [1, 2]);

    for (let i = 1; i <= 2; i++) {
      const uid = `autoanim${id.replace(/-/g, '')}p${i}`;
      const animPath = pageAnimationSpecPath(id, uid);
      assert.ok(fs.existsSync(animPath), `animation.json 應已寫入 page ${i}`);
      const spec = JSON.parse(fs.readFileSync(animPath, 'utf8'));
      assert.equal(spec.version, 1);
      assert.equal(spec.enabled, true);
      assert.equal(spec.effects.length, 1);
      assert.equal(spec.effects[0].type, 'highlight-box');
    }

    // pages table should have render_type and animation_spec_path updated
    const rows = db
      .prepare(`SELECT page_number, render_type, animation_spec_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
      .all(id) as Array<{ page_number: number; render_type: string | null; animation_spec_path: string | null }>;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(row.animation_spec_path !== null, `animation_spec_path should be set for page ${row.page_number}`);
      assert.ok(row.render_type !== null, `render_type should be set for page ${row.page_number}`);
    }
  } finally {
    setRuntimeAiSettings('default', { autoGenerateAnimation: false });
  }
});

test('maybeAutoGenerateAnimations: skips generation when setting is disabled', async () => {
  const id = 'auto-anim-disabled-01';
  seedPdf(id, 2);
  setRuntimeAiSettings('default', { autoGenerateAnimation: false });

  await maybeAutoGenerateAnimations(null, id, [1, 2]);

  for (let i = 1; i <= 2; i++) {
    const uid = `autoanim${id.replace(/-/g, '')}p${i}`;
    const animPath = pageAnimationSpecPath(id, uid);
    assert.ok(!fs.existsSync(animPath), `animation.json は設定 off 時に生成されないはず page ${i}`);
  }
  // pages table should NOT have animation_spec_path set
  const rows = db
    .prepare(`SELECT page_number, animation_spec_path FROM pages WHERE pdf_id = ? ORDER BY page_number ASC`)
    .all(id) as Array<{ page_number: number; animation_spec_path: string | null }>;
  for (const row of rows) {
    assert.equal(row.animation_spec_path, null, `animation_spec_path should remain null for page ${row.page_number}`);
  }
});

test('GET /api/system/ai-settings returns auto_generate_animation: false by default', async () => {
  setRuntimeAiSettings('default', { autoGenerateAnimation: false });
  const app = await buildApp();
  try {
    const resp = await app.inject({ method: 'GET', url: '/api/system/ai-settings' });
    assert.equal(resp.statusCode, 200);
    const body = resp.json() as Record<string, unknown>;
    assert.equal(body.auto_generate_animation, false);
  } finally {
    await app.close();
  }
});

test('PATCH /api/system/ai-settings can set auto_generate_animation to true', async () => {
  setRuntimeAiSettings('default', { autoGenerateAnimation: false });
  const app = await buildApp();
  try {
    const patchResp = await app.inject({
      method: 'PATCH',
      url: '/api/system/ai-settings',
      payload: { auto_generate_animation: true },
    });
    assert.equal(patchResp.statusCode, 200);
    const patchBody = patchResp.json() as Record<string, unknown>;
    assert.equal(patchBody.auto_generate_animation, true);

    const getResp = await app.inject({ method: 'GET', url: '/api/system/ai-settings' });
    assert.equal(getResp.statusCode, 200);
    const getBody = getResp.json() as Record<string, unknown>;
    assert.equal(getBody.auto_generate_animation, true);
  } finally {
    setRuntimeAiSettings('default', { autoGenerateAnimation: false });
    await app.close();
  }
});

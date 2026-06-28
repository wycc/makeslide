import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { createPdfDir } from '../src/services/storage';
import { setSystemAuthSettings } from '../src/services/aiSettings';

// 與 export-import-zip-sources.test.ts 相同：本檔請求不帶 session cookie，先停用
// Google 登入閘門讓行為與磁碟/執行順序無關。
setSystemAuthSettings({ googleAuthEnabled: false });

function multipartZipUpload(boundary: string, filename: string, zipBuffer: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, zipBuffer, tail]);
}

/**
 * 種一份「有一頁、且該頁掛了 GSAP 動畫」的簡報，並掛上一題投票與一組測驗。
 * 動畫規格寫成 pages/<uid>.animation.json 真實檔案，pages.animation_spec_path 指向它，
 * 模擬正式資料的儲存方式。
 */
function seedPdfWithInteractiveData(id: string): { pageUid: string; animationRelPath: string } {
  const now = new Date().toISOString();
  const dir = createPdfDir(id);
  const pageUid = 'uidpage001';
  const animationRelPath = `pages/${pageUid}.animation.json`;

  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  // 一份「會啟用」的 spec（enabled:true + 一個 spotlight effect），用來和匯入失敗時
  // 端點回傳的 defaultAnimationSpec()（enabled:false、effects 空）區分開來。
  fs.writeFileSync(
    path.join(dir, animationRelPath),
    JSON.stringify({
      version: 1,
      enabled: true,
      effects: [
        {
          id: 'spot-1',
          target: 'slide',
          type: 'spotlight',
          start: 0,
          duration: 1.2,
          ease: 'power1.out',
          params: { xPct: 10, yPct: 10, widthPct: 30, heightPct: 30 },
        },
      ],
    }),
  );

  // 圖表素材：figures.json 清單 + 圖檔 + split-figure-map + 每頁排除設定。前三者依
  // page_number / 相對路徑解析（隨儲存目錄複製即可），figure-selection 以 page_uid 命名
  // （靠 import 保留 page_uid 才對得回去）。
  fs.writeFileSync(
    path.join(dir, 'figures.json'),
    JSON.stringify({
      pdfId: id,
      generatedAt: now,
      pages: [{ pageNumber: 1, figures: [{ id: 'p1-fig1', imagePath: 'figures/p1-fig1.png', width: 100, height: 80 }] }],
    }),
  );
  fs.mkdirSync(path.join(dir, 'figures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'figures', 'p1-fig1.png'), 'fake-png-bytes');
  fs.writeFileSync(path.join(dir, 'split-figure-map.json'), JSON.stringify({ '1': [1] }));
  fs.writeFileSync(
    path.join(dir, 'pages', `${pageUid}.figure-selection.json`),
    JSON.stringify({ excluded: ['p1-fig1'] }),
  );

  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify(
      {
        id,
        title: 'Export-Import Interactive Test',
        original_filename: 'interactive-test.pdf',
        status: 'ready',
        progress_step: 'audio_ready',
        progress_current: 1,
        progress_total: 1,
        page_count: 1,
        error_message: null,
        pages: [{ page_number: 1, image: `pages/${pageUid}.png`, text: null, status: 'audio_ready' }],
        created_at: now,
        updated_at: now,
      },
      null,
      2,
    ),
  );

  db.prepare(
    `INSERT INTO pdfs (id, title, original_filename, status, page_count, category, owner_sub, visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 'Export-Import Interactive Test', 'interactive-test.pdf', 'ready', 1, 'general', null, 'public', now, now);

  db.prepare(
    `INSERT INTO pages (pdf_id, page_number, page_uid, image_path, status, render_type, animation_spec_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 1, pageUid, `pages/${pageUid}.png`, 'audio_ready', 'gsap-image', animationRelPath, now, now);

  db.prepare(
    `INSERT INTO page_polls (pdf_id, page_number, question, options_json, is_active, show_results, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, 1, '你覺得這頁如何？', JSON.stringify(['很好', '普通', '需加強']), 1, 0, now, now);

  db.prepare(
    `INSERT INTO quiz_sets (pdf_id, title, prompt, questions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    '第一章小測',
    '依本頁內容出題',
    JSON.stringify([{ q: '1+1=?', options: ['1', '2', '3'], answer: 1 }]),
    now,
    now,
  );

  return { pageUid, animationRelPath };
}

function cleanupPdf(pdfId: string): void {
  db.prepare('DELETE FROM page_polls WHERE pdf_id = ?').run(pdfId);
  db.prepare('DELETE FROM quiz_sets WHERE pdf_id = ?').run(pdfId);
  db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(pdfId);
  db.prepare('DELETE FROM pdfs WHERE id = ?').run(pdfId);
}

test('export.zip -> import.zip round-trips polls, quizzes and slide animations', async () => {
  const app = await buildApp();
  const id = `inter${Date.now().toString(36)}`;
  let importedId: string | null = null;
  try {
    const { animationRelPath } = seedPdfWithInteractiveData(id);

    const exportResp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.zip` });
    assert.equal(exportResp.statusCode, 200);

    const boundary = '----interboundary';
    const importResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/import.zip',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartZipUpload(boundary, 'export.zip', exportResp.rawPayload),
    });
    assert.equal(importResp.statusCode, 201);
    importedId = (importResp.json() as { id: string }).id;

    // 投票題目還原（不含票數）。
    const polls = db
      .prepare(`SELECT page_number, question, options_json, is_active, show_results FROM page_polls WHERE pdf_id = ?`)
      .all(importedId) as Array<{ page_number: number; question: string; options_json: string; is_active: number; show_results: number }>;
    assert.equal(polls.length, 1, 'expected the poll question to survive the round-trip');
    assert.equal(polls[0].page_number, 1);
    assert.equal(polls[0].question, '你覺得這頁如何？');
    assert.deepEqual(JSON.parse(polls[0].options_json), ['很好', '普通', '需加強']);
    assert.equal(polls[0].show_results, 0, 'show_results flag should be preserved');

    // 測驗題庫還原。
    const quizzes = db
      .prepare(`SELECT title, prompt, questions_json FROM quiz_sets WHERE pdf_id = ?`)
      .all(importedId) as Array<{ title: string; prompt: string; questions_json: string }>;
    assert.equal(quizzes.length, 1, 'expected the quiz set to survive the round-trip');
    assert.equal(quizzes[0].title, '第一章小測');
    assert.equal(JSON.parse(quizzes[0].questions_json)[0].q, '1+1=?');

    // 動畫對應還原：render_type / animation_spec_path 都要回到 pages，且規格檔實際存在。
    const page = db
      .prepare(`SELECT render_type, animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(importedId) as { render_type: string | null; animation_spec_path: string | null } | undefined;
    assert.ok(page, 'imported page row should exist');
    assert.equal(page?.render_type, 'gsap-image', 'animated render_type should be restored');
    assert.equal(page?.animation_spec_path, animationRelPath);
    const importedDir = createPdfDir(importedId);
    assert.equal(
      fs.existsSync(path.join(importedDir, animationRelPath)),
      true,
      'animation spec file should have been copied with the storage dir',
    );

    // 真正的回歸防線：import 會重新產生 page_uid，但動畫規格檔仍以匯出端的舊 uid
    // 命名。spec 端點必須依 animation_spec_path（而非新的 page_uid）定位檔案，否則會
    // 找不到並回退成停用的 defaultAnimationSpec()，動畫就「消失」了。
    const specResp = await app.inject({
      method: 'GET',
      url: `/api/pdfs/${importedId}/pages/1/animation/spec`,
    });
    assert.equal(specResp.statusCode, 200);
    const servedSpec = specResp.json() as { enabled: boolean; effects: unknown[] };
    assert.equal(servedSpec.enabled, true, 'served spec must be the real enabled spec, not the disabled default');
    assert.equal(servedSpec.effects.length, 1, 'the seeded spotlight effect must survive the round-trip');

    // page_uid 保留：import 應沿用匯出端的 page_uid，而非重新產生。
    const importedUid = (db
      .prepare(`SELECT page_uid FROM pages WHERE pdf_id = ? AND page_number = 1`)
      .get(importedId) as { page_uid: string }).page_uid;
    assert.equal(importedUid, pageUid, 'imported page should keep the original page_uid');

    // 圖表素材：清單、圖檔、split-map 隨儲存目錄複製；figure-selection 以 page_uid 命名，
    // 靠保留的 page_uid 才對得回去。
    assert.equal(fs.existsSync(path.join(importedDir, 'figures.json')), true, 'figures manifest should survive');
    assert.equal(fs.existsSync(path.join(importedDir, 'figures', 'p1-fig1.png')), true, 'figure image should survive');
    assert.equal(fs.existsSync(path.join(importedDir, 'split-figure-map.json')), true, 'split-figure-map should survive');
    assert.equal(
      fs.existsSync(path.join(importedDir, 'pages', `${importedUid}.figure-selection.json`)),
      true,
      'per-page figure selection should resolve under the preserved page_uid',
    );

    // sidecar 中繼檔不應原樣留在新簡報目錄。
    assert.equal(fs.existsSync(path.join(importedDir, 'page-uids.json')), false);
    assert.equal(fs.existsSync(path.join(importedDir, 'polls.json')), false);
    assert.equal(fs.existsSync(path.join(importedDir, 'quizzes.json')), false);
    assert.equal(fs.existsSync(path.join(importedDir, 'animations.json')), false);
  } finally {
    if (importedId) {
      cleanupPdf(importedId);
      await fs.promises.rm(createPdfDir(importedId), { recursive: true, force: true }).catch(() => {});
    }
    cleanupPdf(id);
    await fs.promises.rm(createPdfDir(id), { recursive: true, force: true }).catch(() => {});
    await app.close();
  }
});

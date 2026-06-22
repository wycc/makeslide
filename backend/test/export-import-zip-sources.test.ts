import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { createPdfDir } from '../src/services/storage';
import { setSystemAuthSettings } from '../src/services/aiSettings';

// This file's requests carry no session cookie, relying on server.ts's global
// "Google login required" gate staying inactive. That gate reads real, persisted
// Google OAuth credentials from accounts/default/settings.env via a lazily-cached
// module-level setting, so leaving it unset would make these tests' pass/fail
// outcome depend on which other test file happened to populate or clear that cache
// first in this worker process. Disabling it here up front (the same defensive
// pattern delete-permission.test.ts and friends already use) makes this file's
// behavior deterministic regardless of ambient/disk state or test run order.
setSystemAuthSettings({ googleAuthEnabled: false });

function multipartZipUpload(boundary: string, filename: string, zipBuffer: Buffer): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, zipBuffer, tail]);
}

async function seedPdfWithSources(
  id: string,
  sources: Array<{ source_kind: string; source_name: string | null; content_text: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  const dir = createPdfDir(id);
  fs.writeFileSync(
    path.join(dir, 'metadata.json'),
    JSON.stringify(
      {
        id,
        title: 'Export-Import Sources Test',
        original_filename: 'sources-test.pdf',
        status: 'ready',
        progress_step: 'script_ready',
        progress_current: 1,
        progress_total: 1,
        page_count: 1,
        error_message: null,
        pages: [],
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
  ).run(id, 'Export-Import Sources Test', 'sources-test.pdf', 'ready', 1, 'general', null, 'public', now, now);

  const insertSource = db.prepare(
    `INSERT INTO pdf_sources (pdf_id, source_kind, source_name, content_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const s of sources) {
    insertSource.run(id, s.source_kind, s.source_name, s.content_text, now, now);
  }
}

test('GET /export.zip followed by POST /import.zip round-trips pdf_sources content (no regression)', async () => {
  const app = await buildApp();
  const id = `srctest${Date.now().toString(36)}`;
  try {
    await seedPdfWithSources(id, [
      {
        source_kind: 'youtube_caption',
        source_name: 'YouTube 字幕來源',
        content_text: '這是這份簡報的原始 YouTube 字幕內容，非常重要的來源資料。',
      },
      {
        source_kind: 'txt',
        source_name: null,
        content_text: '使用者額外貼上的補充文字稿。',
      },
    ]);

    const exportResp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.zip` });
    assert.equal(exportResp.statusCode, 200);
    const zipBuffer = exportResp.rawPayload;

    const boundary = '----srctestboundary';
    const importResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/import.zip',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartZipUpload(boundary, 'export.zip', zipBuffer),
    });
    assert.equal(importResp.statusCode, 201);
    const importedId = (importResp.json() as { id: string }).id;

    const restoredSources = db
      .prepare(
        `SELECT source_kind, source_name, content_text FROM pdf_sources WHERE pdf_id = ? ORDER BY id ASC`,
      )
      .all(importedId) as Array<{ source_kind: string; source_name: string | null; content_text: string }>;

    assert.equal(restoredSources.length, 2, 'expected both pdf_sources rows to survive the export -> import round-trip');
    assert.equal(restoredSources[0].source_kind, 'youtube_caption');
    assert.equal(restoredSources[0].source_name, 'YouTube 字幕來源');
    assert.equal(restoredSources[0].content_text, '這是這份簡報的原始 YouTube 字幕內容，非常重要的來源資料。');
    assert.equal(restoredSources[1].source_kind, 'txt');
    assert.equal(restoredSources[1].content_text, '使用者額外貼上的補充文字稿。');

    // sources.json 只是匯出用的中繼檔，內容已經寫回 pdf_sources 表，不應該原樣留在
    // 新 PDF 的儲存目錄裡。
    const importedDir = createPdfDir(importedId);
    assert.equal(fs.existsSync(path.join(importedDir, 'sources.json')), false);

    // GET /api/pdfs/:id 回傳的 sources 陣列（前端「來源」分頁實際讀取的欄位）也要能看到還原後的資料。
    const detailResp = await app.inject({ method: 'GET', url: `/api/pdfs/${importedId}` });
    assert.equal(detailResp.statusCode, 200);
    const detailBody = detailResp.json() as { sources: Array<{ source_kind: string }> };
    assert.equal(detailBody.sources.length, 2);

    db.prepare('DELETE FROM pdf_sources WHERE pdf_id = ?').run(importedId);
    db.prepare('DELETE FROM pages WHERE pdf_id = ?').run(importedId);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(importedId);
    await fs.promises.rm(importedDir, { recursive: true, force: true });
  } finally {
    db.prepare('DELETE FROM pdf_sources WHERE pdf_id = ?').run(id);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await fs.promises.rm(createPdfDir(id), { recursive: true, force: true }).catch(() => {});
    await app.close();
  }
});

test('GET /export.zip omits sources.json when the PDF has no pdf_sources rows (no spurious empty file)', async () => {
  const app = await buildApp();
  const id = `nosrc${Date.now().toString(36)}`;
  try {
    await seedPdfWithSources(id, []);

    const exportResp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.zip` });
    assert.equal(exportResp.statusCode, 200);

    const boundary = '----nosrcboundary';
    const importResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/import.zip',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartZipUpload(boundary, 'export.zip', exportResp.rawPayload),
    });
    assert.equal(importResp.statusCode, 201);
    const importedId = (importResp.json() as { id: string }).id;

    const restoredSources = db.prepare(`SELECT COUNT(*) AS c FROM pdf_sources WHERE pdf_id = ?`).get(importedId) as {
      c: number;
    };
    assert.equal(restoredSources.c, 0);

    db.prepare('DELETE FROM pdfs WHERE id = ?').run(importedId);
    await fs.promises.rm(createPdfDir(importedId), { recursive: true, force: true }).catch(() => {});
  } finally {
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await fs.promises.rm(createPdfDir(id), { recursive: true, force: true }).catch(() => {});
    await app.close();
  }
});

test('POST /import.zip ignores malformed entries in sources.json instead of failing the whole import', async () => {
  const app = await buildApp();
  const id = `badsrc${Date.now().toString(36)}`;
  try {
    await seedPdfWithSources(id, [
      { source_kind: 'txt', source_name: 'valid one', content_text: '這筆是合法資料，應該被保留。' },
    ]);

    const exportResp = await app.inject({ method: 'GET', url: `/api/pdfs/${id}/export.zip` });
    assert.equal(exportResp.statusCode, 200);

    // 解壓縮、在 sources.json 裡混入一筆不合法的資料（source_kind 不在允許清單內），
    // 重新打包後再匯入，驗證匯入流程只會跳過不合法的那一筆，仍然成功完成整個匯入
    // 並保留合法的那一筆，而不是讓整個 import.zip 請求直接失敗。
    const os = await import('node:os');
    const { spawnSync } = await import('node:child_process');
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makeslide-sources-tamper-'));
    const zipPath = path.join(workDir, 'in.zip');
    fs.writeFileSync(zipPath, exportResp.rawPayload);
    const extractDir = path.join(workDir, 'extracted');
    fs.mkdirSync(extractDir);
    spawnSync('unzip', ['-q', zipPath, '-d', extractDir]);
    const sourcesPath = path.join(extractDir, 'sources.json');
    assert.equal(fs.existsSync(sourcesPath), true, 'expected sources.json to exist in the export for a PDF with sources');
    fs.writeFileSync(
      sourcesPath,
      JSON.stringify([
        { source_kind: 'txt', source_name: 'valid one', content_text: '這筆是合法資料，應該被保留。' },
        { source_kind: 'not_a_real_kind', source_name: 'bad', content_text: 'should be dropped' },
        { source_kind: 'txt', content_text: '' }, // content_text 違反 min(1)
      ]),
    );
    const repackedZipPath = path.join(workDir, 'repacked.zip');
    spawnSync('zip', ['-r', '-q', repackedZipPath, '.'], { cwd: extractDir });
    const repackedBuffer = fs.readFileSync(repackedZipPath);

    const boundary = '----badsrcboundary';
    const importResp = await app.inject({
      method: 'POST',
      url: '/api/pdfs/import.zip',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartZipUpload(boundary, 'tampered.zip', repackedBuffer),
    });
    assert.equal(importResp.statusCode, 201);
    const importedId = (importResp.json() as { id: string }).id;

    const restoredSources = db
      .prepare(`SELECT source_kind, content_text FROM pdf_sources WHERE pdf_id = ? ORDER BY id ASC`)
      .all(importedId) as Array<{ source_kind: string; content_text: string }>;
    assert.equal(restoredSources.length, 1, 'expected only the single valid source row to survive');
    assert.equal(restoredSources[0].content_text, '這筆是合法資料，應該被保留。');

    db.prepare('DELETE FROM pdf_sources WHERE pdf_id = ?').run(importedId);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(importedId);
    await fs.promises.rm(createPdfDir(importedId), { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  } finally {
    db.prepare('DELETE FROM pdf_sources WHERE pdf_id = ?').run(id);
    db.prepare('DELETE FROM pdfs WHERE id = ?').run(id);
    await fs.promises.rm(createPdfDir(id), { recursive: true, force: true }).catch(() => {});
    await app.close();
  }
});

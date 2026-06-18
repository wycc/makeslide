import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db';
import { generateVideo } from '../src/worker/steps/generateVideo';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdfWithPages(pdfId: string, pageCount: number): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', pageCount, t, t);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const uid = `genvideo${pdfId}${pageNumber}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'audio_ready',NULL,?,?)`,
    ).run(
      pdfId,
      pageNumber,
      uid,
      `pages/${uid}.jpg`,
      `pages/${uid}.text.txt`,
      `pages/${uid}.script.txt`,
      `pages/${uid}.m4a`,
      t,
      t,
    );
  }
}

test('generateVideo throws "No video segments generated" when every page is missing its image/audio artifacts', async () => {
  const pdfId = 'genvideo-missing-files-01';
  seedPdfWithPages(pdfId, 2);

  // Page rows exist in the DB but no image/audio files were ever written to
  // disk (e.g. the TTS step failed without the DB status reflecting it yet).
  // Without the existsSync() guard this would instead reach ffmpeg with
  // nonexistent input paths.
  await assert.rejects(
    () => generateVideo({ pdfId, pageCount: 2, pageNumbers: [1, 2] }),
    /No video segments generated/,
  );
});

test('generateVideo throws immediately when there are no pages to render', async () => {
  await assert.rejects(
    () => generateVideo({ pdfId: 'genvideo-no-pages-01', pageCount: 0, pageNumbers: [] }),
    /No pages available for video rendering/,
  );
});

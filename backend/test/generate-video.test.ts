import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { db } from '../src/db';
import { config } from '../src/config';
import { generateVideo, evenCeil, buildScaleAndPadFilter } from '../src/worker/steps/generateVideo';

const execFile = promisify(execFileCb);
const FFMPEG = ffmpegStatic ?? 'ffmpeg';

test('evenCeil rounds odd dimensions up to the nearest even number', () => {
  assert.equal(evenCeil(801), 802);
  assert.equal(evenCeil(800), 800);
  assert.equal(evenCeil(1), 2);
  assert.equal(evenCeil(0), 2);
});

test('buildScaleAndPadFilter produces a scale-then-pad-to-fixed-size ffmpeg filter', () => {
  assert.equal(
    buildScaleAndPadFilter(800, 600),
    'scale=800:600:force_original_aspect_ratio=decrease,pad=800:600:(ow-iw)/2:(oh-ih)/2',
  );
});

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

test('generateVideo normalizes pages of differing source resolutions to one consistent output size', async () => {
  // Real-world source PDFs can mix page sizes (e.g. one portrait slide among landscape ones);
  // each page is rendered independently at its own pixel size, so without normalization the
  // per-page ffmpeg segments would have mismatched resolutions and the final `-c copy` concat
  // would silently embed a second video stream whose actual frame size doesn't match the
  // container's declared resolution (verified manually: ffmpeg doesn't error, it just produces
  // a stream-inconsistent file). This test uses two real, differently-sized images end-to-end
  // through the real ffmpeg binary and confirms the page-2 segment was actually re-encoded to
  // page-1's resolution, not left at its native size.
  const pdfId = 'genvideo-mixed-resolution-01';
  seedPdfWithPages(pdfId, 2);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  const uid1 = `genvideo${pdfId}1`;
  const uid2 = `genvideo${pdfId}2`;
  const image1 = path.join(pagesDir, `${uid1}.jpg`);
  const image2 = path.join(pagesDir, `${uid2}.jpg`);
  const audio1 = path.join(pagesDir, `${uid1}.m4a`);
  const audio2 = path.join(pagesDir, `${uid2}.m4a`);

  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toFile(image1);
  await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 0, g: 255, b: 0 } } }).jpeg().toFile(image2);
  await execFile(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1', audio1]);
  await execFile(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1', audio2]);

  try {
    const result = await generateVideo({ pdfId, pageCount: 2, pageNumbers: [1, 2] });
    assert.ok(fs.existsSync(result.outputPath));

    // Extract a frame from partway into the second page's segment (~1.5s in, given each
    // segment is ~1s) and confirm it was actually scaled/padded to page 1's 800x600 — not
    // left at its native 640x480 inside a mismatched container.
    const framePath = path.join(pagesDir, 'frame.png');
    await execFile(FFMPEG, ['-y', '-ss', '1.5', '-i', result.outputPath, '-frames:v', '1', framePath]);
    const frameMeta = await sharp(framePath).metadata();
    assert.equal(frameMeta.width, 800);
    assert.equal(frameMeta.height, 600);
  } finally {
    db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
    db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
    fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
  }
});

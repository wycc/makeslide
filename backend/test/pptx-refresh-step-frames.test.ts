/**
 * Re-rendering an imported deck's step pictures in place, keeping its narration.
 *
 * Reported on a deck imported the night before paragraph-level builds were understood: a list
 * built one line per click still showed six identical pictures, because a deck keeps the frames
 * it was imported with. Re-importing would fix them by deleting every page and emptying every
 * script; this replaces only the pictures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../src/db';
import { config } from '../src/config';
import { importPptxIntoDeck, refreshPptxStepFrames } from '../src/services/pptx/importPptx';
import { readPageSteps, writePageSteps } from '../src/services/pageSteps';
import type { FrameRequest } from '../src/services/pptx/renderFrames';

const here = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = path.resolve(here, '../../docs/computational Graph.pptx');
const skip = fs.existsSync(FIXTURE) ? false : `fixture missing: ${FIXTURE}`;
const PDF = 'pptx-refresh-frames-01';

/** A distinguishable picture per frame; `tint` tells one render from the next. */
function renderer(tint: number) {
  return async (_p: string, requests: FrameRequest[], o: { width: number; height: number }) => {
    for (const r of requests) {
      const v = Math.min(255, tint + r.stepIndex * 20);
      await sharp({ create: { width: o.width, height: o.height, channels: 3, background: { r: v, g: tint, b: 255 - v } } }).jpeg().toFile(r.outPath);
    }
  };
}

function setup(): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(PDF);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(PDF);
  db.prepare(`INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at) VALUES (?,?,?,'processing',0,NULL,'private',?,?)`)
    .run(PDF, 'refresh', 'deck.pptx', t, t);
  fs.mkdirSync(path.join(config.storageRoot, PDF, 'pages'), { recursive: true });
}

function cleanup(): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(PDF);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(PDF);
  fs.rmSync(path.join(config.storageRoot, PDF), { recursive: true, force: true });
}

const pageRow = (n: number) => db.prepare(`SELECT page_uid, render_type FROM pages WHERE pdf_id = ? AND page_number = ?`).get(PDF, n) as { page_uid: string; render_type: string };

test('new pictures, same narration — and nothing guessed at', { skip, timeout: 300_000 }, async () => {
  setup();
  try {
    await importPptxIntoDeck({ pdfId: PDF, pptxPath: FIXTURE, renderFrames: renderer(40) as never });
    const rows = db.prepare(`SELECT page_number, render_type FROM pages WHERE pdf_id = ? ORDER BY page_number`).all(PDF) as Array<{ page_number: number; render_type: string }>;
    const animated = rows.filter((r) => r.render_type === 'react').map((r) => r.page_number);
    const still = rows.find((r) => r.render_type !== 'react')!.page_number;
    const [target, mismatched] = animated as [number, number];

    // The page has been narrated since it was imported.
    const uid = pageRow(target).page_uid;
    const before = readPageSteps(PDF, uid)!;
    writePageSteps(PDF, uid, { ...before, steps: before.steps.map((s, i) => ({ ...s, script: `第 ${i} 步的旁白`, audio: `${uid}.step-${String(i).padStart(2, '0')}.m4a`, audioDurationSeconds: 3 + i })) });
    const narrated = readPageSteps(PDF, uid)!;

    // Another page whose step list no longer matches its clicks: refreshing it would misalign them.
    const uid2 = pageRow(mismatched).page_uid;
    const m2 = readPageSteps(PDF, uid2)!;
    writePageSteps(PDF, uid2, { ...m2, steps: m2.steps.slice(0, -1) });
    const m2Assets = readPageSteps(PDF, uid2)!.steps.map((s) => s.asset);

    const results = await refreshPptxStepFrames({ pdfId: PDF, pptxPath: FIXTURE, pageNumbers: [target, mismatched, still, 999], renderFrames: renderer(160) as never });
    const by = new Map(results.map((r) => [r.pageNumber, r]));

    const done = by.get(target)!;
    assert.equal(done.outcome, 'refreshed');
    assert.equal(done.changedFrames, narrated.steps.length, '每一張圖都換成新渲染的');
    const after = readPageSteps(PDF, uid)!;
    assert.equal(after.steps.length, narrated.steps.length, '步數不變');
    after.steps.forEach((s, i) => {
      const was = narrated.steps[i]!;
      assert.equal(s.script, was.script, '旁白要保留');
      assert.equal(s.audio, was.audio, '語音要保留');
      assert.equal(s.audioDurationSeconds, was.audioDurationSeconds);
      assert.notEqual(s.asset, was.asset, '圖片要換新名字，避免瀏覽器拿到舊的');
      assert.ok(fs.existsSync(path.join(config.storageRoot, PDF, 'pages', `${uid}.${s.asset}`)));
    });
    // The page's React code now shows the new pictures.
    const code = fs.readFileSync(path.join(config.storageRoot, PDF, 'pages', `${uid}.slide.jsx`), 'utf8');
    for (const s of after.steps) assert.ok(code.includes(s.asset!), `程式碼要引用新圖 ${s.asset}`);

    assert.equal(by.get(mismatched)!.outcome, 'step-count-changed');
    assert.deepEqual(readPageSteps(PDF, uid2)!.steps.map((s) => s.asset), m2Assets, '對不上的頁面一張都不動');
    assert.equal(by.get(still)!.outcome, 'not-animated');
    assert.equal(by.get(999)!.outcome, 'no-page');
  } finally {
    cleanup();
  }
});

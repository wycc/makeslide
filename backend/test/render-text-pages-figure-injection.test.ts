import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { setOpenAIClientForTest } from '../src/services/openai';
import { renderTextPagesWithLlm } from '../src/worker/steps/renderTextPagesWithLlm';

const ONE_PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function nowIso(): string {
  return new Date().toISOString();
}

function seedPdf(pdfId: string): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', t, t);
}

/** Writes a `figures.json` + reference PNG for `pageNumber`, so getFigureReferencesForPages finds it. */
function seedFigureManifest(pdfId: string, pageNumber: number, figureId: string, caption: string): void {
  const pdfDir = path.join(config.storageRoot, pdfId);
  const figuresDir = path.join(pdfDir, 'figures');
  fs.mkdirSync(figuresDir, { recursive: true });
  fs.writeFileSync(path.join(figuresDir, `${figureId}.png`), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(
    path.join(pdfDir, 'figures.json'),
    JSON.stringify({
      pdfId,
      generatedAt: nowIso(),
      pages: [
        {
          pageNumber,
          figures: [
            {
              id: figureId,
              imagePath: `figures/${figureId}.png`,
              width: 100,
              height: 100,
              bbox: { xPct: 0.1, yPct: 0.1, widthPct: 0.5, heightPct: 0.5 },
              caption,
              context: caption,
            },
          ],
        },
      ],
    }),
    'utf8',
  );
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

test('renderTextPagesWithLlm uses images.edit with figure reference + notes when sourcePdfPages map to extracted figures', async () => {
  const pdfId = 'test-render-figure-inject-01';
  cleanup(pdfId);
  seedPdf(pdfId);
  seedFigureManifest(pdfId, 1, 'p1-img1', 'Figure 1: 營收成長趨勢');

  const editCalls: Array<{ image: unknown; prompt: string }> = [];
  const generateCalls: Array<{ prompt: string }> = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { image: unknown; prompt: string }) => {
        editCalls.push({ image: body.image, prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
      generate: async (body: { prompt: string }) => {
        generateCalls.push({ prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);

  try {
    const result = await renderTextPagesWithLlm({
      pdfId,
      pages: [{ pageNumber: 1, pageUid: 'uid1', content: '第一頁內容', sourcePdfPages: [1] }],
    });

    assert.equal(result.pageCount, 1);
    assert.equal(editCalls.length, 1);
    assert.equal(generateCalls.length, 0);
    const { image, prompt } = editCalls[0]!;
    assert.ok(image, 'figure reference image should be attached');
    assert.match(prompt, /本頁對應的原始 PDF 內含以下圖表/);
    assert.match(prompt, /參考圖表 1：Figure 1: 營收成長趨勢/);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

test('renderTextPagesWithLlm falls back to images.generate when no sourcePdfPages / figures', async () => {
  const pdfId = 'test-render-figure-inject-02';
  cleanup(pdfId);
  seedPdf(pdfId);

  const editCalls: Array<{ prompt: string }> = [];
  const generateCalls: Array<{ prompt: string }> = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { prompt: string }) => {
        editCalls.push({ prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
      generate: async (body: { prompt: string }) => {
        generateCalls.push({ prompt: body.prompt });
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);

  try {
    const result = await renderTextPagesWithLlm({
      pdfId,
      pages: [{ pageNumber: 1, pageUid: 'uid1', content: '第一頁內容' }],
    });

    assert.equal(result.pageCount, 1);
    assert.equal(editCalls.length, 0);
    assert.equal(generateCalls.length, 1);
    assert.doesNotMatch(generateCalls[0]!.prompt, /本頁對應的原始 PDF 內含以下圖表/);
  } finally {
    setOpenAIClientForTest(null);
    cleanup(pdfId);
  }
});

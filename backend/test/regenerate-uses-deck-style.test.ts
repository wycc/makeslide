import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { setOpenAIClientForTest } from '../src/services/openai';
import { IMAGE_PROMPT_TEMPLATES, deckImageStylePrompt } from '../src/services/imagePromptTemplates';

setSystemAuthSettings({ googleAuthEnabled: false });

const ONE_PIXEL_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const DECK_STYLE = '16:9 白底深藍標題的專業工程簡報，橙色標示風險';

function seedDeck(pdfId: string, pageUid: string, stylePrompt: string | null): void {
  const t = new Date().toISOString();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,image_style_prompt,created_at,updated_at)
     VALUES (?,?,?,'ready',1,NULL,'private',?,?,?)`,
  ).run(pdfId, 't', 't.pdf', stylePrompt, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.jpg`), Buffer.from(ONE_PIXEL_PNG_B64, 'base64'));
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.text.txt`), '本頁說明搜尋節點的選擇規則', 'utf8');
  fs.writeFileSync(path.join(pagesDir, `${pageUid}.script.txt`), '選點依照優先值排序', 'utf8');
  db.prepare(
    `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,status,created_at,updated_at)
     VALUES (?,1,?,?,?,?,'audio_ready',?,?)`,
  ).run(pdfId, pageUid, `pages/${pageUid}.jpg`, `pages/${pageUid}.text.txt`, `pages/${pageUid}.script.txt`, t, t);
}

function cleanup(pdfId: string): void {
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  fs.rmSync(path.join(config.storageRoot, pdfId), { recursive: true, force: true });
}

/** Capture the prompt the redraw sends to the image model. */
function mockImages(): { prompts: string[] } {
  const prompts: string[] = [];
  setOpenAIClientForTest({
    images: {
      edit: async (body: { prompt: string }) => {
        prompts.push(body.prompt);
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
      generate: async (body: { prompt: string }) => {
        prompts.push(body.prompt);
        return { data: [{ b64_json: ONE_PIXEL_PNG_B64 }] };
      },
    },
  } as never);
  return { prompts };
}

test('deckImageStylePrompt prefers the deck style and falls back to the default template', () => {
  assert.equal(deckImageStylePrompt(DECK_STYLE), DECK_STYLE);
  assert.equal(deckImageStylePrompt('   '), IMAGE_PROMPT_TEMPLATES[0]?.prompt_en);
  assert.equal(deckImageStylePrompt(null), IMAGE_PROMPT_TEMPLATES[0]?.prompt_en);
});

test('single-page regenerate applies the deck style, not the hardcoded default template', async () => {
  const pdfId = 'test-regen-deck-style-01';
  seedDeck(pdfId, 'deckstyleuid1', DECK_STYLE);
  const { prompts } = mockImages();

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '讓文字更清晰' }),
    });
    assert.equal(resp.statusCode, 200);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, new RegExp(`生圖風格模板：${DECK_STYLE}`));
    // The old behaviour: every redraw claimed the academic-minimalist template regardless of the
    // deck's own style, so a redrawn page no longer matched the pages around it.
    assert.doesNotMatch(prompts[0]!, /academic minimalist style/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

test('a deck with no style of its own still gets the default template, as the initial generation did', async () => {
  const pdfId = 'test-regen-deck-style-02';
  seedDeck(pdfId, 'deckstyleuid2', null);
  const { prompts } = mockImages();

  const app = await buildApp();
  try {
    const resp = await app.inject({
      method: 'POST',
      url: `/api/pdfs/${pdfId}/pages/1/regenerate-image`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '讓文字更清晰' }),
    });
    assert.equal(resp.statusCode, 200);
    assert.match(prompts[0]!, /academic minimalist style/);
  } finally {
    setOpenAIClientForTest(null);
    await app.close();
    cleanup(pdfId);
  }
});

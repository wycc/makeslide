import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db';
import { config } from '../src/config';
import { setOpenAIClientForTest } from '../src/services/openai';
import {
  buildSystem,
  buildUser,
  clipCorpus,
  generateTitle,
  sanitiseUserPrompt,
} from '../src/worker/steps/generateTitle';

function nowIso(): string {
  return new Date().toISOString();
}

// ── clipCorpus ────────────────────────────────────────────────────────────

test('clipCorpus leaves short corpus untouched aside from trimming', () => {
  assert.equal(clipCorpus('  hello world  '), 'hello world');
});

test('clipCorpus clips an over-long corpus, keeping head and tail with a marker', () => {
  const head = 'A'.repeat(5000);
  const tail = 'B'.repeat(5000);
  const corpus = `${head}${tail}`;
  const clipped = clipCorpus(corpus);
  assert.ok(clipped.length < corpus.length);
  assert.ok(clipped.startsWith('A'));
  assert.ok(clipped.endsWith('B'.repeat(100)));
  assert.match(clipped, /中段略/);
});

test('clipCorpus treats a corpus exactly at the limit as untouched', () => {
  const corpus = 'C'.repeat(6000);
  assert.equal(clipCorpus(corpus), corpus);
});

// ── sanitiseUserPrompt ──────────────────────────────────────────────────────

test('sanitiseUserPrompt returns an empty string for null/undefined/blank input', () => {
  assert.equal(sanitiseUserPrompt(null), '');
  assert.equal(sanitiseUserPrompt(undefined), '');
  assert.equal(sanitiseUserPrompt('   '), '');
});

test('sanitiseUserPrompt trims a short prompt without truncation', () => {
  assert.equal(sanitiseUserPrompt('  use a friendly tone  '), 'use a friendly tone');
});

test('sanitiseUserPrompt truncates an over-long prompt with a marker', () => {
  const long = 'x'.repeat(2500);
  const result = sanitiseUserPrompt(long);
  assert.equal(result.length, 2000 + '……（已截斷）'.length);
  assert.ok(result.startsWith('x'.repeat(2000)));
  assert.match(result, /已截斷/);
});

// ── buildSystem ───────────────────────────────────────────────────────────

test('buildSystem produces English rules for contentLanguage "en"', () => {
  const system = buildSystem(null, 'en');
  assert.match(system, /senior English editor/);
  assert.doesNotMatch(system, /資深的中文編輯/);
});

test('buildSystem produces Traditional Chinese rules for contentLanguage "zh-TW"', () => {
  const system = buildSystem(null, 'zh-TW');
  assert.match(system, /資深的中文編輯/);
  assert.doesNotMatch(system, /senior English editor/);
});

test('buildSystem appends a sanitised user-style section when a prompt is given', () => {
  const withPrompt = buildSystem('please sound playful', 'en');
  const withoutPrompt = buildSystem(null, 'en');
  assert.match(withPrompt, /please sound playful/);
  assert.doesNotMatch(withoutPrompt, /please sound playful/);
});

// ── buildUser ─────────────────────────────────────────────────────────────

test('buildUser embeds the corpus verbatim and uses English instructions for "en"', () => {
  const user = buildUser('the corpus content', 'en');
  assert.match(user, /the corpus content/);
  assert.match(user, /Name the whole slide deck in English/);
});

test('buildUser embeds the corpus verbatim and uses Traditional Chinese instructions for "zh-TW"', () => {
  const user = buildUser('逐字稿內容', 'zh-TW');
  assert.match(user, /逐字稿內容/);
  assert.match(user, /請依內容為整份簡報命名/);
});

// ── generateTitle (integration) ──────────────────────────────────────────

function seedPdfWithScripts(pdfId: string, scripts: string[]): void {
  const t = nowIso();
  db.prepare(`DELETE FROM pages WHERE pdf_id = ?`).run(pdfId);
  db.prepare(`DELETE FROM pdfs WHERE id = ?`).run(pdfId);
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,progress_step,progress_current,progress_total,error_message,user_prompt,require_script_confirmation,tts_voice,tts_speed,script_max_chars_per_page,created_at,updated_at)
     VALUES (?,?,?,'ready',?,NULL,NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,?,?)`,
  ).run(pdfId, 't', 't.pdf', scripts.length, t, t);

  const pagesDir = path.join(config.storageRoot, pdfId, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  scripts.forEach((script, idx) => {
    const pageNumber = idx + 1;
    const uid = `gentitle${pageNumber}`;
    db.prepare(
      `INSERT INTO pages (pdf_id,page_number,page_uid,image_path,text_path,script_path,audio_path,audio_duration_seconds,status,error_message,created_at,updated_at)
       VALUES (?,?,?,?,?,?,NULL,NULL,'audio_ready',NULL,?,?)`,
    ).run(pdfId, pageNumber, uid, `pages/${uid}.jpg`, `pages/${uid}.text.txt`, `pages/${uid}.script.txt`, t, t);
    fs.writeFileSync(path.join(pagesDir, `${uid}.script.txt`), script, 'utf8');
    fs.writeFileSync(path.join(pagesDir, `${uid}.text.txt`), `text-${pageNumber}`, 'utf8');
  });
}

function mockTitleResponse(rawTitle: string): void {
  setOpenAIClientForTest({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ title: rawTitle }) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      },
    },
  } as never);
}

test('generateTitle uses page scripts, strips trailing punctuation, and reports source "script"', async () => {
  seedPdfWithScripts('gentitle-script-01', ['第一頁逐字稿', '第二頁逐字稿']);
  mockTitleResponse('機器學習入門指南。');
  try {
    const result = await generateTitle('gentitle-script-01', 2, { contentLanguage: 'zh-TW' });
    assert.equal(result.title, '機器學習入門指南');
    assert.equal(result.source, 'script');
    assert.equal(result.usage.total_tokens, 15);
    assert.equal(typeof result.latencyMs, 'number');
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('generateTitle falls back to page text when no scripts exist', async () => {
  seedPdfWithScripts('gentitle-text-01', ['', '']);
  mockTitleResponse('Intro to Machine Learning');
  try {
    const result = await generateTitle('gentitle-text-01', 2, { contentLanguage: 'en' });
    assert.equal(result.title, 'Intro to Machine Learning');
    assert.equal(result.source, 'text');
  } finally {
    setOpenAIClientForTest(null);
  }
});

test('generateTitle throws when no script/text content is available', async () => {
  seedPdfWithScripts('gentitle-empty-01', []);
  await assert.rejects(() => generateTitle('gentitle-empty-01', 0), /No script\/text content available/);
});

test('generateTitle throws when the model returns a title that sanitises to too-short', async () => {
  seedPdfWithScripts('gentitle-shorttitle-01', ['一些內容']);
  mockTitleResponse('。！？');
  try {
    await assert.rejects(() => generateTitle('gentitle-shorttitle-01', 1), /empty title after sanitisation/);
  } finally {
    setOpenAIClientForTest(null);
  }
});

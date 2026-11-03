import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildApp } from '../src/server';
import { db } from '../src/db';
import { config } from '../src/config';
import { setSystemAuthSettings } from '../src/services/aiSettings';
import { buildQuizPaperHtml, type QuizPaperQuestion } from '../src/services/quizPaperPdf';

/**
 * Printable quiz papers. The rule that must never break: the student paper carries no answer,
 * explanation or essay reference answer, and only someone who can edit the deck can download either.
 */

setSystemAuthSettings({ googleAuthEnabled: false });

function sessionCookie(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ provider: 'google', sub, email: `${sub}@example.com` }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.authSessionSecret).update(payload).digest('base64url');
  return `makeslide_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}

const QUESTIONS: QuizPaperQuestion[] = [
  {
    id: 'q1',
    type: 'multiple',
    question: '矩陣 $A^2$ 與 <script>alert(1)</script>',
    options: [{ text: '甲' }, { text: '乙' }, { text: '丙' }],
    answer_indices: [2, 0],
    explanation: 'EXPLANATION-SECRET',
    score: 40,
  },
  {
    id: 'q2',
    type: 'essay',
    question: '說明 rank',
    options: [],
    answer_indices: [],
    explanation: '',
    reference_answer: 'REFERENCE-SECRET',
  },
];

const input = (variant: 'paper' | 'answers', lang: 'zh-TW' | 'en' = 'zh-TW') => ({
  quizTitle: '小考 <一>',
  deckTitle: '線性代數',
  timeLimitSeconds: 1500,
  questions: QUESTIONS,
  variant,
  lang,
});

test('the student paper has blanks and name fields but no answers', () => {
  const html = buildQuizPaperHtml(input('paper'));
  assert.ok(!html.includes('EXPLANATION-SECRET'));
  assert.ok(!html.includes('REFERENCE-SECRET'));
  assert.ok(!html.includes('✓'));
  assert.ok(!html.includes('class="opt correct"'));
  assert.ok(!html.includes('<div class="note">'));
  assert.ok(html.includes('<div class="blank"></div>'));
  assert.ok(html.includes('學號：'));
  assert.ok(html.includes('共 2 題　作答時間 25 分鐘'));
});

test('the answer key marks correct options in order, with explanation and reference answer', () => {
  const html = buildQuizPaperHtml(input('answers'));
  assert.equal(html.match(/class="opt correct"/g)?.length, 2);
  assert.ok(html.includes('答案：</strong>A、C'));
  assert.ok(html.includes('EXPLANATION-SECRET'));
  assert.ok(html.includes('REFERENCE-SECRET'));
  assert.ok(html.includes('請勿發給學生'));
  assert.ok(!html.includes('class="blank"'));
  assert.ok(!html.includes('學號：'));
});

test('points follow the quiz scoring rule and labels follow the language', () => {
  assert.ok(buildQuizPaperHtml(input('paper')).includes('（複選，40 分）'));
  assert.ok(buildQuizPaperHtml(input('paper')).includes('（問答，60 分）'));
  assert.ok(buildQuizPaperHtml(input('paper', 'en')).includes('(Essay, 60 pts)'));
});

test('text is escaped and math goes through KaTeX', () => {
  const html = buildQuizPaperHtml(input('paper'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('小考 &lt;一&gt;'));
  assert.ok(html.includes('class="katex"'));
});

test('the route is limited to editors and scoped to the deck', async () => {
  const app = await buildApp();
  const t = new Date().toISOString();
  const pdfId = `paper${crypto.randomBytes(4).toString('hex')}`;
  const owner = 'quiz-paper-owner';
  db.prepare(
    `INSERT INTO pdfs (id,title,original_filename,status,page_count,owner_sub,visibility,created_at,updated_at)
     VALUES (?,?,?,'ready',1,?,'public',?,?)`,
  ).run(pdfId, 'Deck', `${pdfId}.pdf`, owner, t, t);
  const quizId = Number(
    db.prepare(`INSERT INTO quiz_sets (pdf_id,title,prompt,questions_json,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(pdfId, '小考', '', JSON.stringify(QUESTIONS), t, t).lastInsertRowid,
  );
  const get = (path: string, sub?: string) =>
    app.inject({ method: 'GET', url: path, headers: sub ? { cookie: sessionCookie(sub) } : {} });
  const url = `/api/pdfs/${pdfId}/quizzes/${quizId}/paper.pdf`;

  assert.equal((await get(`${url}?variant=answers`, 'quiz-paper-student')).statusCode, 403);
  assert.equal((await get(`${url}?variant=answers`)).statusCode, 403);
  assert.equal((await get(`/api/pdfs/${pdfId}/quizzes/${quizId + 1000}/paper.pdf`, owner)).statusCode, 404);
  assert.equal((await get(`${url}?variant=bogus`, owner)).statusCode, 400);
  // MAKESLIDE_TEST makes the launcher refuse, which is exactly a deployment without Chrome.
  const previous = process.env.MAKESLIDE_TEST;
  process.env.MAKESLIDE_TEST = '1';
  delete process.env.MAKESLIDE_TEST_ALLOW_BROWSER;
  const noChrome = await get(url, owner);
  if (previous === undefined) delete process.env.MAKESLIDE_TEST;
  else process.env.MAKESLIDE_TEST = previous;
  assert.equal(noChrome.statusCode, 503);
  assert.ok(noChrome.body.includes('PDF_UNAVAILABLE'));
  await app.close();
});

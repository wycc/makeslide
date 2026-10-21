import test from 'node:test';
import assert from 'node:assert/strict';
import { zhTW } from '../locales/zh-TW';
import { interpolateTemplate } from './interpolateTemplate';
import type { QuizQuestion } from '../types';
import {
  buildReceiptLines,
  fitImage,
  findUnansweredQuestionNumbers,
  jpegPagesToPdf,
  receiptFilename,
  receiptFingerprint,
  receiptPlainText,
  wrapText,
} from './quizReceiptPdf';

const q = (id: string, type: QuizQuestion['type'], options: string[] = ['甲', '乙', '丙']): QuizQuestion => ({
  id, type, question: `**題目** ${id}`, options: options.map((text) => ({ text })), answer_indices: [0], explanation: '',
});

const QUESTIONS = [q('a', 'single'), q('b', 'multiple'), q('c', 'essay', []), q('d', 'single')];
const f = (key: string, vars?: Record<string, string | number>) =>
  interpolateTemplate((zhTW as Record<string, string>)[key] ?? key, vars ?? {});

test('unanswered: choice needs a selection, essay needs an uploaded photo; numbers follow display order', () => {
  assert.deepEqual(findUnansweredQuestionNumbers(QUESTIONS, {}, {}), [1, 2, 3, 4]);
  assert.deepEqual(findUnansweredQuestionNumbers(QUESTIONS, { a: [1], b: [], d: [0] }, { c: 0 }), [2, 3]);
  assert.deepEqual(findUnansweredQuestionNumbers(QUESTIONS, { a: [1], b: [0, 2], d: [0] }, { c: 2 }), []);
});

test('receipt lines carry identity, server receipt, every answer and the unanswered list', () => {
  const lines = buildReceiptLines({
    quizTitle: '第一次小考', deckTitle: '機器學習', code: 'S123', name: '王小明', clientId: 'cid', sessionId: 'sid',
    questions: QUESTIONS, answers: { a: [1], b: [2, 0] }, essayPhotoCounts: { c: 3 },
    generatedAt: new Date(2026, 9, 7, 9, 5, 3), receipt: { attemptId: 42, submittedAt: '2026-10-07T01:05:00.000Z' }, fingerprint: 'abc',
  }, f);
  const text = lines.map((l) => l.text).join('\n');
  for (const part of ['測驗作答證明', '第一次小考', '機器學習', 'S123', '王小明', '#42', '2026-10-07 09:05:03', 'sid', 'cid', 'abc',
    '已作答 3 / 4 題', '未作答：第 4 題', '已上傳 3 張作答照片', '作答：A、C', '[X] B. 乙']) {
    assert.ok(text.includes(part), `missing ${part}`);
  }
  assert.ok(!text.includes('**'), 'markdown markers stripped');
  assert.ok(lines.some((l) => l.kind === 'heading' && l.text.includes('第 4 題') && l.text.includes('未作答')));
  assert.ok(!lines.some((l) => l.text.includes('未確認')));
});

test('a failed upload still yields a receipt, clearly marked unconfirmed', () => {
  const lines = buildReceiptLines({
    quizTitle: 'Q', code: null, clientId: 'c', sessionId: 's', questions: QUESTIONS, answers: {}, essayPhotoCounts: {},
    generatedAt: new Date(), receipt: null, fingerprint: null,
  }, f);
  assert.ok(lines.some((l) => l.kind === 'warn' && l.text.includes('未確認')));
  assert.ok(lines.some((l) => l.text === '學號：（未設定）'));
});

test('plain text strips the common markdown markers', () => {
  assert.equal(receiptPlainText('## 標題\n**粗** `x` [連結](http://a) ![](img.png)'), '標題\n粗 x 連結');
});

test('wrapText keeps latin words whole, breaks CJK per character, and splits overlong tokens', () => {
  const measure = (s: string) => s.length;
  assert.deepEqual(wrapText('hello world foo', 11, measure), ['hello world', 'foo']);
  assert.deepEqual(wrapText('一二三四五六', 4, measure), ['一二三四', '五六']);
  assert.deepEqual(wrapText('abcdefghij', 4, measure), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapText('a\n\nb', 10, measure), ['a', '', 'b']);
});

test('jpegPagesToPdf builds a well-formed PDF whose xref points at each object', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  const bytes = jpegPagesToPdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  assert.equal((text.match(/\/Filter \/DCTDecode/g) ?? []).length, 2);
  const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assert.ok(text.slice(startxref).startsWith('xref\n'));
  const entries = text.slice(startxref).split('\n').slice(3).filter((l) => / 00000 n $/.test(l));
  assert.equal(entries.length, 2 + 2 * 3 + 1);
  entries.forEach((entry, i) => {
    const off = Number(entry.slice(0, 10));
    assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`);
  });
});

test('fingerprint is stable regardless of key/selection order', async () => {
  const a = await receiptFingerprint({ quizId: 1, sessionId: 's', clientId: 'c', answers: { x: [2, 0], y: [1] } });
  const b = await receiptFingerprint({ quizId: 1, sessionId: 's', clientId: 'c', answers: { y: [1], x: [0, 2] } });
  const c = await receiptFingerprint({ quizId: 1, sessionId: 's', clientId: 'c', answers: { y: [1], x: [0] } });
  assert.match(a ?? '', /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('filename is safe for phones and desktops', () => {
  assert.equal(receiptFilename('期中 考/第1次', 'S 1', new Date(2026, 9, 7, 9, 5, 3)), 'quiz-receipt-期中_考_第1次-S_1-20261007-090503.pdf');
  assert.equal(receiptFilename('Q', null, new Date(2026, 0, 2, 3, 4, 5)), 'quiz-receipt-Q-20260102-030405.pdf');
});

test('uploaded essay photos are placed right after their question, in order', () => {
  const p1 = new Blob(['1'], { type: 'image/jpeg' });
  const p2 = new Blob(['2'], { type: 'image/jpeg' });
  const lines = buildReceiptLines({
    quizTitle: 'Q', code: 'S', clientId: 'c', sessionId: 's', questions: QUESTIONS, answers: {},
    essayPhotoCounts: { c: 2 }, essayPhotos: { c: [p1, p2] }, generatedAt: new Date(), receipt: null, fingerprint: null,
  }, f);
  const essayHeading = lines.findIndex((l) => l.kind === 'heading' && l.text.startsWith('第 3 題'));
  const images = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'image');
  assert.deepEqual(images.map(({ l }) => l.image), [p1, p2]);
  assert.ok(images.every(({ i }) => i > essayHeading && i < lines.findIndex((l) => l.kind === 'heading' && l.text.startsWith('第 4 題'))));
  assert.match(images[1]!.l.text, /第 2 張照片/, 'fallback text if the photo cannot be decoded');
});

test('fitImage keeps the aspect ratio within the content width and max height', () => {
  assert.deepEqual(fitImage(4000, 3000, 1000), { w: 1000, h: 750 });
  assert.deepEqual(fitImage(3000, 4000, 1000, 760), { w: 570, h: 760 });
  assert.deepEqual(fitImage(0, 10, 1000), { w: 0, h: 0 });
});

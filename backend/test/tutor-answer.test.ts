import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeTutorAnswer, tutorNoAnswerFallback } from '../src/routes/pdfs/tutorAnswer';

test('finalizeTutorAnswer converts literal \\n\\n into a real blank line', () => {
  assert.equal(finalizeTutorAnswer('第一段。\\n\\n第二段。'), '第一段。\n\n第二段。');
});

test('finalizeTutorAnswer converts a single literal \\n into a newline', () => {
  assert.equal(finalizeTutorAnswer('甲\\n乙'), '甲\n乙');
});

test('finalizeTutorAnswer converts literal \\r\\n into a newline', () => {
  assert.equal(finalizeTutorAnswer('甲\\r\\n乙'), '甲\n乙');
});

test('finalizeTutorAnswer preserves LaTeX commands that start with n/r/t', () => {
  // \nabla, \rho, \right, \times must NOT be turned into newlines/whitespace.
  const tex = '梯度為 $\\nabla f$，密度 $\\rho$，右界 $\\right)$，乘積 $a \\times b$。';
  assert.equal(finalizeTutorAnswer(tex), tex);
});

test('finalizeTutorAnswer trims surrounding whitespace', () => {
  assert.equal(finalizeTutorAnswer('  有內容的回答  '), '有內容的回答');
});

test('finalizeTutorAnswer returns the fixed fallback for a blank answer', () => {
  assert.equal(finalizeTutorAnswer(''), tutorNoAnswerFallback('zh-TW'));
  assert.equal(finalizeTutorAnswer('   '), tutorNoAnswerFallback('zh-TW'));
  assert.equal(finalizeTutorAnswer('\\n\\n'), tutorNoAnswerFallback('zh-TW'));
});

test('finalizeTutorAnswer leaves a normal answer unchanged', () => {
  assert.equal(finalizeTutorAnswer('這是一個正常的回答。'), '這是一個正常的回答。');
});

test('the empty-answer fallback follows the output language, since the student reads it verbatim', () => {
  // A tutor answering in English that ends the conversation in Chinese is two languages in one
  // thread — this string is shown as-is, not fed to a model.
  assert.equal(finalizeTutorAnswer('', 'en'), tutorNoAnswerFallback('en'));
  assert.match(finalizeTutorAnswer('', 'en'), /^Sorry/);
  assert.match(finalizeTutorAnswer('', 'zh-TW'), /^很抱歉/);
});

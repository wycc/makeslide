import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizImportJson } from './quizImport';

test('parseQuizImportJson returns invalid_json for malformed input', () => {
  const out = parseQuizImportJson('{not json');
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error, 'invalid_json');
});

test('parseQuizImportJson returns no_questions when questions is missing or not an array', () => {
  assert.equal(parseQuizImportJson('{}').ok, false);
  assert.equal(parseQuizImportJson('{"questions": "x"}').ok, false);
  const out = parseQuizImportJson('{"title":"T"}');
  if (!out.ok) assert.equal(out.error, 'no_questions');
});

test('parseQuizImportJson normalizes a valid quiz and renumbers ids', () => {
  const json = JSON.stringify({
    title: 'My Quiz',
    questions: [
      { id: 'whatever', type: 'single', question: 'A?', options: [{ text: 'a' }, { text: 'b' }], answer_indices: [0], explanation: 'because' },
      { question: 'B?', options: ['x', 'y', 'z'], answer_indices: [1, 2] },
    ],
  });
  const out = parseQuizImportJson(json);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.value.title, 'My Quiz');
  assert.equal(out.value.questions.length, 2);
  assert.deepEqual(out.value.questions.map((q) => q.id), ['q1', 'q2']);
  // string options coerced to {text}
  assert.deepEqual(out.value.questions[1]!.options, [{ text: 'x' }, { text: 'y' }, { text: 'z' }]);
  // type inferred as multiple from 2 answer indices
  assert.equal(out.value.questions[1]!.type, 'multiple');
  assert.equal(out.value.questions[0]!.explanation, 'because');
});

test('parseQuizImportJson drops out-of-range and duplicate answer indices', () => {
  const json = JSON.stringify({
    questions: [{ question: 'Q?', options: [{ text: 'a' }, { text: 'b' }], answer_indices: [0, 0, 5, -1, 1] }],
  });
  const out = parseQuizImportJson(json);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.value.questions[0]!.answer_indices, [0, 1]);
});

test('parseQuizImportJson skips questions with no text or no options, erroring if none remain', () => {
  const json = JSON.stringify({
    questions: [
      { question: '   ', options: [{ text: 'a' }] },
      { question: 'no options', options: [] },
    ],
  });
  const out = parseQuizImportJson(json);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.error, 'no_valid_questions');
});

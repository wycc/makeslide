import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptTemplate, loadPromptTemplate } from '../src/services/promptTemplates';

test('renderPromptTemplate substitutes a named variable', () => {
  assert.equal(renderPromptTemplate('Hello {{name}}', { name: 'World' }), 'Hello World');
});

test('renderPromptTemplate tolerates surrounding whitespace inside the braces', () => {
  assert.equal(renderPromptTemplate('Hello {{  name  }}', { name: 'World' }), 'Hello World');
});

test('renderPromptTemplate replaces a missing or empty variable with an empty string', () => {
  assert.equal(renderPromptTemplate('Hi {{missing}}!', {}), 'Hi !');
  assert.equal(renderPromptTemplate('[{{x}}]', { x: '' }), '[]');
});

test('renderPromptTemplate substitutes every occurrence and multiple variables', () => {
  assert.equal(renderPromptTemplate('{{x}}{{x}}', { x: 'a' }), 'aa');
  assert.equal(
    renderPromptTemplate('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Sam' }),
    'Hi, Sam!',
  );
});

test('renderPromptTemplate accepts underscores and digits in variable names', () => {
  assert.equal(renderPromptTemplate('{{user_id1}}', { user_id1: '42' }), '42');
});

test('renderPromptTemplate leaves text with no placeholders untouched', () => {
  assert.equal(renderPromptTemplate('plain text', { x: 'a' }), 'plain text');
});

test('renderPromptTemplate ignores placeholders with non-name characters', () => {
  // a hyphen is not part of the allowed [a-zA-Z0-9_] name, so the token is left as-is
  assert.equal(renderPromptTemplate('{{a-b}}', { 'a-b': 'x' }), '{{a-b}}');
});

test('loadPromptTemplate returns the fallback when the file does not exist', () => {
  assert.equal(
    loadPromptTemplate('definitely/missing/prompt-xyz.txt', 'FALLBACK'),
    'FALLBACK',
  );
});

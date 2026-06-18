import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config';
import { loadPromptTemplate, renderPromptTemplate } from '../src/services/promptTemplates';

const FIXTURE_DIR_REL = '.tmp-prompt-templates-test';
const FIXTURE_DIR_ABS = path.join(config.repoRoot, FIXTURE_DIR_REL);

function withFixtureFile(filename: string, content: string | null, run: (relPath: string) => void): void {
  fs.mkdirSync(FIXTURE_DIR_ABS, { recursive: true });
  const relPath = path.join(FIXTURE_DIR_REL, filename);
  const absPath = path.join(config.repoRoot, relPath);
  try {
    if (content !== null) fs.writeFileSync(absPath, content, 'utf8');
    run(relPath);
  } finally {
    fs.rmSync(FIXTURE_DIR_ABS, { recursive: true, force: true });
  }
}

// ── loadPromptTemplate ──────────────────────────────────────────────────

test('loadPromptTemplate falls back when the file does not exist', () => {
  const result = loadPromptTemplate(path.join(FIXTURE_DIR_REL, 'does-not-exist.txt'), 'fallback text');
  assert.equal(result, 'fallback text');
});

test('loadPromptTemplate falls back when the file is whitespace-only', () => {
  withFixtureFile('blank.txt', '   \n\t  \n', (relPath) => {
    assert.equal(loadPromptTemplate(relPath, 'fallback text'), 'fallback text');
  });
});

test('loadPromptTemplate falls back when the file is empty', () => {
  withFixtureFile('empty.txt', '', (relPath) => {
    assert.equal(loadPromptTemplate(relPath, 'fallback text'), 'fallback text');
  });
});

test('loadPromptTemplate returns trimmed file content when present', () => {
  withFixtureFile('content.txt', '  hello {{name}}  \n', (relPath) => {
    assert.equal(loadPromptTemplate(relPath, 'fallback text'), 'hello {{name}}');
  });
});

// ── renderPromptTemplate ────────────────────────────────────────────────

test('renderPromptTemplate substitutes a single variable', () => {
  assert.equal(renderPromptTemplate('Hello {{name}}!', { name: 'World' }), 'Hello World!');
});

test('renderPromptTemplate substitutes multiple distinct variables', () => {
  const result = renderPromptTemplate('{{greeting}}, {{name}}! Today is {{day}}.', {
    greeting: 'Hi',
    name: 'Ada',
    day: 'Monday',
  });
  assert.equal(result, 'Hi, Ada! Today is Monday.');
});

test('renderPromptTemplate substitutes a repeated variable consistently', () => {
  assert.equal(renderPromptTemplate('{{name}} and {{name}} again', { name: 'Bob' }), 'Bob and Bob again');
});

test('renderPromptTemplate replaces a key with no matching var with an empty string', () => {
  assert.equal(renderPromptTemplate('Hello {{missing}}!', {}), 'Hello !');
});

test('renderPromptTemplate tolerates surrounding whitespace inside the braces', () => {
  assert.equal(renderPromptTemplate('Hello {{ name }}!', { name: 'World' }), 'Hello World!');
});

test('renderPromptTemplate leaves non-template text untouched when there are no placeholders', () => {
  assert.equal(renderPromptTemplate('No placeholders here.', { unused: 'x' }), 'No placeholders here.');
});

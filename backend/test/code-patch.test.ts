import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPatchText, applySearchReplaceBlocks, parseSearchReplaceBlocks } from '../src/services/codePatch';

const CODE = [
  'window.renderAnimation = function (root, api) {',
  '  var color = "red";',
  '  var radius = 40;',
  '  api.onFrame(function (f) {',
  '    draw(color, radius, f.t);',
  '  });',
  '};',
].join('\n');

function block(search: string, replace: string): string {
  return `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
}

test('a single block replaces exactly its own text', () => {
  const result = applyPatchText(CODE, block('  var color = "red";', '  var color = "blue";'));
  assert.ok(result.ok);
  assert.ok(result.code.includes('var color = "blue"'));
  assert.ok(result.code.includes('var radius = 40'), 'the rest of the file is untouched');
  assert.equal(result.applied, 1);
});

test('several blocks apply in order, each to the previous result', () => {
  const patch = [
    block('  var color = "red";', '  var color = "blue";'),
    block('  var radius = 40;', '  var radius = 64;'),
  ].join('\n\n');
  const result = applyPatchText(CODE, patch);
  assert.ok(result.ok);
  assert.equal(result.applied, 2);
  assert.ok(result.code.includes('"blue"') && result.code.includes('64'));
});

test('a later block may edit what an earlier block produced', () => {
  const patch = [
    block('  var color = "red";', '  var color = "green";'),
    block('  var color = "green";', '  var color = "teal";'),
  ].join('\n\n');
  const result = applyPatchText(CODE, patch);
  assert.ok(result.ok);
  assert.ok(result.code.includes('"teal"'));
});

test('prose and markdown fences around the blocks are tolerated', () => {
  // Models narrate a little whatever the prompt says; the blocks are what matters.
  const patch = [
    'Here is the change you asked for:',
    '```',
    block('  var radius = 40;', '  var radius = 12;'),
    '```',
    'That makes the circle smaller.',
  ].join('\n');
  const result = applyPatchText(CODE, patch);
  assert.ok(result.ok);
  assert.ok(result.code.includes('var radius = 12'));
});

test('a SEARCH that is not in the code fails instead of guessing', () => {
  const result = applyPatchText(CODE, block('  var color = "purple";', '  var color = "blue";'));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /not present/);
});

test('an ambiguous SEARCH fails rather than patching the first occurrence', () => {
  // Patching one of several identical fragments is how the wrong line silently changes.
  const repeated = 'a();\nb();\na();\n';
  const result = applyPatchText(repeated, block('a();', 'c();'));
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /more than once/);
});

test('nothing is applied when a later block fails', () => {
  const patch = [
    block('  var color = "red";', '  var color = "blue";'),
    block('  var missing = 1;', '  var missing = 2;'),
  ].join('\n\n');
  const result = applyPatchText(CODE, patch);
  assert.equal(result.ok, false, 'all-or-nothing: a half-applied patch matches neither version');
});

test('an empty SEARCH section is rejected', () => {
  const result = applyPatchText(CODE, '<<<<<<< SEARCH\n\n=======\n  var extra = 1;\n>>>>>>> REPLACE');
  assert.equal(result.ok, false);
});

test('a reply with no blocks at all fails', () => {
  const result = applyPatchText(CODE, 'I could not find anything to change.');
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /no search\/replace blocks/);
});

test('a half-written block is reported rather than silently skipped', () => {
  // The model started an edit and lost the shape: applying only the readable half would look
  // finished while missing part of what was asked for.
  const patch = [
    block('  var color = "red";', '  var color = "blue";'),
    '<<<<<<< SEARCH',
    '  var radius = 40;',
  ].join('\n\n');
  const result = applyPatchText(CODE, patch);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /malformed/);
});

test('deleting a section is expressed as an empty REPLACE', () => {
  const result = applyPatchText(CODE, '<<<<<<< SEARCH\n  var radius = 40;\n=======\n>>>>>>> REPLACE');
  assert.ok(result.ok);
  assert.equal(result.code.includes('var radius'), false);
});

test('parseSearchReplaceBlocks reports both the blocks and the malformed count', () => {
  const parsed = parseSearchReplaceBlocks(`${block('a', 'b')}\n<<<<<<< SEARCH\nunfinished`);
  assert.equal(parsed.blocks.length, 1);
  assert.equal(parsed.malformed, 1);
});

test('applySearchReplaceBlocks preserves surrounding whitespace exactly', () => {
  const code = 'line1\n\n  indented\n\nline3\n';
  const result = applySearchReplaceBlocks(code, [{ search: '  indented', replace: '  changed' }]);
  assert.ok(result.ok);
  assert.equal(result.code, 'line1\n\n  changed\n\nline3\n');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotebookHtmlSrcDoc, NOTEBOOK_HTML_HEIGHT_MESSAGE } from './notebookHtmlSandbox';

test('buildNotebookHtmlSrcDoc produces a full HTML document', () => {
  const doc = buildNotebookHtmlSrcDoc('<p>hi</p>');
  assert.match(doc, /^<!doctype html>/i);
  assert.match(doc, /<html>[\s\S]*<\/html>\s*$/i);
  assert.match(doc, /<script>/);
});

test('buildNotebookHtmlSrcDoc embeds the fragment verbatim (sandbox contains it, not escaping)', () => {
  // A pandas-style table fragment must appear unescaped inside the document body.
  const frag = '<table><tr><td>a&b</td></tr></table>';
  const doc = buildNotebookHtmlSrcDoc(frag);
  assert.ok(doc.includes(frag), 'fragment should be embedded as-is');
});

test('buildNotebookHtmlSrcDoc keeps embedded scripts (isolation is the iframe sandbox, not stripping)', () => {
  const frag = '<div id="plot"></div><script>window.__ran=true</script>';
  const doc = buildNotebookHtmlSrcDoc(frag);
  assert.ok(doc.includes(frag), 'script fragment stays; the sandboxed frame is what contains it');
});

test('buildNotebookHtmlSrcDoc wires the height-report message type the parent listens for', () => {
  const doc = buildNotebookHtmlSrcDoc('<p>x</p>');
  assert.ok(doc.includes(NOTEBOOK_HTML_HEIGHT_MESSAGE), 'srcdoc must postMessage the shared height message type');
  assert.match(doc, /postMessage/);
  assert.match(doc, /scrollHeight/);
});

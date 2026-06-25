import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findUnsafeScriptPattern,
  findCustomScriptContractIssue,
} from '../src/services/animationCustomScript';

const SAFE_CODE = [
  'window.renderAnimation = (root, api) => {',
  '  const c = document.createElement("canvas");',
  '  root.appendChild(c);',
  '  api.onFrame(({ t }) => {',
  '    const p = Math.min(t / api.duration, 1);',
  '    c.style.opacity = String(p);',
  '  });',
  '};',
].join('\n');

test('findUnsafeScriptPattern returns null for safe code', () => {
  assert.equal(findUnsafeScriptPattern(SAFE_CODE), null);
});

test('findUnsafeScriptPattern flags networking and dynamic-eval APIs', () => {
  assert.equal(findUnsafeScriptPattern('fetch("/x")'), 'fetch');
  assert.equal(findUnsafeScriptPattern('new XMLHttpRequest()'), 'XMLHttpRequest');
  assert.equal(findUnsafeScriptPattern('new WebSocket("wss://x")'), 'WebSocket');
  assert.equal(findUnsafeScriptPattern('await import("x")'), 'import');
  assert.equal(findUnsafeScriptPattern('require("fs")'), 'require');
  assert.equal(findUnsafeScriptPattern('eval("1+1")'), 'eval');
  assert.equal(findUnsafeScriptPattern('new Function("return 1")'), 'new Function');
});

test('findUnsafeScriptPattern flags cookie/storage access in both dot and bracket form', () => {
  assert.equal(findUnsafeScriptPattern('document.cookie'), 'document.cookie');
  assert.equal(findUnsafeScriptPattern('document["cookie"]'), 'document.cookie');
  assert.equal(findUnsafeScriptPattern('localStorage.getItem("k")'), 'localStorage');
  assert.equal(findUnsafeScriptPattern('sessionStorage.setItem("k","v")'), 'sessionStorage');
  assert.equal(findUnsafeScriptPattern('indexedDB.open("db")'), 'indexedDB');
});

test('findUnsafeScriptPattern flags frame-escape access', () => {
  assert.equal(findUnsafeScriptPattern('window.parent.location'), 'window.parent');
  assert.equal(findUnsafeScriptPattern('self["parent"]'), 'window.parent');
  assert.equal(findUnsafeScriptPattern('window.top'), 'window.top');
  assert.equal(findUnsafeScriptPattern('globalThis["top"]'), 'window.top');
  assert.equal(findUnsafeScriptPattern('frameElement.id'), 'frameElement');
});

test('findUnsafeScriptPattern reports the first matching pattern by definition order', () => {
  // fetch is checked before eval, so the fetch label wins
  assert.equal(findUnsafeScriptPattern('eval("x"); fetch("/y");'), 'fetch');
});

test('findCustomScriptContractIssue accepts code defining renderAnimation and calling onFrame', () => {
  assert.equal(findCustomScriptContractIssue(SAFE_CODE), null);
  const bracketForm = 'window["renderAnimation"] = function (root, api) { api.onFrame(function () {}); };';
  assert.equal(findCustomScriptContractIssue(bracketForm), null);
});

test('findCustomScriptContractIssue requires a renderAnimation definition', () => {
  const issue = findCustomScriptContractIssue('api.onFrame(() => {});');
  assert.match(issue ?? '', /window\.renderAnimation/);
});

test('findCustomScriptContractIssue requires an api.onFrame call', () => {
  const issue = findCustomScriptContractIssue('window.renderAnimation = (root, api) => {};');
  assert.match(issue ?? '', /api\.onFrame/);
});

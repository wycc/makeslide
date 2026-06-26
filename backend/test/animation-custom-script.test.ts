import test from 'node:test';
import assert from 'node:assert/strict';
import { findCustomScriptContractIssue, findUnsafeScriptPattern } from '../src/services/animationCustomScript';

const VALID_CONTRACT_CODE = `
window.renderAnimation = function (root, api) {
  api.onFrame(function (frame) {
    var progress = Math.min(frame.t / api.duration, 1);
    root.style.opacity = String(progress);
  });
};
`;

test('findUnsafeScriptPattern returns null for safe code that follows the runtime contract', () => {
  assert.equal(findUnsafeScriptPattern(VALID_CONTRACT_CODE), null);
});

test('findUnsafeScriptPattern does not flag the lowercase function keyword', () => {
  // The Function-constructor guard is case-sensitive, so ordinary function
  // expressions/declarations must stay allowed.
  assert.equal(findUnsafeScriptPattern('const draw = function (root) { return root; };'), null);
  assert.equal(findUnsafeScriptPattern('(function () { return 1; })();'), null);
  assert.equal(findUnsafeScriptPattern('window.renderAnimation = function (root, api) { api.onFrame(() => {}); };'), null);
});

test('findUnsafeScriptPattern detects every disallowed API, including bracket-access variants', () => {
  const cases: Array<{ code: string; label: string }> = [
    { code: 'fetch("https://example.com")', label: 'fetch' },
    { code: 'FETCH("https://example.com")', label: 'fetch' },
    { code: 'new XMLHttpRequest()', label: 'XMLHttpRequest' },
    { code: 'new WebSocket("wss://example.com")', label: 'WebSocket' },
    { code: 'import("./module.js")', label: 'import' },
    { code: 'require("fs")', label: 'require' },
    { code: 'eval("1 + 1")', label: 'eval' },
    { code: 'new Function("return 1")', label: 'new Function' },
    { code: 'Function("return 1")()', label: 'Function constructor' },
    { code: 'const f = Function ("alert(1)")', label: 'Function constructor' },
    { code: 'document.cookie = "a=b"', label: 'document.cookie' },
    { code: 'document["cookie"] = "a=b"', label: 'document.cookie' },
    { code: "document['cookie']", label: 'document.cookie' },
    { code: 'localStorage.getItem("x")', label: 'localStorage' },
    { code: 'sessionStorage.setItem("x", "1")', label: 'sessionStorage' },
    { code: 'indexedDB.open("db")', label: 'indexedDB' },
    { code: 'window.parent.postMessage("x", "*")', label: 'window.parent' },
    { code: 'window["parent"]', label: 'window.parent' },
    { code: "globalThis['parent']", label: 'window.parent' },
    { code: 'self.parent.location', label: 'window.parent' },
    { code: 'window.top.location', label: 'window.top' },
    { code: 'window["top"]', label: 'window.top' },
    { code: 'globalThis.top', label: 'window.top' },
    { code: 'frameElement.remove()', label: 'frameElement' },
  ];
  for (const { code, label } of cases) {
    assert.equal(findUnsafeScriptPattern(code), label, `expected "${code}" to be flagged as "${label}"`);
  }
});

test('findUnsafeScriptPattern returns the first matching label when multiple patterns are present', () => {
  const code = 'fetch("/x"); localStorage.getItem("y");';
  assert.equal(findUnsafeScriptPattern(code), 'fetch');
});

test('findCustomScriptContractIssue accepts code that defines window.renderAnimation and calls api.onFrame', () => {
  assert.equal(findCustomScriptContractIssue(VALID_CONTRACT_CODE), null);
});

test('findCustomScriptContractIssue accepts the bracket-access form of window.renderAnimation', () => {
  const code = `
window["renderAnimation"] = function (root, api) {
  api.onFrame(function () {});
};
`;
  assert.equal(findCustomScriptContractIssue(code), null);
});

test('findCustomScriptContractIssue rejects code missing window.renderAnimation', () => {
  const code = `
function renderAnimation(root, api) {
  api.onFrame(function () {});
}
`;
  const issue = findCustomScriptContractIssue(code);
  assert.ok(issue);
  assert.match(issue as string, /window\.renderAnimation/);
});

test('findCustomScriptContractIssue rejects code that never calls api.onFrame', () => {
  const code = `
window.renderAnimation = function (root, api) {
  root.textContent = 'static, never updates';
};
`;
  const issue = findCustomScriptContractIssue(code);
  assert.ok(issue);
  assert.match(issue as string, /api\.onFrame/);
});

test('findCustomScriptContractIssue reports the renderAnimation issue before the onFrame issue when both are missing', () => {
  const issue = findCustomScriptContractIssue('// completely empty animation');
  assert.match(issue as string, /window\.renderAnimation/);
});

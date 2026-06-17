import test from 'node:test';
import assert from 'node:assert/strict';

import { canUseExecCommandFallback, copyTextToClipboard, copyTextWithExecCommand } from './clipboard';

function createMockDocument(execResult = true) {
  const appended: HTMLTextAreaElement[] = [];
  let execCommandCalledWith: string | null = null;
  const textarea = {
    value: '',
    style: {} as CSSStyleDeclaration,
    setAttribute() {},
    focus() {},
    select() {},
    setSelectionRange() {},
  } as unknown as HTMLTextAreaElement;

  return {
    appended,
    textarea,
    get execCommandCalledWith() {
      return execCommandCalledWith;
    },
    body: {
      appendChild(node: HTMLTextAreaElement) {
        appended.push(node);
      },
      removeChild(node: HTMLTextAreaElement) {
        const index = appended.indexOf(node);
        if (index >= 0) appended.splice(index, 1);
      },
    },
    createElement(tagName: 'textarea') {
      assert.equal(tagName, 'textarea');
      return textarea;
    },
    execCommand(commandId: 'copy') {
      execCommandCalledWith = commandId;
      return execResult;
    },
  };
}

test('copyTextToClipboard uses navigator.clipboard when available', async () => {
  const writes: string[] = [];
  const result = await copyTextToClipboard('raw json', {
    navigator: {
      clipboard: {
        async writeText(text: string) {
          writes.push(text);
        },
      },
    },
  });

  assert.deepEqual(result, { ok: true, method: 'clipboard-api' });
  assert.deepEqual(writes, ['raw json']);
});

test('copyTextToClipboard falls back to execCommand after Clipboard API failure', async () => {
  const doc = createMockDocument(true);
  const result = await copyTextToClipboard('fallback text', {
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error('permission denied');
        },
      },
    },
    document: doc,
  });

  assert.deepEqual(result, { ok: true, method: 'exec-command' });
  assert.equal(doc.textarea.value, 'fallback text');
  assert.equal(doc.execCommandCalledWith, 'copy');
  assert.equal(doc.appended.length, 0);
});

test('copyTextToClipboard reports failure when both paths are unavailable', async () => {
  const result = await copyTextToClipboard('text', {
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error('not allowed');
        },
      },
    },
    document: createMockDocument(false),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'not allowed');
});

test('copyTextWithExecCommand checks fallback availability', () => {
  assert.equal(canUseExecCommandFallback(undefined), false);
  assert.equal(copyTextWithExecCommand('text', undefined), false);
});

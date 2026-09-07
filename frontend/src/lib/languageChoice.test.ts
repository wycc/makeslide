import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLanguageChoice } from './languageChoice';

function fakes() {
  const stored: Array<[string, string]> = [];
  const persisted: Array<Record<string, string>> = [];
  return {
    stored,
    persisted,
    deps: {
      store: (ui: string, content: string) => { stored.push([ui, content]); },
      persist: async (payload: Record<string, string>) => { persisted.push(payload); },
    },
  };
}

test('choosing a language sets both the UI and the content language to it', async () => {
  const f = fakes();
  await applyLanguageChoice('en', f.deps);
  assert.deepEqual(f.stored, [['en', 'en']]);
  await applyLanguageChoice('zh-TW', f.deps);
  assert.deepEqual(f.stored[1], ['zh-TW', 'zh-TW']);
});

test('the choice is written to the account settings, not just this browser', async () => {
  // The settings page copies the server value over localStorage on load, so a local-only
  // switch would flip back the first time the user opened settings.
  const f = fakes();
  const ok = await applyLanguageChoice('en', f.deps);
  assert.equal(ok, true);
  assert.deepEqual(f.persisted, [{ ui_language: 'en', content_language: 'en' }]);
});

test('the local switch happens before the server write, and survives its failure', async () => {
  const order: string[] = [];
  const ok = await applyLanguageChoice('en', {
    store: () => { order.push('store'); },
    persist: async () => { order.push('persist'); throw new Error('offline'); },
  });
  assert.equal(ok, false);
  assert.deepEqual(order, ['store', 'persist']);
});

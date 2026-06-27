import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateTemplate } from './interpolateTemplate';

test('取代單一與多個佔位符', () => {
  assert.equal(interpolateTemplate('Hello {name}', { name: 'Ada' }), 'Hello Ada');
  assert.equal(
    interpolateTemplate('{a} + {b} = {c}', { a: 1, b: 2, c: 3 }),
    '1 + 2 = 3',
  );
});

test('同一佔位符的多處出現皆被取代', () => {
  assert.equal(
    interpolateTemplate('{x}-{x}-{x}', { x: 'z' }),
    'z-z-z',
  );
});

test('數字值以 String() 轉換', () => {
  assert.equal(interpolateTemplate('進度 {progress}%', { progress: 42 }), '進度 42%');
});

test('沒有對應值的佔位符原樣保留', () => {
  assert.equal(interpolateTemplate('Hi {name} {missing}', { name: 'Bo' }), 'Hi Bo {missing}');
});

test('空 values 回傳原模板', () => {
  assert.equal(interpolateTemplate('no placeholders', {}), 'no placeholders');
});

test('與舊內聯 reduce 寫法輸出一致', () => {
  const oldInline = (template: string, values: Record<string, string | number>) =>
    Object.entries(values).reduce(
      (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
      template,
    );
  const tpl = '{title}: {message} ({nextStep})';
  const vals = { title: 'Err', message: 'boom', nextStep: 'retry' };
  assert.equal(interpolateTemplate(tpl, vals), oldInline(tpl, vals));
});

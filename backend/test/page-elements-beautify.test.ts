/**
 * Beautifying a page must never cost the user their work.
 *
 * The point of the feature is that the elements stay elements: a new background goes *under* them
 * and the model is allowed to move and resize, nothing else. So these pin the boundary — what the
 * model may change, what it may not, and what happens to everything it gets wrong or leaves out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  applyElementLayout,
  buildBackgroundPrompt,
  colorLuminance,
  describeElements,
  ensureReadableText,
  readableTextColor,
} from '../src/services/pageElementsBeautify';
import type { PageElement } from '../src/services/pageElements';

const text = (over: Partial<Record<string, unknown>> = {}): PageElement => ({
  id: 't1', x: 0.1, y: 0.1, w: 0.5, h: 0.2, rotation: 0, opacity: 1,
  type: 'text', text: '標題', fontFamily: 'sans', fontSize: 48,
  bold: false, italic: false, underline: false, align: 'left', valign: 'top',
  lineHeight: 1.3, color: '#111111', background: null, padding: 8, borderRadius: 0,
  ...over,
} as PageElement);

const picture = (over: Partial<Record<string, unknown>> = {}): PageElement => ({
  id: 'p1', x: 0.2, y: 0.5, w: 0.3, h: 0.3, rotation: 0, opacity: 1,
  type: 'image', asset: 'asset-abc.png', fit: 'contain', borderRadius: 0,
  ...over,
} as PageElement);

const line = (): PageElement => ({
  id: 'l1', type: 'line', x1: 0.1, y1: 0.9, x2: 0.9, y2: 0.9,
  stroke: '#111111', strokeWidth: 6, arrowStart: false, arrowEnd: true, opacity: 1,
} as PageElement);

test('the model moves and resizes; the words are not its to touch', () => {
  const before = text({ text: '原本的字' });
  const { elements, moved } = applyElementLayout([before, picture()], [
    // A layout answer that also tries to rewrite the page.
    { id: 't1', xPct: 8, yPct: 6, widthPct: 84, heightPct: 18, fontSize: 64, color: '#ffffff', text: '模型改寫的字', type: 'shape', asset: 'other.png' } as never,
    { id: 'p1', xPct: 55, yPct: 40, widthPct: 35, heightPct: 40 },
  ]);
  const after = elements[0] as Extract<PageElement, { type: 'text' }>;
  assert.equal(after.text, '原本的字', '文字內容絕對不能被模型改掉');
  assert.equal(after.type, 'text');
  assert.equal((elements[1] as Extract<PageElement, { type: 'image' }>).asset, 'asset-abc.png', '圖片素材也不能被換掉');
  // What it is allowed to change did change.
  assert.deepEqual({ x: after.x, y: after.y, w: after.w, h: after.h }, { x: 0.08, y: 0.06, w: 0.84, h: 0.18 });
  assert.equal(after.fontSize, 64);
  assert.equal(after.color, '#ffffff');
  assert.deepEqual(moved, ['t1', 'p1']);
});

test('an element the model forgot, or answered nonsense for, keeps what it had', () => {
  const kept = text({ id: 'keep' });
  const { elements, moved } = applyElementLayout([kept, text({ id: 'junk' })], [
    { id: 'junk', xPct: Number.NaN, widthPct: Infinity, fontSize: -20, color: 'javascript:alert(1)' },
    { id: 'nobody', xPct: 10 },
  ]);
  assert.deepEqual(elements[0], kept, '沒被提到的元素原封不動');
  const junk = elements[1] as Extract<PageElement, { type: 'text' }>;
  assert.deepEqual({ x: junk.x, w: junk.w, fontSize: junk.fontSize, color: junk.color }, { x: 0.1, w: 0.5, fontSize: 48, color: '#111111' });
  assert.deepEqual(moved, [], '沒有任何一項合法，就沒有任何東西被動到');
});

test('every box lands inside the slide', () => {
  const { elements } = applyElementLayout([text(), picture()], [
    { id: 't1', xPct: 80, yPct: 95, widthPct: 60, heightPct: 40 },  // hangs off the right and bottom
    { id: 'p1', xPct: -30, yPct: -10, widthPct: 0, heightPct: 0 },  // off the top-left, and sizeless
  ]);
  for (const el of elements) {
    if (el.type === 'line') continue;
    assert.ok(el.x >= 0 && el.y >= 0, `${el.id} 不可以跑到畫布外`);
    assert.ok(el.x + el.w <= 1.0001 && el.y + el.h <= 1.0001, `${el.id} 不可以超出畫布右下`);
    assert.ok(el.w > 0 && el.h > 0, `${el.id} 要留得住、抓得到`);
  }
});

test('lines are left where they were drawn', () => {
  // A line is two points, not a box; re-laying it out from x/y/w/h would move an underline away
  // from the words it underlines.
  const { elements, moved } = applyElementLayout([line()], [{ id: 'l1', xPct: 50, yPct: 20, widthPct: 30, heightPct: 30 }]);
  assert.deepEqual(elements[0], line());
  assert.deepEqual(moved, []);
});

test('text that the new background swallowed is repainted', async () => {
  const dark = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 12, b: 20 } } }).jpeg().toBuffer();
  const [repainted] = await ensureReadableText(dark, [text({ color: '#111111' })]);
  assert.equal((repainted as Extract<PageElement, { type: 'text' }>).color, '#f8fafc', '深底配深字要翻成亮色');

  const light = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 250, g: 250, b: 250 } } }).jpeg().toBuffer();
  const [kept] = await ensureReadableText(light, [text({ color: '#111111' })]);
  assert.equal((kept as Extract<PageElement, { type: 'text' }>).color, '#111111', '本來就看得見就不要亂改');
});

test('the contrast rule itself', () => {
  assert.equal(readableTextColor(20, '#111111'), '#f8fafc');
  assert.equal(readableTextColor(240, '#ffffff'), '#111111');
  assert.equal(readableTextColor(240, '#111111'), '#111111', 'contrasting ink is left alone');
  assert.equal(Math.round(colorLuminance('#ffffff') ?? -1), 255);
  assert.equal(colorLuminance('not a colour'), null);
});

test('the background prompt asks for a backdrop, not a slide', () => {
  const prompt = buildBackgroundPrompt('暖色、手繪感', [text({ text: 'Parameter is a Variable' })]);
  assert.match(prompt, /no text/i, '背景圖一定要求不能有文字，否則會和元素打架');
  assert.match(prompt, /暖色、手繪感/);
  assert.match(prompt, /Parameter is a Variable/, '讓背景切合這一頁的內容');
  // Without an instruction it still has to say something about style.
  assert.match(buildBackgroundPrompt('', [text()]), /Style/);
});

test('the model is told each element by id, with what it says and where it sits', () => {
  const described = describeElements([text({ id: 'abc', text: '第一行\n第二行' }), picture({ id: 'pic' }), line()]);
  assert.match(described, /id "abc"/);
  assert.match(described, /第一行 第二行/, '換行攤平成一行，位置資訊才讀得出來');
  assert.match(described, /id "pic" picture/);
  assert.match(described, /id "l1" line/);
});

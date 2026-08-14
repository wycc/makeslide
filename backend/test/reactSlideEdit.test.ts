import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEMENT_ID_ATTRIBUTE,
  applySlideEdits,
  collectJsxElements,
  ensureElementIds,
  isValidElementId,
} from '../src/services/reactSlideEdit';

const SLIDE = `function Slide() {
  return (
    <div style={{ display: 'flex', padding: '40px' }}>
      <h1 style={{ margin: 0, color: 'var(--slide-fg)' }}>標題</h1>
      <p>內文</p>
      <img src="x.png" />
    </div>
  );
}

window.SlideComponent = Slide;
`;

function idsOf(code: string): string[] {
  return collectJsxElements(code).map((el) => el.id ?? '');
}

/** The id of the nth element in source order, after ids have been assigned. */
function idAt(code: string, index: number): string {
  const id = collectJsxElements(code)[index]?.id;
  assert.ok(id, `element ${index} should have an id`);
  return id;
}

test('every JSX element gets an id, and existing ids are left alone', () => {
  const first = ensureElementIds(SLIDE);
  assert.equal(first.changed, true);
  const ids = idsOf(first.code);
  assert.equal(ids.length, 4, 'div, h1, p, img');
  assert.ok(ids.every((id) => isValidElementId(id)), ids.join(','));
  assert.equal(new Set(ids).size, 4, 'ids must be unique');
  // Idempotent: storing the code again must not churn every id and invalidate pending edits.
  const second = ensureElementIds(first.code);
  assert.equal(second.changed, false);
  assert.deepEqual(idsOf(second.code), ids);
  assert.match(first.code, new RegExp(`${ELEMENT_ID_ATTRIBUTE}="`));
});

test('the rewrite touches only the bytes it changes', () => {
  // The whole point of splicing rather than reprinting: a one-word edit must read as a one-word
  // diff in the version history, and must not reformat code the user wrote by hand.
  const { code } = ensureElementIds(SLIDE);
  const edited = applySlideEdits(code, [{ kind: 'text', id: idAt(code, 1), text: '新標題' }]);
  assert.equal(edited.skipped.length, 0);
  const before = code.split('\n');
  const after = edited.code.split('\n');
  assert.equal(before.length, after.length);
  const changed = before.filter((line, i) => line !== after[i]);
  assert.equal(changed.length, 1, `only the <h1> line should change, got: ${changed.join(' | ')}`);
  assert.match(edited.code, />新標題</);
});

test('text that could be read as markup or as an expression is escaped', () => {
  const { code } = ensureElementIds(SLIDE);
  const edited = applySlideEdits(code, [{ kind: 'text', id: idAt(code, 2), text: 'a < b {x} </p>' }]);
  assert.equal(edited.skipped.length, 0);
  // It must still parse, and must not have introduced an element or an expression container.
  assert.equal(collectJsxElements(edited.code).length, 4);
  assert.ok(!edited.code.includes('a < b {x}'));
});

test('an element containing markup is not text-edited, and says so', () => {
  const source = ensureElementIds(`function Slide() {
  return <div><p>a<b>bold</b></p></div>;
}
window.SlideComponent = Slide;
`).code;
  const target = collectJsxElements(source)[1]!;
  const result = applySlideEdits(source, [{ kind: 'text', id: target.id!, text: 'x' }]);
  assert.equal(result.code, source, 'nothing may be rewritten');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]!.reason, /markup/);
});

test('a style property is added, replaced and removed in place', () => {
  const { code } = ensureElementIds(SLIDE);
  const h1 = idAt(code, 1);
  const added = applySlideEdits(code, [{ kind: 'style', id: h1, property: 'font-size', value: '88px' }]);
  assert.equal(added.skipped.length, 0);
  assert.match(added.code, /fontSize: '88px'/);
  const replaced = applySlideEdits(added.code, [{ kind: 'style', id: h1, property: 'font-size', value: '64px' }]);
  assert.match(replaced.code, /fontSize: '64px'/);
  assert.ok(!replaced.code.includes('88px'));
  const removed = applySlideEdits(replaced.code, [{ kind: 'style', id: h1, property: 'font-size', value: '' }]);
  assert.ok(!removed.code.includes('fontSize'));
  // The neighbouring properties survive, with the object still valid.
  assert.match(removed.code, /margin: 0/);
  assert.match(removed.code, /color: 'var\(--slide-fg\)'/);
  assert.equal(collectJsxElements(removed.code).length, 4);
});

test('an element with no style attribute gets one', () => {
  const { code } = ensureElementIds(SLIDE);
  const result = applySlideEdits(code, [{ kind: 'style', id: idAt(code, 2), property: 'color', value: '#ff3366' }]);
  assert.equal(result.skipped.length, 0);
  assert.match(result.code, /<p[^>]*style=\{\{ color: '#ff3366' \}\}/);
  assert.equal(collectJsxElements(result.code).length, 4);
});

test('a style that is not an inline object is refused rather than half-rewritten', () => {
  // `style={styles.card}` is valid React; editing it would mean rewriting a variable elsewhere.
  const source = ensureElementIds(`function Slide() {
  const styles = { card: { color: 'red' } };
  return <div style={styles.card}>x</div>;
}
window.SlideComponent = Slide;
`).code;
  const target = collectJsxElements(source).find((el) => el.attributes.has('style'))!;
  const result = applySlideEdits(source, [{ kind: 'style', id: target.id!, property: 'color', value: '#fff' }]);
  assert.equal(result.code, source);
  assert.match(result.skipped[0]!.reason, /object literal/);
});

test('unsafe values and unknown properties never reach the source', () => {
  // This is the one place user input becomes code instead of data.
  const { code } = ensureElementIds(SLIDE);
  const h1 = idAt(code, 1);
  const result = applySlideEdits(code, [
    { kind: 'style', id: h1, property: 'color', value: "red'; window.x = 1; '" },
    { kind: 'style', id: h1, property: 'color', value: 'url(http://evil/x.png)' },
    { kind: 'style', id: h1, property: 'behavior', value: 'x' },
  ]);
  assert.equal(result.code, code);
  assert.equal(result.skipped.length, 3);
});

test('deleting an element removes it and the edits inside it', () => {
  const { code } = ensureElementIds(SLIDE);
  const h1 = idAt(code, 1);
  const result = applySlideEdits(code, [
    { kind: 'delete', id: h1 },
    // Same batch: the panel can hold a pending text edit for an element the user then deletes.
    { kind: 'text', id: h1, text: 'ignored' },
  ]);
  assert.equal(result.skipped.length, 0);
  assert.equal(collectJsxElements(result.code).length, 3);
  assert.ok(!result.code.includes('標題'));
  assert.ok(!result.code.includes('ignored'));
  // The rest of the slide is untouched and still parses.
  assert.match(result.code, /<p[^>]*>內文<\/p>/);
});

test('an edit against an element that no longer exists is reported, not applied', () => {
  // After a regeneration the old ids are gone. That is the honest outcome — but the user has to
  // be told, or their change disappears on save with the panel still showing it.
  const { code } = ensureElementIds(SLIDE);
  const result = applySlideEdits(code, [{ kind: 'text', id: 'ZZZZZZZZ', text: 'x' }]);
  assert.equal(result.code, code);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]!.reason, /no longer exists/);
});

test('several edits in one batch are applied against the original offsets', () => {
  // Applied left-to-right, an earlier splice would shift every later offset. This is the case
  // that silently corrupts a file if the ordering is wrong.
  const { code } = ensureElementIds(SLIDE);
  const result = applySlideEdits(code, [
    { kind: 'text', id: idAt(code, 1), text: 'AAAA' },
    { kind: 'text', id: idAt(code, 2), text: 'BBBB' },
    { kind: 'style', id: idAt(code, 0), property: 'padding', value: '10px' },
  ]);
  assert.equal(result.skipped.length, 0);
  assert.match(result.code, />AAAA</);
  assert.match(result.code, />BBBB</);
  assert.match(result.code, /padding: '10px'/);
  assert.equal(collectJsxElements(result.code).length, 4);
});

test('a self-closing element can be styled but not text-edited', () => {
  const { code } = ensureElementIds(SLIDE);
  const img = idAt(code, 3);
  const styled = applySlideEdits(code, [{ kind: 'style', id: img, property: 'opacity', value: '0.5' }]);
  assert.equal(styled.skipped.length, 0);
  assert.match(styled.code, /opacity: '0.5'/);
  const texted = applySlideEdits(code, [{ kind: 'text', id: img, text: 'x' }]);
  assert.equal(texted.code, code);
  assert.match(texted.skipped[0]!.reason, /no children/);
});

test('editing text keeps the surrounding indentation, so the diff stays one line', () => {
  // Real generated slides put children on their own indented lines. Replacing the whole children
  // range would collapse that, and every line after it would show up as changed in the history.
  const source = ensureElementIds(`function Slide() {
  return (
    <div>
      <p style={{ margin: 0 }}>
        原本的內文
      </p>
    </div>
  );
}
window.SlideComponent = Slide;
`).code;
  const p = collectJsxElements(source).find((el) => el.hasOnlyTextChildren)!;
  const edited = applySlideEdits(source, [{ kind: 'text', id: p.id!, text: '新的內文' }]);
  assert.equal(edited.skipped.length, 0);
  const before = source.split('\n');
  const after = edited.code.split('\n');
  assert.equal(before.length, after.length, 'line count must not change');
  assert.equal(before.filter((line, i) => line !== after[i]).length, 1);
  assert.match(edited.code, /^\s{8}新的內文$/m);
});

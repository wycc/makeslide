import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSplitMessages, renderOutline, SPLIT_IMAGE_PROMPT } from '../src/services/pageSplit';

/**
 * Splitting an over-full page — services/pageSplit.ts.
 *
 * The page is re-planned rather than cut: two fresh outlines, from which the normal pipeline
 * regenerates the image, script and audio.
 */

test('the prompt asks for two self-contained pages, not a continuation', () => {
  const messages = buildSplitMessages('Slide 5: Newton\nA\n- B', '逐字稿內容。', 'zh-TW');
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  // A second page that reads as the tail of the first is the failure mode of cutting, which is
  // exactly what this replaced.
  assert.match(system, /自己的標題/);
  assert.match(system, /獨立讀懂/);
  // It must reorganise what is there, not invent around it.
  assert.match(system, /不要加入原本沒有的新知識/);
  // The outline feeds image and script generation next, so bullets are points, not sentences.
  assert.match(system, /重新產生圖片與逐字稿/);
});

test('the prompt carries both the current outline and the transcript', () => {
  const user = buildSplitMessages('Slide 5: Newton', '講稿在這裡。', 'zh-TW').find((m) => m.role === 'user')!.content;
  assert.match(user, /Slide 5: Newton/);
  // The transcript is what the page actually said, which the bullets alone under-describe.
  assert.match(user, /講稿在這裡。/);
});

test('the outline language follows the deck setting, since it is drawn onto the slide', () => {
  assert.match(buildSplitMessages('x', 'y', 'en').find((m) => m.role === 'system')!.content, /英文/);
  assert.match(buildSplitMessages('x', 'y', 'zh-TW').find((m) => m.role === 'system')!.content, /繁體中文/);
});

test('renderOutline writes the same shape the pipeline stores', () => {
  // The page text file is what image and script generation read; a different shape here would be
  // a page the rest of the pipeline does not recognise.
  assert.equal(
    renderOutline(6, { title: 'Adaptive Steps', bullets: ['First point', 'Second point'] }),
    'Slide 6: Adaptive Steps\n- First point\n- Second point',
  );
});

test('the prompt spells out the JSON shape, since json_object mode does not', () => {
  // `callChatJSON` requests `response_format: json_object`, which guarantees valid JSON and nothing
  // about its keys; the zod schema only validates the reply after the fact. A live run failed twice
  // on `first`/`second` being undefined because this was missing.
  const system = buildSplitMessages('x', 'y', 'zh-TW').find((m) => m.role === 'system')!.content;
  assert.match(system, /"first"/);
  assert.match(system, /"second"/);
  assert.match(system, /"title"/);
  assert.match(system, /"bullets"/);
});

test('the image step gets a non-empty instruction that says the page was re-planned', () => {
  // The regenerate job rejects an empty image prompt outright — the first live split failed on
  // exactly that. It also *edits* the existing picture, so the instruction has to say the concepts
  // changed or the old ones stay in the image.
  assert.ok(SPLIT_IMAGE_PROMPT.trim().length > 0);
  assert.match(SPLIT_IMAGE_PROMPT, /re-planned/i);
  assert.match(SPLIT_IMAGE_PROMPT, /remove anything/i);
});

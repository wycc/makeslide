/**
 * A list that builds one line per click.
 *
 * PowerPoint animates a bulleted list by aiming every click at the *same* shape and narrowing it
 * with `p:txEl/p:pRg` to one paragraph. Reading only `@spid` made all six clicks say "shape 159
 * enters", so the shape stayed hidden until the last of them: the reported page rendered six
 * byte-identical frames and then the whole list at once, and the narration was written against
 * steps that showed nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attr, findElements } from '../src/services/pptx/ooxml';
import {
  buildStepSlideXml,
  hiddenParagraphsForStep,
  isFullyBuiltStep,
  parseAnimationSteps,
  parseSlideText,
} from '../src/services/pptx/parsePptx';

/** A title plus one body shape whose three lines appear on three clicks — the reported shape. */
const LINES = ['First line', 'Second line', 'Third line'];
const paragraph = (text: string) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
const clickOnParagraph = (spid: string, index: number) => `
  <p:par><p:cTn presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl>
    <p:spTgt spid="${spid}"><p:txEl><p:pRg st="${index}" end="${index}"/></p:txEl></p:spTgt>
  </p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>`;

const SLIDE = `<p:sld><p:cSld><p:spTree>
  <p:sp><p:nvSpPr><p:cNvPr id="10" name="Title"/></p:nvSpPr><p:txBody>${paragraph('Title')}</p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="159" name="Body"/></p:nvSpPr><p:txBody>${LINES.map(paragraph).join('')}</p:txBody></p:sp>
</p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn nodeType="mainSeq"><p:childTnLst>
  ${LINES.map((_, i) => clickOnParagraph('159', i)).join('')}
</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;

test('each click is read as the paragraph it targets, not as the whole shape', () => {
  const steps = parseAnimationSteps(SLIDE);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.enter), [[], [], []], '整個形狀並沒有在任何一次點擊整個出現');
  assert.deepEqual(steps.map((s) => s.enterParagraphs), [
    [{ spid: '159', paragraphs: [0] }],
    [{ spid: '159', paragraphs: [1] }],
    [{ spid: '159', paragraphs: [2] }],
  ]);
});

test('the words a click reveals are that line, which is what the narration is written from', () => {
  // Before this, a paragraph build revealed no text at all, so every step of it was described to
  // the narration model as 「沒有文字的圖形」.
  assert.deepEqual(parseAnimationSteps(SLIDE).map((s) => s.text), LINES);
});

test('the picture for each step shows the lines reached so far, and no more', () => {
  const steps = parseAnimationSteps(SLIDE);
  const lines = (stepIndex: number) => parseSlideText(buildStepSlideXml(SLIDE, steps, stepIndex));
  assert.deepEqual(lines(0), ['Title'], '還沒點擊時只有標題');
  assert.deepEqual(lines(1), ['Title', 'First line']);
  assert.deepEqual(lines(2), ['Title', 'First line', 'Second line']);
  assert.deepEqual(lines(3), ['Title', ...LINES], '全部點完才是完整的一頁');
});

test('a shape with none of its lines yet is removed, not left as an empty box', () => {
  const steps = parseAnimationSteps(SLIDE);
  const ids = (stepIndex: number) =>
    findElements(buildStepSlideXml(SLIDE, steps, stepIndex), 'p:cNvPr').map((el) => attr(el.attrs, 'id'));
  assert.deepEqual(ids(0), ['10'], '一行都還沒出現的文字框不該留在畫面上');
  assert.deepEqual(ids(1), ['10', '159']);
});

test('the frames really differ — the regression was six identical ones', () => {
  const steps = parseAnimationSteps(SLIDE);
  const frames = [0, 1, 2, 3].map((i) => buildStepSlideXml(SLIDE, steps, i));
  assert.equal(new Set(frames).size, frames.length, '每一步的投影片內容都必須不同');
});

test('a step of a paragraph build is never answered from the file as authored', () => {
  const steps = parseAnimationSteps(SLIDE);
  // Nothing is hidden at *shape* level here, so asking about shapes alone said "use the original"
  // — the finished slide — for every step.
  assert.equal(isFullyBuiltStep(steps, 0), false);
  assert.equal(isFullyBuiltStep(steps, 2), false);
  assert.equal(isFullyBuiltStep(steps, 3), true, '全部點完就是原檔');
  assert.deepEqual([...(hiddenParagraphsForStep(steps, 1).get('159') ?? [])], [1, 2]);
});

test('a range covering several lines reveals them together', () => {
  const slide = SLIDE.replace('<p:pRg st="1" end="1"/>', '<p:pRg st="1" end="2"/>');
  const steps = parseAnimationSteps(slide);
  assert.deepEqual(steps[1]!.enterParagraphs, [{ spid: '159', paragraphs: [1, 2] }]);
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 2)), ['Title', ...LINES]);
});

test('a click that takes lines away puts them back off the slide', () => {
  const slide = SLIDE.replace('presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl>\n    <p:spTgt spid="159"><p:txEl><p:pRg st="2" end="2"/>',
    'presetClass="exit"><p:childTnLst><p:set><p:cBhvr><p:tgtEl>\n    <p:spTgt spid="159"><p:txEl><p:pRg st="0" end="0"/>');
  const steps = parseAnimationSteps(slide);
  assert.deepEqual(steps[2]!.exitParagraphs, [{ spid: '159', paragraphs: [0] }], '離場也要認得段落');
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 3)), ['Title', 'Second line', 'Third line']);
});

test('a whole-shape click still behaves as it always did', () => {
  const slide = SLIDE.replace('<p:txEl><p:pRg st="0" end="0"/></p:txEl>', '');
  const steps = parseAnimationSteps(slide);
  assert.deepEqual(steps[0]!.enter, ['159']);
  assert.deepEqual(steps[0]!.enterParagraphs, []);
});

test('something entered twice appears at the first click, not the last', () => {
  // The general form of the reported bug. "Hide whatever a later click brings in" kept a shape
  // off screen until its *final* entrance effect, which is what made six clicks on one list
  // render as six identical frames.
  const slide = `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="10" name="Title"/></p:nvSpPr><p:txBody>${paragraph('Title')}</p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="20" name="Box"/></p:nvSpPr><p:txBody>${paragraph('Box')}</p:txBody></p:sp>
  </p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn nodeType="mainSeq"><p:childTnLst>
    <p:par><p:cTn presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="20"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
    <p:par><p:cTn presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="20"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
  </p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
  const steps = parseAnimationSteps(slide);
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 0)), ['Title'], '第一次點擊之前還看不到');
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 1)), ['Title', 'Box'], '第一次點擊就要出現');
});

test('something that only leaves is on screen until it does', () => {
  const slide = `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="30" name="Note"/></p:nvSpPr><p:txBody>${paragraph('Note')}</p:txBody></p:sp>
  </p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn nodeType="mainSeq"><p:childTnLst>
    <p:par><p:cTn presetClass="exit"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="30"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
  </p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;
  const steps = parseAnimationSteps(slide);
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 0)), ['Note']);
  assert.deepEqual(parseSlideText(buildStepSlideXml(slide, steps, 1)), [], '點擊之後就不見了');
});

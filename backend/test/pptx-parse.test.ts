import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  attr,
  cutRanges,
  decodeXmlText,
  findElements,
  walkXmlElements,
} from '../src/services/pptx/ooxml';
import {
  buildStepSlideXml,
  parseAnimationSteps,
  parsePptxDeck,
  parseSlideText,
  removeShapes,
  readSlideOrder,
} from '../src/services/pptx/parsePptx';
import { looksLikePptx, openPptx } from '../src/services/pptx/pptxArchive';

// A real deck, committed to the repo: 26 slides, 17 of them with click-built animation.
const here = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = path.resolve(here, '../../docs/computational Graph.pptx');
const hasFixture = fs.existsSync(FIXTURE);
const skipFixture = hasFixture ? false : `fixture missing: ${FIXTURE}`;

// ── the XML scanner ─────────────────────────────────────────────────────────

test('walkXmlElements reports each element once, with the byte range of its whole subtree', () => {
  const xml = '<a><b id="1"><c/></b><b id="2">x</b></a>';
  const seen: string[] = [];
  walkXmlElements(xml, (el) => seen.push(`${el.tag}@${el.depth}:${xml.slice(el.start, el.end)}`));
  assert.deepEqual(seen, [
    'c@2:<c/>',
    'b@1:<b id="1"><c/></b>',
    'b@1:<b id="2">x</b>',
    'a@0:<a><b id="1"><c/></b><b id="2">x</b></a>',
  ]);
});

test("walkXmlElements is not fooled by '>' inside an attribute value, or by comments", () => {
  const xml = '<r><p:sp name="a &gt; b" other=\'x>y\'/><!-- <p:sp id="9"/> --><p:sp/></r>';
  const shapes = findElements(xml, 'p:sp');
  assert.equal(shapes.length, 2, 'the commented-out shape is not an element');
  assert.equal(attr(shapes[0]!.attrs, 'other'), 'x>y');
  assert.equal(decodeXmlText(attr(shapes[0]!.attrs, 'name') ?? ''), 'a > b');
});

test('cutRanges removes whole subtrees and ignores ranges nested inside a removed one', () => {
  const xml = '<r><a><b/></a><c/></r>';
  const a = findElements(xml, 'a')[0]!;
  const b = findElements(xml, 'b')[0]!;
  assert.equal(cutRanges(xml, [a, b]), '<r><c/></r>');
});

// ── animation steps ─────────────────────────────────────────────────────────

const SLIDE_WITH_TWO_CLICKS = `<p:sld><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="10" name="keep"/></p:nvSpPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="11" name="first"/></p:nvSpPr></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="12" name="second"/></p:nvSpPr></p:sp>
</p:spTree></p:cSld><p:timing><p:tnLst><p:par><p:cTn nodeType="tmRoot"><p:childTnLst>
<p:seq><p:cTn nodeType="mainSeq"><p:childTnLst>
  <p:par><p:cTn nodeType="clickEffect" presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="11"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
  <p:par><p:cTn nodeType="clickEffect" presetClass="entr"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="12"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn>
         <p:cTn nodeType="withEffect" presetClass="exit"><p:childTnLst><p:set><p:cBhvr><p:tgtEl><p:spTgt spid="11"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing></p:sld>`;

test('parseAnimationSteps reads one step per click, with entering and exiting shapes', () => {
  const steps = parseAnimationSteps(SLIDE_WITH_TWO_CLICKS);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0], { enter: ['11'], exit: [] });
  // "With previous" effects belong to the click that carries them, not to a step of their own.
  assert.deepEqual(steps[1], { enter: ['12'], exit: ['11'] });
});

test('parseAnimationSteps returns nothing for a slide with no timing', () => {
  assert.deepEqual(parseAnimationSteps('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>'), []);
});

test('buildStepSlideXml shows exactly what has been clicked into view so far', () => {
  const steps = parseAnimationSteps(SLIDE_WITH_TWO_CLICKS);
  const ids = (xml: string) => findElements(xml, 'p:cNvPr').map((el) => attr(el.attrs, 'id'));

  assert.deepEqual(ids(buildStepSlideXml(SLIDE_WITH_TWO_CLICKS, steps, 0)), ['10'], 'before any click');
  assert.deepEqual(ids(buildStepSlideXml(SLIDE_WITH_TWO_CLICKS, steps, 1)), ['10', '11'], 'after the first click');
  // The second click brings 12 in and takes 11 away.
  assert.deepEqual(ids(buildStepSlideXml(SLIDE_WITH_TWO_CLICKS, steps, 2)), ['10', '12'], 'after the second click');
});

test('removeShapes cuts the shape element, not just its cNvPr, and leaves the rest byte-identical', () => {
  const xml = '<p:spTree><p:sp><p:nvSpPr><p:cNvPr id="7"/></p:nvSpPr><p:txBody>gone</p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr>kept</p:pic></p:spTree>';
  const out = removeShapes(xml, new Set(['7']));
  assert.equal(out, '<p:spTree><p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr>kept</p:pic></p:spTree>');
});

test('removeShapes removes a whole group when the group is the target, once', () => {
  const xml = '<p:spTree><p:grpSp><p:nvGrpSpPr><p:cNvPr id="20"/></p:nvGrpSpPr><p:sp><p:nvSpPr><p:cNvPr id="21"/></p:nvSpPr></p:sp></p:grpSp><p:sp><p:nvSpPr><p:cNvPr id="30"/></p:nvSpPr></p:sp></p:spTree>';
  const out = removeShapes(xml, new Set(['20', '21']));
  assert.equal(out, '<p:spTree><p:sp><p:nvSpPr><p:cNvPr id="30"/></p:nvSpPr></p:sp></p:spTree>');
});

// ── text ────────────────────────────────────────────────────────────────────

test('parseSlideText joins the runs of each paragraph and drops empty ones', () => {
  const xml = '<p:txBody><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>world</a:t></a:r></a:p><a:p><a:r><a:t>  </a:t></a:r></a:p><a:p><a:r><a:t>a &amp; b</a:t></a:r></a:p></p:txBody>';
  assert.deepEqual(parseSlideText(xml), ['Hello world', 'a & b']);
});

// ── the real deck ───────────────────────────────────────────────────────────

test('the fixture deck parses into 26 slides in presentation order', { skip: skipFixture }, async () => {
  const archive = await openPptx(FIXTURE);
  assert.equal(await looksLikePptx(FIXTURE), true);
  const order = await readSlideOrder((name) => archive.readText(name));
  assert.equal(order.length, 26);
  assert.equal(order[0], 'ppt/slides/slide1.xml');

  const deck = await parsePptxDeck((name) => archive.readText(name));
  assert.equal(deck.slides.length, 26);
  // 16:9 deck: 9144000 x 5143500 EMU.
  assert.equal(deck.widthEmu / deck.heightEmu > 1.7, true);
  assert.deepEqual(deck.slides[0]!.paragraphs, ['Computational Graph']);

  const animated = deck.slides.filter((s) => s.steps.length > 0);
  assert.equal(animated.length, 17, '17 of the 26 slides are built by clicks');
  const totalFrames = deck.slides.reduce((sum, s) => sum + (s.steps.length ? s.steps.length + 1 : 1), 0);
  assert.equal(totalFrames, 136);
});

test('a real animated slide builds up one shape at a time', { skip: skipFixture }, async () => {
  const archive = await openPptx(FIXTURE);
  const xml = (await archive.readText('ppt/slides/slide3.xml'))!;
  const steps = parseAnimationSteps(xml);
  assert.equal(steps.length, 8);
  assert.deepEqual(steps.map((s) => s.enter), [['112'], ['116'], ['122'], ['128'], ['136'], ['140'], ['141'], ['142']]);

  const shapeCount = (s: string) => findElements(s, 'p:spTree')[0]
    ? findElements(s.slice(findElements(s, 'p:spTree')[0]!.start, findElements(s, 'p:spTree')[0]!.end), 'p:cNvPr').length
    : 0;
  const full = shapeCount(xml);
  const first = shapeCount(buildStepSlideXml(xml, steps, 0));
  const last = shapeCount(buildStepSlideXml(xml, steps, steps.length));
  assert.ok(first < full, 'the pre-click frame has fewer shapes than the finished slide');
  assert.equal(last, full, 'the final step is the slide as authored');
  // Each step adds shapes and never removes any on this slide (all effects are entrances).
  let previous = first;
  for (let k = 1; k <= steps.length; k += 1) {
    const count = shapeCount(buildStepSlideXml(xml, steps, k));
    assert.ok(count > previous, `step ${k} reveals something (${previous} -> ${count})`);
    previous = count;
  }
});

test('a step variant stays a loadable pptx with only the slide changed', { skip: skipFixture }, async () => {
  const archive = await openPptx(FIXTURE);
  const original = (await archive.readText('ppt/slides/slide3.xml'))!;
  const steps = parseAnimationSteps(original);
  const variantXml = buildStepSlideXml(original, steps, 2);
  const buffer = await archive.writeWith(new Map([['ppt/slides/slide3.xml', variantXml]]));

  const rebuilt = await openPptx(buffer);
  assert.equal(await looksLikePptx(buffer), true);
  assert.deepEqual(rebuilt.partNames().sort(), archive.partNames().sort(), 'no part added or lost');
  assert.equal(await rebuilt.readText('ppt/slides/slide3.xml'), variantXml);
  // Every other slide is untouched, byte for byte.
  assert.equal(await rebuilt.readText('ppt/slides/slide4.xml'), await archive.readText('ppt/slides/slide4.xml'));
});

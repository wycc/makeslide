import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openPptx } from '../src/services/pptx/pptxArchive';
import { parsePptxDeck } from '../src/services/pptx/parsePptx';
import { canRenderFromOriginal, checkLibreOffice, LibreOfficeUnavailableError, renderPptxFrames } from '../src/services/pptx/renderFrames';
import { config } from '../src/config';

const here = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = path.resolve(here, '../../docs/computational Graph.pptx');

/**
 * These tests run the real LibreOffice — that is the point: the value of this stage is that the
 * frames come out of the engine that would show the original file, and only an actual render can
 * show that the shape surgery produced a *picture* rather than a valid-but-empty file.
 */
const unavailable = await (async () => {
  if (!fs.existsSync(FIXTURE)) return `fixture missing: ${FIXTURE}`;
  const check = await checkLibreOffice();
  return check.available ? false : `LibreOffice unavailable: ${check.versionOutput || 'not found'}`;
})();

/** How much of the picture is not white — a cheap stand-in for "how much has been drawn". */
async function inkFraction(jpegPath: string): Promise<number> {
  const { data, info } = await sharp(jpegPath).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const value of data) if (value < 200) dark += 1;
  return dark / (info.width * info.height);
}

test('renders a slide build-up: each step draws more than the one before', { skip: unavailable, timeout: 600_000 }, async () => {
  const archive = await openPptx(FIXTURE);
  const deck = await parsePptxDeck((name) => archive.readText(name));
  const slide3 = deck.slides[2]!;
  assert.ok(slide3.steps.length >= 3, 'slide 3 is the animated one this test is about');

  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-frames-test-'));
  try {
    const steps = [0, 3, slide3.steps.length];
    const requests = steps.map((stepIndex) => ({
      slideNumber: 3,
      stepIndex,
      outPath: path.join(outDir, `step-${stepIndex}.jpg`),
    }));
    const progress: number[] = [];
    await renderPptxFrames(FIXTURE, requests, {
      slides: deck.slides,
      width: 1920,
      height: 1080,
      onFrame: (done) => progress.push(done),
    });

    assert.deepEqual(progress, [1, 2, 3], 'progress is reported per frame');
    const inks: number[] = [];
    for (const request of requests) {
      const meta = await sharp(request.outPath).metadata();
      assert.equal(meta.width, 1920);
      assert.equal(meta.height, 1080);
      assert.equal(meta.format, 'jpeg');
      inks.push(await inkFraction(request.outPath));
    }
    // The first frame is the slide before any click: a title and little else.
    assert.ok(inks[0]! > 0, 'the pre-click frame is not blank — the title is already there');
    assert.ok(inks[1]! > inks[0]!, `step 3 draws more than step 0 (${inks[1]} vs ${inks[0]})`);
    assert.ok(inks[2]! > inks[1]!, `the finished slide draws more than step 3 (${inks[2]} vs ${inks[1]})`);
  } finally {
    await fs.promises.rm(outDir, { recursive: true, force: true });
  }
});

test('renders a static slide from the original file, unchanged', { skip: unavailable, timeout: 600_000 }, async () => {
  const archive = await openPptx(FIXTURE);
  const deck = await parsePptxDeck((name) => archive.readText(name));
  const staticSlide = deck.slides.find((s) => s.steps.length === 0);
  assert.ok(staticSlide, 'the deck has static slides');

  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-frames-static-'));
  try {
    const outPath = path.join(outDir, 'static.jpg');
    await renderPptxFrames(
      FIXTURE,
      [{ slideNumber: staticSlide!.slideNumber, stepIndex: 0, outPath }],
      { slides: deck.slides, width: 1920, height: 1080 },
    );
    const meta = await sharp(outPath).metadata();
    assert.equal(meta.width, 1920);
    assert.equal(meta.height, 1080);
    assert.ok((await inkFraction(outPath)) > 0.0005, 'the slide actually has something on it');
    // Nothing is left behind next to the output.
    assert.deepEqual(await fs.promises.readdir(outDir), ['static.jpg']);
  } finally {
    await fs.promises.rm(outDir, { recursive: true, force: true });
  }
});

test('a frame is taken from the original only when that frame hides nothing', () => {
  const noExit = { slideNumber: 1, partName: 'p1', paragraphs: [], notes: '', steps: [
    { enter: ['10'], exit: [], text: 'a' },
    { enter: ['11'], exit: [], text: 'b' },
  ] };
  const withExit = { slideNumber: 2, partName: 'p2', paragraphs: [], notes: '', steps: [
    { enter: ['20'], exit: [], text: 'a' },
    { enter: ['21'], exit: ['20'], text: 'b' },
  ] };
  const staticSlide = { slideNumber: 3, partName: 'p3', paragraphs: [], notes: '', steps: [] };

  assert.equal(canRenderFromOriginal(staticSlide, 0), true, 'a static slide is the original');
  assert.equal(canRenderFromOriginal(noExit, 0), false, 'an intermediate step needs a variant');
  assert.equal(canRenderFromOriginal(noExit, 1), false);
  assert.equal(canRenderFromOriginal(noExit, 2), true, 'built up with no exits = the file as authored');
  // The regression: this slide's built-up state is NOT the file as authored, because the file
  // still contains shape 20, which the second click took off the screen. Rendering it from the
  // original drew 20 back on top of the final state, and the real final state was never produced.
  assert.equal(canRenderFromOriginal(withExit, 2), false, 'an exit effect means the last frame differs');
  assert.equal(canRenderFromOriginal(undefined, 0), true, 'an unknown slide is rendered as given');
});

test(
  'the built-up frame of a slide with an exit effect draws less than the file as authored',
  { skip: unavailable, timeout: 600_000 },
  async () => {
    // Slide 10 of the fixture hides two text groups as it builds (each click replaces the last
    // one's caption). Its finished state therefore has *less* on it than the static file, and this
    // is the assertion that fails when the frame is taken from the original: the departed captions
    // come back, overlapping the final one.
    const archive = await openPptx(FIXTURE);
    const deck = await parsePptxDeck((name) => archive.readText(name));
    const slide = deck.slides.find((s) => s.steps.some((step) => step.exit.length > 0));
    assert.ok(slide, 'the fixture has a slide with an exit effect');
    const stepCount = slide!.steps.length;

    const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-frames-exit-'));
    try {
      const built = path.join(outDir, 'built.jpg');
      await renderPptxFrames(FIXTURE, [{ slideNumber: slide!.slideNumber, stepIndex: stepCount, outPath: built }], {
        slides: deck.slides,
        width: 1920,
        height: 1080,
      });
      // The same slide as the file has it: every shape, including the ones that exited.
      const asAuthored = path.join(outDir, 'as-authored.jpg');
      await renderPptxFrames(FIXTURE, [{ slideNumber: slide!.slideNumber, stepIndex: 0, outPath: asAuthored }], {
        slides: deck.slides.map((s) => (s === slide ? { ...s, steps: [] } : s)),
        width: 1920,
        height: 1080,
      });

      const builtInk = await inkFraction(built);
      const authoredInk = await inkFraction(asAuthored);
      assert.ok(builtInk > 0, 'the built-up frame is not blank');
      assert.ok(
        builtInk < authoredInk,
        `the built-up frame must not contain the exited shapes (built ${builtInk} vs as-authored ${authoredInk})`,
      );
    } finally {
      await fs.promises.rm(outDir, { recursive: true, force: true });
    }
  },
);

test('a missing renderer fails loudly instead of producing blanks', async () => {
  const outDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-frames-missing-'));
  const previous = config.libreOfficeBin;
  try {
    (config as { libreOfficeBin: string }).libreOfficeBin = path.join(outDir, 'no-such-soffice');
    await assert.rejects(
      renderPptxFrames(FIXTURE, [{ slideNumber: 1, stepIndex: 0, outPath: path.join(outDir, 'x.jpg') }], {
        slides: [{ slideNumber: 1, partName: 'ppt/slides/slide1.xml', steps: [], paragraphs: [], notes: '' }],
        width: 1920,
        height: 1080,
      }),
      (err: unknown) => err instanceof LibreOfficeUnavailableError,
      'the import refuses up front rather than writing empty pages',
    );
    assert.deepEqual(await fs.promises.readdir(outDir), [], 'and it wrote nothing at all');
  } finally {
    (config as { libreOfficeBin: string }).libreOfficeBin = previous;
    await fs.promises.rm(outDir, { recursive: true, force: true });
  }
});

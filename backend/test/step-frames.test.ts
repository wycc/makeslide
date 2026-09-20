/**
 * What the narration model is shown about a built slide's steps.
 *
 * Reported on a page whose every step revealed a picture: the prompt could only say
 * 「畫面新出現『沒有文字的圖形』」— the same empty line seven times — so the narration was written
 * from the slide's static text and paced into chunks that had nothing to do with the build. One
 * step there *removed* the two vectors the previous steps had added, and the line for it talked
 * about taking a logarithm.
 *
 * These pin the two things the fix depends on: finding the region that changed, and telling
 * "something appeared" apart from "something was taken away".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { frameChange, stepFramePictures, stepPictureCaption } from '../src/services/pptx/stepFrames';

const W = 800;
const H = 450;
/** A white page with black rectangles on it — a slide, as far as a pixel diff is concerned. */
async function frame(boxes: Array<{ x: number; y: number; w: number; h: number }>): Promise<Buffer> {
  const rects = boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#111"/>`).join('');
  return sharp(Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${rects}</svg>`))
    .png()
    .toBuffer();
}

const TITLE = { x: 40, y: 30, w: 300, h: 40 };
const VECTOR = { x: 560, y: 200, w: 80, h: 160 };

test('a step that adds something is found, and called an addition', async () => {
  const change = await frameChange(await frame([TITLE]), await frame([TITLE, VECTOR]));
  assert.equal(change.kind, 'added');
  assert.ok(change.box, '要找得到變化區域');
  // The box covers the new rectangle (with a little padding) and not the whole page.
  assert.ok(change.box.left <= VECTOR.x && change.box.top <= VECTOR.y);
  assert.ok(change.box.left + change.box.width >= VECTOR.x + VECTOR.w);
  assert.ok(change.box.width < W / 2, `裁切區不該是整頁，實際寬 ${change.box.width}`);
});

test('a step that takes something away is called a removal', async () => {
  // The regression itself: on the reported page this is step 4, and the narration for it was
  // written as if the page were still building up.
  const change = await frameChange(await frame([TITLE, VECTOR]), await frame([TITLE]));
  assert.equal(change.kind, 'removed', '收起來和加上去必須分得出來');
  assert.ok(change.box);
});

test('frames that are the same, or barely different, are not a step worth a picture', async () => {
  const same = await frameChange(await frame([TITLE]), await frame([TITLE]));
  assert.deepEqual(same, { box: null, kind: 'none' });
  // A few stray pixels (compression noise, an anti-aliased edge) must not read as a change.
  const speck = await frameChange(await frame([TITLE]), await frame([TITLE, { x: 700, y: 400, w: 2, h: 2 }]));
  assert.equal(speck.kind, 'none');
});

test('frames of different sizes are not compared at all', async () => {
  const small = await sharp(await frame([TITLE])).resize({ width: 400 }).png().toBuffer();
  assert.deepEqual(await frameChange(await frame([TITLE]), small), { box: null, kind: 'none' });
});

test('the page is sent as the first frame whole, then one crop per change', async () => {
  const frames = [
    await frame([TITLE]),
    await frame([TITLE, VECTOR]),
    await frame([TITLE, VECTOR]),                                   // nothing happened
    await frame([TITLE]),                                            // the vector goes away
    await frame([TITLE, { x: 100, y: 300, w: 200, h: 60 }]),   // a different shape appears
  ];
  const pictures = await stepFramePictures(frames);
  assert.deepEqual(pictures.map((p) => [p.step, p.role]), [[1, 'full'], [2, 'added'], [4, 'removed'], [5, 'added']]);
  // The first picture is the whole slide; the crops are smaller than it.
  const full = await sharp(pictures[0]!.jpeg).metadata();
  const crop = await sharp(pictures[1]!.jpeg).metadata();
  assert.ok((crop.width ?? 0) * (crop.height ?? 0) < (full.width ?? 0) * (full.height ?? 0) / 2, '變化裁切圖要比整頁小很多');
  // A step with no picture is simply absent, so the caller can say so in words instead.
  assert.ok(!pictures.some((p) => p.step === 3));
});

test('a page with no usable frames asks for nothing', async () => {
  assert.deepEqual(await stepFramePictures([null, null]), []);
  assert.deepEqual(await stepFramePictures([]), []);
  // A frame that will not decode must not take the page's narration down with it.
  assert.deepEqual(await stepFramePictures([Buffer.from('not an image')]), []);
  const withBadStep = await stepFramePictures([await frame([TITLE]), Buffer.from('not an image')]);
  assert.deepEqual(withBadStep.map((p) => p.step), [1]);
});

test('the number of pictures is capped however long the page is', async () => {
  const frames = [await frame([TITLE])];
  for (let i = 0; i < 20; i++) frames.push(await frame([TITLE, { x: 40 + i * 30, y: 200, w: 20, h: 20 }]));
  const pictures = await stepFramePictures(frames, { maxPictures: 5 });
  assert.equal(pictures.length, 5);
});

test('each picture says what it is', () => {
  assert.match(stepPictureCaption({ step: 1, jpeg: Buffer.alloc(0), role: 'full' }), /第 1 步.*完整畫面/);
  assert.match(stepPictureCaption({ step: 4, jpeg: Buffer.alloc(0), role: 'removed' }), /收起來/);
  assert.match(stepPictureCaption({ step: 2, jpeg: Buffer.alloc(0), role: 'added' }), /新出現/);
});

/**
 * The wiring: the pictures have to reach the model, and their absence must not break the page.
 */
test('the narration call carries the pictures, and falls back to words without them', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('../src/services/pptx/stepNarration.ts', import.meta.url)), 'utf8');
  assert.match(src, /const pictures = await readStepPictures\(input\.pdfId, input\.pageUid\)/);
  assert.match(src, /type: 'image_url'/, '圖片要真的送進訊息裡');
  assert.match(src, /stepPictureCaption\(picture\)/, '每張圖要有說明這是第幾步、是新增還是收起');
  // Without pictures the message stays a plain string, exactly as before.
  assert.match(src, /pictures\.length === 0\s*\n?\s*\? userParts\.join\('\\n'\)/);
  // The empty placeholder is only used when this step really has no picture to show.
  assert.match(src, /pictures\.some\(\(picture\) => picture\.step === index \+ 2\)\s*\n\s*\? `第 \$\{index \+ 2\} 步：畫面有變化（見附圖）`/);
  // And the model is told how to read them.
  assert.match(src, /第一張是投影片一開始的完整樣子/);
  assert.match(src, /收起來/);
});

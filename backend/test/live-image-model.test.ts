import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { toFile } from 'openai';
import { config } from '../src/config';
import { getImageClient, getOpenAIClient, type ImageGenerationTarget } from '../src/services/openai';

// Live smoke test for the configured image model (OPENAI_IMAGE_MODEL). It sends real, billed
// requests, so it is skipped unless explicitly asked for:
//
//   MAKESLIDE_LIVE_IMAGE_TEST=1 MAKESLIDE_LIVE_IMAGE_ACCOUNT=<account id> \
//     MAKESLIDE_TEST=1 npx tsx --test test/live-image-model.test.ts
//
// The account decides which key and which provider the requests go through — the same routing
// (getImageClient) slide generation uses, so a pass here means that account can generate images.
// MAKESLIDE_LIVE_IMAGE_PROVIDER=openai bypasses that routing and calls OpenAI with the account's
// OpenAI key, to tell a model problem apart from a problem with the routed provider.
const LIVE = process.env.MAKESLIDE_LIVE_IMAGE_TEST === '1';
const ACCOUNT_ID = process.env.MAKESLIDE_LIVE_IMAGE_ACCOUNT?.trim() || 'default';
const FORCE_OPENAI = process.env.MAKESLIDE_LIVE_IMAGE_PROVIDER?.trim() === 'openai';
const TIMEOUT_MS = 180_000;
const skip = LIVE ? false : 'set MAKESLIDE_LIVE_IMAGE_TEST=1 to call the real image API';

function imageTarget(): ImageGenerationTarget {
  if (FORCE_OPENAI) {
    return { client: getOpenAIClient(ACCOUNT_ID, 'openai'), model: config.openaiImageModel, provider: 'openai' };
  }
  return getImageClient(ACCOUNT_ID);
}

function describeTarget(): string {
  const { model, provider } = imageTarget();
  return `account=${ACCOUNT_ID} provider=${provider} model=${model} (OPENAI_IMAGE_MODEL=${config.openaiImageModel})`;
}

async function expectImage(b64: string | undefined): Promise<void> {
  assert.ok(b64, 'response carried no b64_json image');
  const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
  assert.equal(meta.width, 1536);
  assert.equal(meta.height, 1024);
}

// Kept across the two cases: the edit case reuses the generated picture as its source image.
let generated: Buffer | null = null;

test('image model generates a 1536x1024 slide image', { skip, timeout: TIMEOUT_MS }, async (t) => {
  t.diagnostic(describeTarget());
  const { client, model } = imageTarget();
  const res = await client.images.generate(
    {
      model,
      prompt: 'A clean presentation slide background: soft blue gradient with a small sun icon in the corner, no text.',
      size: '1536x1024',
      quality: 'low',
    },
    { timeout: TIMEOUT_MS },
  );
  const b64 = res.data?.[0]?.b64_json;
  await expectImage(b64);
  generated = Buffer.from(b64!, 'base64');
});

test('image model edits a slide image inside a mask (inpaint path)', { skip, timeout: TIMEOUT_MS }, async (t) => {
  t.diagnostic(describeTarget());
  const { client, model } = imageTarget();
  const source = generated
    ?? await sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toBuffer();
  // Same convention as the inpaint route: transparent = area to change, opaque = keep.
  const hole = await sharp({ create: { width: 512, height: 384, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
  const mask = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: hole, left: 512, top: 320 }])
    .png()
    .toBuffer();
  const res = await client.images.edit(
    {
      model,
      image: await toFile(source, 'slide.png', { type: 'image/png' }),
      mask: await toFile(mask, 'mask.png', { type: 'image/png' }),
      prompt: 'Draw a small red circle in the masked area.',
      size: '1536x1024',
      quality: 'low',
    },
    { timeout: TIMEOUT_MS },
  );
  await expectImage(res.data?.[0]?.b64_json);
});

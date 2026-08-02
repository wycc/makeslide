import fs from 'node:fs';
import sharp from 'sharp';
import { pageImagePath, pageScriptPath, pageTextPath } from './storage';
import { generatePageThumbnail } from './thumbnails';

/** Slide canvas size for generated blank pages — 16:9, matching the rendered decks. */
const BLANK_PAGE_WIDTH = 1920;
const BLANK_PAGE_HEIGHT = 1080;

/**
 * Write the on-disk assets of one blank slide: a white 16:9 image (plus its thumbnail) and
 * empty text/script files.
 *
 * Shared by "insert a blank slide into this deck" and "create a blank deck", so the two cannot
 * drift into producing differently-shaped pages — a page whose files are missing renders as a
 * broken slide rather than an empty one.
 */
export async function writeBlankPageAssets(pdfId: string, pageUid: string): Promise<void> {
  const imagePath = pageImagePath(pdfId, pageUid);
  await sharp({
    create: {
      width: BLANK_PAGE_WIDTH,
      height: BLANK_PAGE_HEIGHT,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(imagePath);
  await generatePageThumbnail(pdfId, pageUid, imagePath);
  await fs.promises.writeFile(pageTextPath(pdfId, pageUid), '', 'utf8');
  await fs.promises.writeFile(pageScriptPath(pdfId, pageUid), '', 'utf8');
}

/** The `pages` row columns a blank slide uses, so both callers store identical paths. */
export function blankPageRowPaths(pageUid: string): {
  image_path: string;
  text_path: string;
  script_path: string;
  audio_path: string;
} {
  return {
    image_path: `pages/${pageUid}.jpg`,
    text_path: `pages/${pageUid}.text.txt`,
    script_path: `pages/${pageUid}.script.txt`,
    audio_path: `pages/${pageUid}.m4a`,
  };
}

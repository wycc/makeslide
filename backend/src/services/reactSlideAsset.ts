import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { pagesDir } from './storage';

/**
 * Images a user adds to a React slide page — see docs/page-overlay-and-fusion.md §4.2.
 *
 * A picture cannot live in the code the way inserted text does: the code has a 60000-character
 * cap and one base64 image blows past it. So the image is a file and the code holds a reference
 * to it, resolved at render time by a global the sandbox and the bake document each define:
 *
 * ```jsx
 * <img data-ms-id="…" src={MS_ASSET("asset-a1b2c3d4.png")} style={{ … }} />
 * ```
 *
 * Storing the name rather than a URL is what keeps the code independent of where the deck is
 * served from — an absolute URL would break the moment the deck moved to another host, or was
 * exported and imported somewhere else. The sandbox turns the name into a URL, the bake document
 * turns it into a `data:` URL, because baking has no origin to resolve against and no session to
 * authenticate a fetch with (the same reason the background image is inlined there).
 */

/** Extensions we accept, and the sharp format each must actually decode as. */
const ALLOWED_FORMATS: Record<string, readonly string[]> = {
  png: ['png'],
  jpg: ['jpeg'],
  jpeg: ['jpeg'],
  webp: ['webp'],
  gif: ['gif'],
};

/**
 * Asset names are ours, so they are checked before ever reaching the filesystem or the source.
 *
 * Deliberately not a general filename pattern: this is the only shape we generate, so anything
 * else is either a mistake or an attempt at traversal, and both should 404 rather than be
 * normalised into something that might resolve.
 */
const ASSET_NAME_RE = /^asset-[A-Za-z0-9_-]{1,32}\.(png|jpe?g|webp|gif)$/;

const ID_LENGTH = 8;

/** Uploads bigger than this are refused: a slide overlay is a logo or a diagram, not a photo library. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export function isValidAssetName(name: string): boolean {
  return ASSET_NAME_RE.test(name);
}

/**
 * Absolute path of one page asset, or null when the name is not one of ours.
 *
 * Returning null rather than throwing lets every caller answer a bad name with a 404, which is
 * what it is: there is no such asset.
 */
export function pageAssetPath(pdfId: string, pageUid: string, name: string): string | null {
  if (!isValidAssetName(name)) return null;
  return path.join(pagesDir(pdfId), `${pageUid}.${name}`);
}

/** Every asset belonging to this page, by name. Missing directory means no assets, not an error. */
export function listPageAssets(pdfId: string, pageUid: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(pagesDir(pdfId));
  } catch {
    return [];
  }
  const prefix = `${pageUid}.`;
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const name = entry.slice(prefix.length);
    if (isValidAssetName(name)) names.push(name);
  }
  return names.sort();
}

export interface StoredAsset {
  name: string;
  bytes: number;
  width: number;
  height: number;
}

export class InvalidAssetError extends Error {}

/**
 * Validate an uploaded image and store it as a page asset.
 *
 * The extension is not evidence of anything, so the buffer is decoded with sharp and the format it
 * actually is must match what the extension claims. SVG is refused outright even though sharp
 * reads it: an SVG is a document that can carry script, and this file is loaded by the sandbox as
 * an `<img>` — accepting one would be handing the page an execution path that the code deny-list
 * never sees.
 */
export async function storePageAsset(
  pdfId: string,
  pageUid: string,
  buffer: Buffer,
  fileName: string,
): Promise<StoredAsset> {
  if (buffer.length === 0) throw new InvalidAssetError('圖片是空的');
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new InvalidAssetError(`圖片超過 ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB 上限`);
  }
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const expected = ALLOWED_FORMATS[ext];
  if (!expected) {
    throw new InvalidAssetError('只接受 PNG／JPEG／WebP／GIF 圖片');
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new InvalidAssetError('這個檔案不是可以讀取的圖片');
  }
  if (!meta.format || !expected.includes(meta.format)) {
    throw new InvalidAssetError('檔案內容與副檔名不符');
  }
  if (!meta.width || !meta.height) {
    throw new InvalidAssetError('這個檔案不是可以讀取的圖片');
  }
  const name = `asset-${nanoid(ID_LENGTH)}.${ext === 'jpeg' ? 'jpg' : ext}`;
  const target = pageAssetPath(pdfId, pageUid, name);
  if (!target) throw new InvalidAssetError('無法產生素材檔名');
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, buffer);
  return { name, bytes: buffer.length, width: meta.width, height: meta.height };
}

/** MIME type for an asset name that has already passed `isValidAssetName`. */
export function assetMimeType(name: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/**
 * `{ name: data-url }` for every asset of this page, for the bake document.
 *
 * An asset that cannot be read is left out rather than failing the bake: a missing picture is a
 * gap in one slide, while a thrown error is no exported deck at all.
 */
export async function pageAssetDataUrls(pdfId: string, pageUid: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const name of listPageAssets(pdfId, pageUid)) {
    const file = pageAssetPath(pdfId, pageUid, name);
    if (!file) continue;
    try {
      const buffer = await fs.promises.readFile(file);
      map[name] = `data:${assetMimeType(name)};base64,${buffer.toString('base64')}`;
    } catch {
      // skip — see doc comment
    }
  }
  return map;
}

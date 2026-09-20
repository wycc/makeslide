/**
 * Showing the narration model what each step of a built slide actually puts on screen.
 *
 * Until this existed the model was told, for every step that revealed a picture,
 * 「畫面新出現「沒有文字的圖形（例如箭頭、方框或連線）」」 — the same contentless line for every
 * step, because the only channel was the *text* a step revealed and a slide built out of equation
 * images reveals no text at all. On one reported page all seven reveals produced that identical
 * line, so the narration was written from the slide's static text and paced into N chunks: a
 * coherent lecture that had nothing to do with the order things appeared in.
 *
 * The frames were on disk the whole time (the import renders one per step before narration runs).
 * Rather than send every full frame, this sends the first one whole — the slide as the student
 * first sees it — and then, for each step, only the region that changed. That is the answer to
 * "what happens at this step", it is a fraction of the pixels, and it is the one way to see that a
 * step *removed* something, which a list of what is on screen cannot express.
 */
import sharp from 'sharp';

export interface FrameChange {
  /** The changed region in the frame's own pixels; null when the step changed nothing visible. */
  box: { left: number; top: number; width: number; height: number } | null;
  /** What the change did: something appeared, something went away, or both at once. */
  kind: 'added' | 'removed' | 'replaced' | 'none';
}

/** Pixels this far apart (0–255, per channel) count as the same; JPEG/WebP noise is not a change. */
const SAME_PIXEL_TOLERANCE = 24;
/** A change smaller than this fraction of the page is noise (an anti-aliased edge, a stray dot). */
const MIN_CHANGE_FRACTION = 0.00002;
/** Grown by this fraction of the page so the crop carries a little context around the change. */
const CROP_PADDING_FRACTION = 0.012;

/** Whether a pixel is clearly darker than paper. */
function isInk(data: Buffer, index: number): boolean {
  return (data[index]! + data[index + 1]! + data[index + 2]!) / 3 < 235;
}

/**
 * What changed between two frames of the same slide.
 *
 * Both frames come from the same render at the same size; a size mismatch means the pair cannot be
 * compared and is reported as "no change" rather than guessed at.
 */
export async function frameChange(previous: Buffer, next: Buffer): Promise<FrameChange> {
  const a = await sharp(previous).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(next).raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) {
    return { box: null, kind: 'none' };
  }
  const { width, height, channels } = a.info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (
        Math.abs(a.data[i]! - b.data[i]!) <= SAME_PIXEL_TOLERANCE
        && Math.abs(a.data[i + 1]! - b.data[i + 1]!) <= SAME_PIXEL_TOLERANCE
        && Math.abs(a.data[i + 2]! - b.data[i + 2]!) <= SAME_PIXEL_TOLERANCE
      ) continue;
      changed++;
      // Classified per changed pixel, not over the region: a step that takes one vector off a
      // slide changes a box that is mostly unchanged formula, and averaging over the box hides
      // the removal behind all the ink that stayed put.
      const wasInk = isInk(a.data, i);
      const isNowInk = isInk(b.data, i);
      if (!wasInk && isNowInk) added++;
      else if (wasInk && !isNowInk) removed++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0 || changed / (width * height) < MIN_CHANGE_FRACTION) return { box: null, kind: 'none' };

  const pad = Math.round(Math.min(width, height) * CROP_PADDING_FRACTION);
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const box = {
    left,
    top,
    width: Math.min(width - left, maxX - minX + 1 + pad * 2),
    height: Math.min(height - top, maxY - minY + 1 + pad * 2),
  };
  // A step that takes the previous step's vectors back off the slide is mostly ink turning to
  // paper; one that adds a matrix is the reverse. Both happen on the same page, and they mean
  // opposite things to a narration meant to follow the build.
  const kind: FrameChange['kind'] = added > removed * 2 ? 'added' : removed > added * 2 ? 'removed' : 'replaced';
  return { box, kind };
}

export interface StepFramePicture {
  /** 1-based step this picture belongs to. */
  step: number;
  /** JPEG bytes: the whole first frame, or the changed region of a later one. */
  jpeg: Buffer;
  /** Whole frame or a crop, and for a crop what the change did. */
  role: 'full' | FrameChange['kind'];
}

export interface StepFramePicturesOptions {
  /** Longest edge of the first frame; it has to stay readable (formulas, code). */
  fullWidth?: number;
  /** Longest edge of a change crop. Crops are small, so this is rarely the binding constraint. */
  cropWidth?: number;
  /** Never send more than this many pictures, however many steps the page has. */
  maxPictures?: number;
}

/**
 * The pictures to attach for one page: the first frame whole, then each step's change.
 *
 * A step whose frame is missing, unreadable or visually identical to the one before contributes no
 * picture — the caller says so in words instead, which is better than an image that says nothing.
 */
export async function stepFramePictures(
  frames: Array<Buffer | null>,
  options: StepFramePicturesOptions = {},
): Promise<StepFramePicture[]> {
  const fullWidth = options.fullWidth ?? 1280;
  const cropWidth = options.cropWidth ?? 768;
  const maxPictures = options.maxPictures ?? 12;
  const out: StepFramePicture[] = [];
  const first = frames[0];
  if (!first) return out;
  try {
    out.push({
      step: 1,
      jpeg: await sharp(first).resize({ width: fullWidth, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
      role: 'full',
    });
  } catch {
    return out;
  }
  for (let i = 1; i < frames.length && out.length < maxPictures; i++) {
    const previous = frames[i - 1];
    const current = frames[i];
    if (!previous || !current) continue;
    try {
      const change = await frameChange(previous, current);
      if (!change.box) continue;
      out.push({
        step: i + 1,
        jpeg: await sharp(current)
          .extract(change.box)
          .resize({ width: cropWidth, withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer(),
        role: change.kind,
      });
    } catch {
      // A frame that will not decode is not worth failing the page's narration over.
    }
  }
  return out;
}

/** How a picture is introduced to the model, so it knows what it is looking at. */
export function stepPictureCaption(picture: StepFramePicture): string {
  if (picture.role === 'full') return `第 ${picture.step} 步：投影片一開始的完整畫面`;
  if (picture.role === 'removed') return `第 ${picture.step} 步：這一塊從畫面上「收起來」了（下圖是收起來之後的樣子）`;
  if (picture.role === 'replaced') return `第 ${picture.step} 步：這一塊變了（下圖是變化後的樣子）`;
  return `第 ${picture.step} 步：畫面新出現這一塊`;
}

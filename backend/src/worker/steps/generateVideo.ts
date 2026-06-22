import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { db } from '../../db';
import { logger } from '../../logger';
import { pageAudioPath, pageImagePath, videoPath } from '../../services/storage';
import { runCommand } from '../poppler';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

/** Rounds up to the nearest even number, never below 2 (libx264 requires even width/height). */
export function evenCeil(n: number): number {
  return Math.max(2, Math.ceil(n / 2) * 2);
}

/**
 * Scales an input frame down (never up) to fit within `width`x`height` preserving aspect ratio,
 * then letterboxes/pillarboxes it to exactly that size. Every page segment uses the same target
 * size (derived from the first usable page) so the final `-c copy` concat produces a single
 * consistent video instead of one with mismatched per-segment resolutions — source pages can
 * legitimately differ in pixel dimensions (e.g. a source PDF mixing portrait and landscape
 * slides), since each page's image is rendered independently at the PDF's own page size.
 */
export function buildScaleAndPadFilter(width: number, height: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
}

// poppler.ts's runCommand() supports a timeoutMs option (kills the process with SIGKILL and
// rejects instead of hanging forever), but it only takes effect if a caller passes it — without
// these, a single page whose ffmpeg encode gets stuck (e.g. on a malformed image) blocks the
// whole video-generation job indefinitely.
const SEGMENT_FFMPEG_TIMEOUT_MS = 5 * 60_000;
const CONCAT_FFMPEG_TIMEOUT_MS = 5 * 60_000;

export interface GenerateVideoInput {
  pdfId: string;
  pageCount: number;
  pageNumbers: number[];
  onProgress?: (current: number, total: number) => Promise<void> | void;
}

export interface GenerateVideoResult {
  outputPath: string;
}

// Two concurrent generateVideo() calls for the SAME pdfId both run ffmpeg processes that
// independently `-y` (overwrite) the exact same output path (videoPath(pdfId)) at the end of
// their pipeline. Verified with real ffmpeg binaries: when two ffmpeg processes race to write
// the same output file path concurrently, the result is not simply "last writer wins" — it can
// be a genuinely corrupted file (interleaved writes producing invalid NAL units that fail to
// decode). This in-memory lock makes a second concurrent call for a pdfId already in progress
// fail fast with a recognizable error instead of racing on disk I/O. Calls for different pdfIds
// are unaffected and run fully in parallel as before.
const inFlightPdfIds = new Set<string>();

export async function generateVideo(
  input: GenerateVideoInput,
): Promise<GenerateVideoResult> {
  const { pdfId, pageNumbers, onProgress } = input;
  if (pageNumbers.length === 0) {
    throw new Error('No pages available for video rendering');
  }
  if (inFlightPdfIds.has(pdfId)) {
    const err = new Error('VIDEO_GENERATION_ALREADY_RUNNING');
    (err as Error & { code?: string }).code = 'VIDEO_GENERATION_ALREADY_RUNNING';
    throw err;
  }
  inFlightPdfIds.add(pdfId);
  try {
    return await generateVideoLocked(pdfId, pageNumbers, onProgress);
  } finally {
    inFlightPdfIds.delete(pdfId);
  }
}

async function generateVideoLocked(
  pdfId: string,
  pageNumbers: number[],
  onProgress: GenerateVideoInput['onProgress'],
): Promise<GenerateVideoResult> {
  const pageUidRows = db
    .prepare(`SELECT page_number, page_uid FROM pages WHERE pdf_id = ?`)
    .all(pdfId) as Array<{ page_number: number; page_uid: string }>;
  const pageUidByNumber = new Map(pageUidRows.map((r) => [r.page_number, r.page_uid]));

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-ffmpeg-'));
  const concatFile = path.join(tmpDir, 'concat.txt');
  const segmentsDir = path.join(tmpDir, 'segments');
  await fs.promises.mkdir(segmentsDir, { recursive: true });

  try {
    const segmentPaths: string[] = [];
    let targetWidth: number | null = null;
    let targetHeight: number | null = null;
    for (let i = 0; i < pageNumbers.length; i++) {
      const pageNumber = pageNumbers[i];
      if (!pageNumber) continue;
      const uid = pageUidByNumber.get(pageNumber);
      if (!uid) continue;
      const image = pageImagePath(pdfId, uid);
      const audio = pageAudioPath(pdfId, uid);
      if (!fs.existsSync(image) || !fs.existsSync(audio)) {
        logger.warn(
          { pdfId, pageNumber, image, audio },
          'generateVideo: skipping page with missing image or audio artifact',
        );
        continue;
      }
      if (targetWidth == null || targetHeight == null) {
        const meta = await sharp(image).metadata();
        targetWidth = evenCeil(meta.width || 1);
        targetHeight = evenCeil(meta.height || 1);
      }
      const segment = path.join(segmentsDir, `${String(i + 1).padStart(4, '0')}.mp4`);

      await runCommand(
        FFMPEG,
        [
          '-y',
          '-loop',
          '1',
          '-i',
          image,
          '-i',
          audio,
          '-vf',
          buildScaleAndPadFilter(targetWidth, targetHeight),
          '-c:v',
          'libx264',
          '-tune',
          'stillimage',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-pix_fmt',
          'yuv420p',
          '-shortest',
          '-movflags',
          '+faststart',
          segment,
        ],
        { timeoutMs: SEGMENT_FFMPEG_TIMEOUT_MS },
      );

      segmentPaths.push(segment);
      await onProgress?.(segmentPaths.length, pageNumbers.length);
    }

    if (segmentPaths.length === 0) {
      throw new Error('No video segments generated');
    }

    const concatContent = segmentPaths
      .map((seg) => `file '${seg.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.promises.writeFile(concatFile, concatContent + '\n', 'utf8');

    const output = videoPath(pdfId);
    await runCommand(
      FFMPEG,
      ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', output],
      { timeoutMs: CONCAT_FFMPEG_TIMEOUT_MS },
    );

    return { outputPath: output };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

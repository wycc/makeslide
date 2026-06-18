import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { db } from '../../db';
import { logger } from '../../logger';
import { pageAudioPath, pageImagePath, videoPath } from '../../services/storage';
import { runCommand } from '../poppler';

const FFMPEG = ffmpegStatic ?? 'ffmpeg';

export interface GenerateVideoInput {
  pdfId: string;
  pageCount: number;
  pageNumbers: number[];
  onProgress?: (current: number, total: number) => Promise<void> | void;
}

export interface GenerateVideoResult {
  outputPath: string;
}

export async function generateVideo(
  input: GenerateVideoInput,
): Promise<GenerateVideoResult> {
  const { pdfId, pageNumbers, onProgress } = input;
  if (pageNumbers.length === 0) {
    throw new Error('No pages available for video rendering');
  }
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
      const segment = path.join(segmentsDir, `${String(i + 1).padStart(4, '0')}.mp4`);

      await runCommand(FFMPEG, [
        '-y',
        '-loop',
        '1',
        '-i',
        image,
        '-i',
        audio,
        '-vf',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2',
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
      ]);

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
    await runCommand(FFMPEG, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatFile,
      '-c',
      'copy',
      output,
    ]);

    return { outputPath: output };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

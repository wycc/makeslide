import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageAudioPath, pageImagePath, videoPath } from '../../services/storage';
import { runCommand } from '../poppler';

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
  const { pdfId, pageCount, pageNumbers, onProgress } = input;
  if (pageNumbers.length === 0) {
    throw new Error('No pages available for video rendering');
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'makeslide-ffmpeg-'));
  const concatFile = path.join(tmpDir, 'concat.txt');
  const segmentsDir = path.join(tmpDir, 'segments');
  await fs.promises.mkdir(segmentsDir, { recursive: true });

  try {
    const segmentPaths: string[] = [];
    for (let i = 0; i < pageNumbers.length; i++) {
      const pageNumber = pageNumbers[i];
      if (!pageNumber) continue;
      const image = pageImagePath(pdfId, pageNumber, pageCount);
      const audio = pageAudioPath(pdfId, pageNumber, pageCount);
      const segment = path.join(segmentsDir, `${String(i + 1).padStart(4, '0')}.mp4`);

      await runCommand('ffmpeg', [
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
    await runCommand('ffmpeg', [
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

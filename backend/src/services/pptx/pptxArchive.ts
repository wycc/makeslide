/**
 * Reading and rewriting the .pptx container (a zip), for the PPTX import.
 *
 * Rewriting keeps every part byte-identical except the slides we deliberately change, so the
 * variant a renderer sees differs from the original only in the shapes that are not on screen yet
 * (docs/pptx-animated-import-design.md §1).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

// Same shape as the other jszip users here (routes/pdfs/scorm.ts): the package is CommonJS, and
// this file runs as an ES module.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const JSZip = require('jszip') as typeof import('jszip');

export interface PptxArchive {
  /** Part text, or null when the archive has no such part. */
  readText(partName: string): Promise<string | null>;
  /** Part names present in the archive. */
  partNames(): string[];
  /**
   * The same archive with some parts replaced, as a zip buffer. Parts not named here are copied
   * through untouched.
   */
  writeWith(replacements: Map<string, string>): Promise<Buffer>;
}

export async function openPptx(source: Buffer | string): Promise<PptxArchive> {
  const data = typeof source === 'string' ? await fs.promises.readFile(source) : source;
  const zip = await JSZip.loadAsync(data);
  return {
    async readText(partName: string): Promise<string | null> {
      const file = zip.file(partName);
      if (!file) return null;
      return file.async('string');
    },
    partNames(): string[] {
      return Object.keys(zip.files).filter((name) => !zip.files[name]!.dir);
    },
    async writeWith(replacements: Map<string, string>): Promise<Buffer> {
      const out = new JSZip();
      for (const name of Object.keys(zip.files)) {
        const entry = zip.files[name]!;
        if (entry.dir) continue;
        const replacement = replacements.get(name);
        if (replacement !== undefined) out.file(name, replacement);
        else out.file(name, await entry.async('nodebuffer'));
      }
      return out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    },
  };
}

/** True when the bytes look like a PPTX: a zip whose content types mention presentationml. */
export async function looksLikePptx(source: Buffer | string): Promise<boolean> {
  try {
    const archive = await openPptx(source);
    const contentTypes = await archive.readText('[Content_Types].xml');
    return Boolean(contentTypes?.includes('presentationml')) && archive.partNames().some((n) => n.startsWith('ppt/slides/'));
  } catch {
    return false;
  }
}

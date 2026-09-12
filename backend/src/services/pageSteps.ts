/**
 * Step-built pages: a page that is revealed a piece at a time, the way a PowerPoint slide is built
 * by clicking (docs/pptx-animated-import-design.md §2, §3).
 *
 * The manifest here is the authority for *playback* — how many steps there are, what is said at
 * each one, and which audio file says it. What is *drawn* at each step lives in the page's React
 * code, as elements carrying `data-ms-step-layer="k"`; the sandbox runtime shows the layers up to
 * the current step. The two are written together by the importer and must agree on the count.
 *
 * Why not reuse the GSAP animation spec: an enabled spec rewrites `render_type` to `gsap-image`
 * (services/pageAnimation.ts `renderTypeForSpec`), which would take the page out of React mode.
 * Steps are therefore their own small thing rather than an extension of that system.
 */

import fs from 'node:fs';
import { z } from 'zod';
import { pageStepAudioPath, pageStepsPath } from './storage';

/** A page cannot have more steps than this; the reference deck's busiest slide has 24. */
export const MAX_PAGE_STEPS = 60;
export const MAX_STEP_SCRIPT_CHARS = 2000;

export interface PageStep {
  /** 0-based: step 0 is what the page shows before anything is clicked. */
  index: number;
  /** Page-asset name of this step's picture, when the step has one of its own. */
  asset?: string;
  /** Narration for this step. */
  script: string;
  /** File name of this step's audio, relative to the deck's `pages/` directory. */
  audio?: string;
  audioDurationSeconds?: number;
}

export interface PageStepsManifest {
  version: 1;
  /** Where the steps came from; only pptx import writes these today. */
  source: 'pptx' | 'manual';
  steps: PageStep[];
}

const StepSchema = z.object({
  index: z.number().int().min(0).max(MAX_PAGE_STEPS),
  asset: z.string().max(120).optional(),
  script: z.string().max(MAX_STEP_SCRIPT_CHARS).default(''),
  audio: z.string().max(200).optional(),
  audioDurationSeconds: z.number().nonnegative().optional(),
});

const ManifestSchema = z.object({
  version: z.literal(1),
  source: z.enum(['pptx', 'manual']).default('pptx'),
  steps: z.array(StepSchema).max(MAX_PAGE_STEPS),
});

/**
 * Read a page's steps, or null when it has none.
 *
 * A corrupt manifest reads as "no steps" rather than throwing: the page still has a picture and a
 * narration, and refusing to open the deck over an unreadable side-car would be a worse outcome
 * than showing that page without its build.
 */
export function readPageSteps(pdfId: string, pageUid: string): PageStepsManifest | null {
  const file = pageStepsPath(pdfId, pageUid);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = ManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    // Renumber defensively: playback indexes by position, and a manifest whose `index` fields
    // disagree with their order would step through the narration in the wrong order.
    const steps = parsed.data.steps.map((step, i) => ({ ...step, index: i }));
    return { version: 1, source: parsed.data.source, steps };
  } catch {
    return null;
  }
}

export function writePageSteps(pdfId: string, pageUid: string, manifest: PageStepsManifest): void {
  const validated = ManifestSchema.parse(manifest);
  fs.writeFileSync(pageStepsPath(pdfId, pageUid), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

export function deletePageSteps(pdfId: string, pageUid: string): void {
  fs.rmSync(pageStepsPath(pdfId, pageUid), { force: true });
  for (let i = 0; i < MAX_PAGE_STEPS; i += 1) {
    fs.rmSync(pageStepAudioPath(pdfId, pageUid, i), { force: true });
  }
}

/** How many steps a page has (0 = an ordinary page). */
export function pageStepCount(pdfId: string, pageUid: string): number {
  return readPageSteps(pdfId, pageUid)?.steps.length ?? 0;
}

/**
 * The narration of the whole page, as one script.
 *
 * Kept in sync with the per-step scripts so everything that reads a page's narration — subtitles,
 * the AI tutor's corpus, export, search — keeps working on a step-built page without knowing about
 * steps at all.
 */
export function joinStepScripts(manifest: PageStepsManifest): string {
  return manifest.steps
    .map((step) => step.script.trim())
    .filter(Boolean)
    .join('\n');
}

/** How many `data-ms-step-layer="k"` layers the code declares, per step index. */
export function countStepLayers(code: string): Map<number, number> {
  const counts = new Map<number, number>();
  const re = /data-ms-step-layer\s*=\s*["'{]?\s*["']?(\d{1,3})["']?\s*["'}]?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const index = Number(match[1]);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return counts;
}

/**
 * Whether the code draws something for every step the manifest plays.
 *
 * Step 0 is exempt: a page whose first state is just "the slide as it starts" often has no layer
 * of its own — everything that is always visible is drawn outside the step layers.
 */
export function missingStepLayers(code: string, manifest: PageStepsManifest): number[] {
  const counts = countStepLayers(code);
  const missing: number[] = [];
  for (const step of manifest.steps) {
    if (step.index === 0) continue;
    if (!counts.has(step.index)) missing.push(step.index);
  }
  return missing;
}

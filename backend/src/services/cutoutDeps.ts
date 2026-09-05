/**
 * The model-backed collaborators of the cut-out flow (docs/page-elements.md §9), resolved in one
 * place so the interactive route and the batch regenerate step behave identically:
 *   - eraser: the image-edit call that repaints a masked box as background;
 *   - refiner: the vision LLM that groups / labels detected candidates (only when an LLM is set);
 *   - placer: the vision LLM that picks the narration sentence and box per cut-out (same gate).
 * Tests replace any of them; `undefined` means "use the default", `null` means "run without it".
 */
import { toFile } from 'openai/uploads';
import { imageEditTimeoutMs, withImageProviderFailover } from '../routes/pdfs/page-operations';
import { currentAccountId } from './accountContext';
import { llmAvailability } from './providerAvailability';
import { CUTOUT_MODEL_HEIGHT, CUTOUT_MODEL_WIDTH, type CutoutEraser } from './pageCutouts';
import { llmCutoutPlacer, type CutoutPlacer } from './cutoutPlacement';
import { llmCutoutRefiner, type CutoutRefiner } from './cutoutDetect';

/** The production eraser: the same image-edit call the React-slide text erase uses. */
export const imageEditCutoutEraser: CutoutEraser = async ({ source, mask, prompt }) => {
  const imageFile = await toFile(source, 'region.png', { type: 'image/png' });
  const maskFile = await toFile(mask, 'mask.png', { type: 'image/png' });
  const edited = await withImageProviderFailover(currentAccountId(), ({ client, model }) =>
    client.images.edit(
      { model, image: imageFile, mask: maskFile, prompt, size: `${CUTOUT_MODEL_WIDTH}x${CUTOUT_MODEL_HEIGHT}` },
      { timeout: imageEditTimeoutMs() },
    ));
  const b64 = edited.data?.[0]?.b64_json;
  if (!b64) throw new Error('Image edit returned an empty result while erasing a cut-out');
  return Buffer.from(b64, 'base64');
};

export interface CutoutDeps {
  eraser: CutoutEraser;
  refiner: CutoutRefiner | null;
  placer: CutoutPlacer | null;
}

const overrides: { eraser?: CutoutEraser | null; refiner?: CutoutRefiner | null; placer?: CutoutPlacer | null } = {};

export function setCutoutEraserForTest(eraser: CutoutEraser | null | undefined): void {
  overrides.eraser = eraser;
}
export function setCutoutRefinerForTest(refiner: CutoutRefiner | null | undefined): void {
  overrides.refiner = refiner;
}
export function setCutoutPlacerForTest(placer: CutoutPlacer | null | undefined): void {
  overrides.placer = placer;
}

/** True when a test has replaced the eraser — the route then skips the "is a model configured" gate. */
export function cutoutEraserOverridden(): boolean {
  return overrides.eraser !== undefined && overrides.eraser !== null;
}

export function resolveCutoutDeps(): CutoutDeps {
  const llm = llmAvailability().enabled;
  return {
    eraser: overrides.eraser ?? imageEditCutoutEraser,
    refiner: overrides.refiner !== undefined ? overrides.refiner : llm ? llmCutoutRefiner : null,
    placer: overrides.placer !== undefined ? overrides.placer : llm ? llmCutoutPlacer : null,
  };
}

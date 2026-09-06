/**
 * Cut-out history of a page (docs/page-elements.md §9.9): the picture is never edited in place.
 * At the first cut the base image is kept as a lossless *source*; every cut stores the box the AI
 * repainted as a *patch*; the page's base is always `source + patches of the cuts still in force`,
 * composed in one pass. Restoring a cut is therefore exact and needs no model, and the base is
 * JPEG-encoded once rather than once per edit.
 *
 * Files (all next to the page's other assets):
 *   pages/<uid>.cutouts.json                the manifest
 *   pages/<uid>.cutout-source.png           the base before the first cut
 *   pages/<uid>.cut-<figureId>.patch.png    the repainted box of one cut
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { db } from '../db';
import { logger } from '../logger';
import { findFigureById, getPageFigures, removePageFigure } from './pdfFigures';
import { pageAnimationSpecPath, pagesDir, safeJoinPdfPath } from './storage';
import { defaultAnimationSpec, parseStoredAnimationSpec, renderTypeForSpec, validateAnimationSpec, type AnimationEffect, type AnimationSpec } from './pageAnimation';
import type { PixelBox } from './reactSlideTextExtract';

export interface CutoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CutoutHistoryEntry {
  figureId: string;
  /** Where it was cut from, 0..1 of the source. */
  box: CutoutBox;
  /** Relative path of the repainted-box patch PNG. */
  patch: string;
  effectId: string | null;
  /** The effect as last seen, kept while hidden so "show" can put it back unchanged. */
  hiddenEffect?: AnimationEffect | null;
  createdAt: string;
}

export interface CutoutManifest {
  version: 1;
  source: string;
  width: number;
  height: number;
  cuts: CutoutHistoryEntry[];
}

const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const ManifestSchema = z.object({
  version: z.literal(1),
  source: z.string().regex(/^pages\/[A-Za-z0-9_-]+\.cutout-source\.png$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cuts: z.array(
    z.object({
      figureId: z.string().min(1).max(200),
      box: BoxSchema,
      patch: z.string().regex(/^pages\/[A-Za-z0-9_-]+\.cut-[A-Za-z0-9_-]+\.patch\.png$/),
      effectId: z.string().nullable(),
      hiddenEffect: z.unknown().nullable().optional(),
      createdAt: z.string(),
    }),
  ),
});

interface PageIdentity {
  pdfId: string;
  pageNumber: number;
  pageUid: string;
}

export function cutoutManifestPath(pdfId: string, pageUid: string): string {
  return path.join(pagesDir(pdfId), `${pageUid}.cutouts.json`);
}
function sourceRel(pageUid: string): string {
  return `pages/${pageUid}.cutout-source.png`;
}
function patchRel(pageUid: string, figureId: string): string {
  return `pages/${pageUid}.cut-${figureId.replace(/[^A-Za-z0-9_-]/g, '')}.patch.png`;
}

export function readCutoutManifest(pdfId: string, pageUid: string): CutoutManifest | null {
  try {
    const raw = fs.readFileSync(cutoutManifestPath(pdfId, pageUid), 'utf8');
    const parsed = ManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as CutoutManifest) : null;
  } catch {
    return null;
  }
}

async function writeCutoutManifest(pdfId: string, pageUid: string, manifest: CutoutManifest): Promise<void> {
  await fs.promises.writeFile(cutoutManifestPath(pdfId, pageUid), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * The manifest for a page about to be cut: existing one, or a fresh one whose source is the
 * picture as it is right now (`currentPng`).
 */
export async function ensureCutoutManifest(page: PageIdentity, currentPng: Buffer, width: number, height: number): Promise<CutoutManifest> {
  const existing = readCutoutManifest(page.pdfId, page.pageUid);
  if (existing && fs.existsSync(safeJoinPdfPath(page.pdfId, existing.source))) return existing;
  const manifest: CutoutManifest = { version: 1, source: sourceRel(page.pageUid), width, height, cuts: [] };
  await fs.promises.writeFile(safeJoinPdfPath(page.pdfId, manifest.source), currentPng);
  await writeCutoutManifest(page.pdfId, page.pageUid, manifest);
  return manifest;
}

/** Records one cut: stores the repainted box as a patch and appends the entry. */
export async function recordCut(
  page: PageIdentity,
  manifest: CutoutManifest,
  entry: { figureId: string; box: CutoutBox; pixelBox: PixelBox; effectId: string | null },
  erasedFull: Buffer,
): Promise<CutoutManifest> {
  const patch = await sharp(erasedFull).extract(entry.pixelBox).png().toBuffer();
  const rel = patchRel(page.pageUid, entry.figureId);
  await fs.promises.writeFile(safeJoinPdfPath(page.pdfId, rel), patch);
  const next: CutoutManifest = {
    ...manifest,
    cuts: [...manifest.cuts, { figureId: entry.figureId, box: entry.box, patch: rel, effectId: entry.effectId, createdAt: new Date().toISOString() }],
  };
  await writeCutoutManifest(page.pdfId, page.pageUid, next);
  return next;
}

export async function updateCutEffectIds(page: PageIdentity, manifest: CutoutManifest, effectIds: Map<string, string>): Promise<CutoutManifest> {
  const next: CutoutManifest = {
    ...manifest,
    cuts: manifest.cuts.map((c) => (effectIds.has(c.figureId) ? { ...c, effectId: effectIds.get(c.figureId)! } : c)),
  };
  await writeCutoutManifest(page.pdfId, page.pageUid, next);
  return next;
}

function pixelBoxOf(box: CutoutBox, width: number, height: number): PixelBox {
  const left = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(box.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(box.h * height))),
  };
}

/** `source + patches` as a PNG buffer — the page's base with every recorded cut applied. */
export async function composeBaseFromHistory(pdfId: string, manifest: CutoutManifest): Promise<Buffer> {
  const source = sharp(safeJoinPdfPath(pdfId, manifest.source));
  const overlays: sharp.OverlayOptions[] = [];
  for (const cut of manifest.cuts) {
    const abs = safeJoinPdfPath(pdfId, cut.patch);
    if (!fs.existsSync(abs)) {
      logger.warn({ pdfId, figureId: cut.figureId }, 'cutoutHistory: patch missing, cut left unapplied');
      continue;
    }
    const pb = pixelBoxOf(cut.box, manifest.width, manifest.height);
    overlays.push({ input: abs, left: pb.left, top: pb.top });
  }
  return (overlays.length ? source.composite(overlays) : source).png().toBuffer();
}

// ─── Listing ────────────────────────────────────────────────────────────────

export interface CutoutListItem {
  figureId: string;
  caption: string | null;
  /** Where it was cut from (0..1). */
  origin: CutoutBox;
  /** Where the overlay shows it (0..1): the effect's box, else the origin. */
  box: CutoutBox;
  effectId: string | null;
  hidden: boolean;
  /** exact: recorded in the history; paste-back: made before the history existed; none: the base was replaced since. */
  restorable: 'exact' | 'paste-back' | 'none';
  /** Cut out of the picture but with no reveal effect (the spec was full when it was cut): it never comes back during playback. */
  missingEffect: boolean;
}

function readSpec(page: PageIdentity): AnimationSpec {
  const row = db.prepare(`SELECT animation_spec_path FROM pages WHERE pdf_id = ? AND page_number = ?`).get(page.pdfId, page.pageNumber) as
    | { animation_spec_path: string | null }
    | undefined;
  const abs = row?.animation_spec_path ? safeJoinPdfPath(page.pdfId, row.animation_spec_path) : pageAnimationSpecPath(page.pdfId, page.pageUid);
  if (!fs.existsSync(abs)) return defaultAnimationSpec();
  try {
    return parseStoredAnimationSpec(fs.readFileSync(abs, 'utf8'));
  } catch {
    return defaultAnimationSpec();
  }
}

async function writeSpec(page: PageIdentity, spec: AnimationSpec): Promise<void> {
  const validated = validateAnimationSpec({ ...spec, version: 1, enabled: spec.effects.length > 0 ? spec.enabled : spec.enabled });
  if (!validated.ok) throw new Error(`Animation spec invalid after cut-out change: ${validated.message}`);
  await fs.promises.writeFile(pageAnimationSpecPath(page.pdfId, page.pageUid), `${JSON.stringify(validated.spec, null, 2)}\n`, 'utf8');
  db.prepare(`UPDATE pages SET render_type = ?, animation_spec_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`).run(
    renderTypeForSpec(validated.spec),
    `pages/${page.pageUid}.animation.json`,
    new Date().toISOString(),
    page.pdfId,
    page.pageNumber,
  );
}

/** Every cut-out figure of the page with its state, history-recorded or not. */
export function listCutouts(page: PageIdentity): CutoutListItem[] {
  const manifest = readCutoutManifest(page.pdfId, page.pageUid);
  const byFigure = new Map(manifest?.cuts.map((c) => [c.figureId, c]) ?? []);
  const spec = readSpec(page);
  const figures = getPageFigures(page.pdfId, page.pageNumber).filter((f) => f.source === 'cutout');
  return figures.map((f) => {
    const cut = byFigure.get(f.id);
    const effect = spec.effects.find((e) => e.figureId === f.id) ?? null;
    const p = effect?.params;
    const origin = { x: f.bbox.xPct, y: f.bbox.yPct, w: f.bbox.widthPct, h: f.bbox.heightPct };
    const box =
      p && [p.xPct, p.yPct, p.widthPct, p.heightPct].every((v) => typeof v === 'number')
        ? { x: p.xPct! / 100, y: p.yPct! / 100, w: p.widthPct! / 100, h: p.heightPct! / 100 }
        : origin;
    const hidden = !effect && Boolean(cut?.hiddenEffect);
    return {
      figureId: f.id,
      caption: f.caption,
      origin,
      box,
      effectId: effect?.id ?? null,
      hidden,
      restorable: cut && fs.existsSync(safeJoinPdfPath(page.pdfId, cut.patch)) ? 'exact' : 'paste-back',
      missingEffect: !effect && !hidden,
    };
  });
}

// ─── Hide / show ────────────────────────────────────────────────────────────

/**
 * Hidden = the overlay effect is taken out of the spec (so playback never shows it) while the
 * figure and the history entry stay; the removed effect is kept so "show" restores it verbatim.
 */
export async function setCutoutHidden(page: PageIdentity, figureId: string, hidden: boolean): Promise<void> {
  const manifest = readCutoutManifest(page.pdfId, page.pageUid);
  const spec = readSpec(page);
  const effect = spec.effects.find((e) => e.figureId === figureId) ?? null;
  const entry = manifest?.cuts.find((c) => c.figureId === figureId) ?? null;
  if (hidden) {
    if (!effect) return;
    await writeSpec(page, { ...spec, effects: spec.effects.filter((e) => e.id !== effect.id) });
    if (manifest) {
      // A legacy cut-out (no patch) still gets a history entry so the hidden effect has a home;
      // `patch` points at a file that does not exist, which composeBaseFromHistory tolerates.
      const cuts = entry
        ? manifest.cuts.map((c) => (c.figureId === figureId ? { ...c, hiddenEffect: effect } : c))
        : [...manifest.cuts, legacyEntry(page.pageUid, figureId, effect)];
      await writeCutoutManifest(page.pdfId, page.pageUid, { ...manifest, cuts });
    }
    return;
  }
  if (effect) return;
  const saved = entry?.hiddenEffect as AnimationEffect | null | undefined;
  if (!saved) return;
  await writeSpec(page, { ...spec, enabled: true, effects: [...spec.effects, saved] });
  if (manifest) {
    await writeCutoutManifest(page.pdfId, page.pageUid, {
      ...manifest,
      cuts: manifest.cuts.map((c) => (c.figureId === figureId ? { ...c, hiddenEffect: null } : c)),
    });
  }
}

/** History entry for a cut-out made before the history existed: no patch, only the hidden effect. */
function legacyEntry(pageUid: string, figureId: string, hiddenEffect: AnimationEffect): CutoutHistoryEntry {
  return { figureId, box: { x: 0, y: 0, w: 0, h: 0 }, patch: patchRel(pageUid, figureId), effectId: null, hiddenEffect, createdAt: new Date().toISOString() };
}

// ─── Restore ────────────────────────────────────────────────────────────────

export interface RestoreOutcome {
  figureId: string;
  status: 'restored' | 'pasted-back' | 'skipped';
  message?: string;
}

/**
 * Takes cuts out of the history (exact) or pastes legacy cut-outs back into the source, removes
 * their figures and effects. Returns the manifest to compose from; the caller composes and writes
 * the base once.
 */
export async function restoreCuts(page: PageIdentity, figureIds: string[], manifest: CutoutManifest): Promise<{ manifest: CutoutManifest; outcomes: RestoreOutcome[] }> {
  const outcomes: RestoreOutcome[] = [];
  let next = manifest;
  const spec = readSpec(page);
  let effects = spec.effects;
  let sourceChanged = false;
  let sourceImage: sharp.Sharp | null = null;
  const pasteBacks: sharp.OverlayOptions[] = [];

  for (const figureId of figureIds) {
    const entry = next.cuts.find((c) => c.figureId === figureId);
    const figure = findFigureById(page.pdfId, figureId);
    const hasPatch = entry ? fs.existsSync(safeJoinPdfPath(page.pdfId, entry.patch)) : false;
    if (entry && hasPatch) {
      next = { ...next, cuts: next.cuts.filter((c) => c.figureId !== figureId) };
      await fs.promises.rm(safeJoinPdfPath(page.pdfId, entry.patch), { force: true });
      outcomes.push({ figureId, status: 'restored' });
    } else if (figure && figure.source === 'cutout') {
      if (entry) next = { ...next, cuts: next.cuts.filter((c) => c.figureId !== figureId) };
      // Made before the history existed: the only record of those pixels is the figure itself.
      // It was cropped losslessly at exactly this box, so pasting it back is exact within the box.
      const pb = pixelBoxOf({ x: figure.bbox.xPct, y: figure.bbox.yPct, w: figure.bbox.widthPct, h: figure.bbox.heightPct }, next.width, next.height);
      const png = await sharp(safeJoinPdfPath(page.pdfId, figure.imagePath)).resize(pb.width, pb.height, { fit: 'fill' }).png().toBuffer();
      pasteBacks.push({ input: png, left: pb.left, top: pb.top });
      sourceChanged = true;
      outcomes.push({ figureId, status: 'pasted-back' });
    } else {
      outcomes.push({ figureId, status: 'skipped', message: 'not a cut-out of this page' });
      continue;
    }
    effects = effects.filter((e) => e.figureId !== figureId);
    if (figure) await removePageFigure(page.pdfId, page.pageNumber, figureId);
  }

  if (sourceChanged) {
    sourceImage = sharp(safeJoinPdfPath(page.pdfId, next.source));
    const updated = await sourceImage.composite(pasteBacks).png().toBuffer();
    await fs.promises.writeFile(safeJoinPdfPath(page.pdfId, next.source), updated);
  }
  if (effects.length !== spec.effects.length) {
    await writeSpec(page, { ...spec, effects });
  }
  await writeCutoutManifest(page.pdfId, page.pageUid, next);
  return { manifest: next, outcomes };
}

/**
 * The picture was replaced by something the history knows nothing about (a new base, an AI redraw,
 * a fusion): the source and patches no longer describe it. Drop them; figures and effects stay.
 */
export async function invalidateCutoutHistory(pdfId: string, pageUid: string): Promise<boolean> {
  const manifest = readCutoutManifest(pdfId, pageUid);
  if (!manifest) return false;
  await Promise.all([
    fs.promises.rm(safeJoinPdfPath(pdfId, manifest.source), { force: true }),
    ...manifest.cuts.map((c) => fs.promises.rm(safeJoinPdfPath(pdfId, c.patch), { force: true })),
    fs.promises.rm(cutoutManifestPath(pdfId, pageUid), { force: true }),
  ]);
  return true;
}

/**
 * The picture previews (thumbnail strip, cover) should be made from: the uncut source while a
 * cut-out history exists — a thumbnail of the erased base is mostly blank and says nothing about
 * the page — otherwise null (use the page image).
 */
export function cutoutPreviewSourcePath(pdfId: string, pageUid: string): string | null {
  const manifest = readCutoutManifest(pdfId, pageUid);
  if (!manifest || manifest.cuts.length === 0) return null;
  const abs = safeJoinPdfPath(pdfId, manifest.source);
  return fs.existsSync(abs) ? abs : null;
}

/** Every history file of a page, for page deletion. */
export function cutoutHistoryFiles(pdfId: string, pageUid: string): string[] {
  const manifest = readCutoutManifest(pdfId, pageUid);
  if (!manifest) return [];
  return [
    cutoutManifestPath(pdfId, pageUid),
    safeJoinPdfPath(pdfId, manifest.source),
    ...manifest.cuts.map((c) => safeJoinPdfPath(pdfId, c.patch)),
  ];
}

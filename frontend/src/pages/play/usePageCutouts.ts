import { useCallback, useEffect, useState } from 'react';
import { ApiError, cutoutPageRegions, detectCutoutRegions, fetchPageAnimation, fetchPageFigures, figureImageUrl, type CutoutPageRegionsResponse } from '../../lib/api';
import { MAX_CUTOUT_REGIONS, type CutoutRegion } from '../../lib/cutoutRegions';
import type { PdfDetailPage } from '../../types';

/** A region already cut out of the page: its figure and where the overlay effect shows it. */
export interface ExistingCutout {
  figureId: string;
  caption: string | null;
  /** 0..1 of the page; the effect's box when it has one, else where the figure was cut from. */
  box: { x: number; y: number; w: number; h: number };
  imageUrl: string;
  effectId: string | null;
}

export interface PageCutoutsState {
  /** Regions already cut out of the current page (figures with source 'cutout'). */
  existingCutouts: ExistingCutout[];
  /** Draw the existing cut-outs on the slide while editing (they are erased from the base). */
  showExistingCutouts: boolean;
  setShowExistingCutouts: (on: boolean) => void;
  /** True while the slide is in "draw cut-out boxes" mode. */
  cutoutMode: boolean;
  setCutoutMode: (on: boolean) => void;
  cutoutRegions: CutoutRegion[];
  addCutoutRegion: (region: CutoutRegion) => void;
  removeCutoutRegion: (index: number) => void;
  clearCutoutRegions: () => void;
  cutoutPrompt: string;
  setCutoutPrompt: (value: string) => void;
  cutoutAnimate: boolean;
  setCutoutAnimate: (value: boolean) => void;
  cutoutBusy: boolean;
  /** True while auto-detection runs. */
  cutoutDetecting: boolean;
  /** Proposes regions from the picture (§9.6) and puts them in the list for review. */
  detectCutouts: () => Promise<boolean>;
  cutoutError: string | null;
  cutoutResult: CutoutPageRegionsResponse | null;
  clearCutoutResult: () => void;
  runCutouts: () => Promise<boolean>;
}

interface UsePageCutoutsArgs {
  pdfId: string | null;
  currentPage: PdfDetailPage | null;
  isReadOnlyProcessing: boolean;
  reloadDetail: () => Promise<void>;
  /** The saved animation spec changed on the server; the animation editor must refetch it. */
  reloadAnimationSpec: () => void;
  withShareToken: (url: string | null | undefined) => string | null;
  t: (key: never) => string;
}

/**
 * Cut-out regions (docs/page-elements.md §9): the boxes drawn on the slide, the erase prompt, and
 * the call that turns them into figures + overlay-image effects. Regions are per page and are
 * dropped when the page changes — a box drawn on one picture means nothing on another.
 */
export function usePageCutouts({ pdfId, currentPage, isReadOnlyProcessing, reloadDetail, reloadAnimationSpec, withShareToken, t }: UsePageCutoutsArgs): PageCutoutsState {
  const [cutoutMode, setCutoutMode] = useState(false);
  const [regions, setRegions] = useState<CutoutRegion[]>([]);
  const [prompt, setPrompt] = useState('');
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CutoutPageRegionsResponse | null>(null);
  const [existingCutouts, setExistingCutouts] = useState<ExistingCutout[]>([]);
  const [showExistingCutouts, setShowExistingCutouts] = useState(true);
  const pageNumber = currentPage?.page_number ?? null;
  const renderType = currentPage?.render_type;
  const pageUpdatedAt = currentPage?.updated_at;

  // What has already been cut out of this page: the 'cutout' figures, placed where their overlay
  // effect shows them (the figure's own bbox when no effect references it).
  useEffect(() => {
    if (!pdfId || pageNumber == null || renderType === 'react' || renderType === 'notebook') {
      setExistingCutouts([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const figures = await fetchPageFigures(pdfId, pageNumber);
        const cut = figures.figures.filter((f) => f.source === 'cutout');
        if (cut.length === 0) {
          if (!cancelled) setExistingCutouts([]);
          return;
        }
        let effects: Array<{ id: string; figureId?: string; params?: Record<string, number> }> = [];
        try {
          effects = (await fetchPageAnimation(pdfId, pageNumber)).spec.effects;
        } catch {
          effects = [];
        }
        const list: ExistingCutout[] = cut.map((f) => {
          const effect = effects.find((e) => e.figureId === f.id);
          const p = effect?.params;
          const box = p && [p.xPct, p.yPct, p.widthPct, p.heightPct].every((v) => typeof v === 'number')
            ? { x: p.xPct! / 100, y: p.yPct! / 100, w: p.widthPct! / 100, h: p.heightPct! / 100 }
            : { x: f.bbox.xPct, y: f.bbox.yPct, w: f.bbox.widthPct, h: f.bbox.heightPct };
          const url = figureImageUrl(pdfId, f.id);
          return { figureId: f.id, caption: f.caption, box, imageUrl: withShareToken(url) ?? url, effectId: effect?.id ?? null };
        });
        if (!cancelled) setExistingCutouts(list);
      } catch {
        if (!cancelled) setExistingCutouts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, renderType, pageUpdatedAt, withShareToken]);

  useEffect(() => {
    setRegions([]);
    setCutoutMode(false);
    setError(null);
    setResult(null);
  }, [pdfId, pageNumber]);

  const addCutoutRegion = useCallback((region: CutoutRegion) => {
    setRegions((prev) => (prev.length >= MAX_CUTOUT_REGIONS ? prev : [...prev, region]));
    setResult(null);
  }, []);
  const removeCutoutRegion = useCallback((index: number) => setRegions((prev) => prev.filter((_, i) => i !== index)), []);
  const clearCutoutRegions = useCallback(() => setRegions([]), []);

  const detectCutouts = useCallback(async () => {
    if (!pdfId || pageNumber == null || isReadOnlyProcessing || busy || detecting) return false;
    setDetecting(true);
    setError(null);
    setResult(null);
    try {
      const res = await detectCutoutRegions(pdfId, pageNumber);
      setRegions(res.regions.slice(0, MAX_CUTOUT_REGIONS));
      // Show the boxes on the slide so they can be checked, removed or added to before cutting.
      setCutoutMode(true);
      if (res.regions.length === 0) setError(t('play.cutout.detectNone' as never));
      return res.regions.length > 0;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('play.cutout.detectFailed' as never));
      return false;
    } finally {
      setDetecting(false);
    }
  }, [pdfId, pageNumber, isReadOnlyProcessing, busy, detecting, t]);

  const runCutouts = useCallback(async () => {
    if (!pdfId || pageNumber == null || isReadOnlyProcessing || regions.length === 0 || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await cutoutPageRegions(pdfId, pageNumber, regions, { prompt: prompt.trim() || undefined, animate });
      setResult(res);
      setRegions([]);
      setCutoutMode(false);
      await reloadDetail();
      reloadAnimationSpec();
      return res.results.every((r) => r.status === 'done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('play.cutout.failed' as never));
      return false;
    } finally {
      setBusy(false);
    }
  }, [pdfId, pageNumber, isReadOnlyProcessing, regions, busy, prompt, animate, reloadDetail, reloadAnimationSpec, t]);

  return {
    existingCutouts,
    showExistingCutouts,
    setShowExistingCutouts,
    cutoutMode,
    setCutoutMode,
    cutoutRegions: regions,
    addCutoutRegion,
    removeCutoutRegion,
    clearCutoutRegions,
    cutoutPrompt: prompt,
    setCutoutPrompt: setPrompt,
    cutoutAnimate: animate,
    setCutoutAnimate: setAnimate,
    cutoutBusy: busy,
    cutoutDetecting: detecting,
    detectCutouts,
    cutoutError: error,
    cutoutResult: result,
    clearCutoutResult: () => setResult(null),
    runCutouts,
  };
}

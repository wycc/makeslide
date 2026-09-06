import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  applyPageCutouts,
  detectCutoutRegions,
  fetchPageCutouts,
  figureImageUrl,
  setPageCutoutHidden,
  type ApplyPageCutoutsResponse,
  type PageCutoutItem,
} from '../../lib/api';
import { MAX_CUTOUT_REGIONS, type CutoutRegion } from '../../lib/cutoutRegions';
import type { PdfDetailPage } from '../../types';

/** A region already cut out of the page, as the server lists it, plus the image URL to draw it. */
export interface ExistingCutout extends PageCutoutItem {
  imageUrl: string;
}

export interface PageCutoutsState {
  /** Regions already cut out of the current page (from the server). */
  existingCutouts: ExistingCutout[];
  /** Draw the existing cut-outs on the slide while editing (they are erased from the base). */
  showExistingCutouts: boolean;
  setShowExistingCutouts: (on: boolean) => void;
  /** Cut-outs marked for restoring in the draft (applied on 套用). */
  pendingRestore: ReadonlySet<string>;
  toggleRestore: (figureId: string) => void;
  /** Restore this cut-out and put its box back into the draft to be adjusted and cut again. */
  recutCutout: (figureId: string) => void;
  /** Hide / show a cut-out's overlay — immediate, no picture work. */
  setCutoutHidden: (figureId: string, hidden: boolean) => Promise<void>;
  /** Number of draft changes (restores + new regions) not yet applied. */
  pendingChangeCount: number;
  applyChanges: () => Promise<boolean>;
  discardChanges: () => void;
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
  cutoutResult: ApplyPageCutoutsResponse | null;
  clearCutoutResult: () => void;
  /** Alias kept for callers that only cut: applies the draft. */
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
 * Cut-out regions (docs/page-elements.md §9.9): everything the user does — drawing boxes, marking
 * cut-outs to restore, re-boxing one — only edits a per-page draft that the slide previews
 * approximately and instantly. One "套用變更" sends the whole draft; the server composes the base
 * once from the cut-out history and calls the image model only for the new regions. Hiding /
 * showing a cut-out touches nothing but the animation spec, so it applies immediately.
 */
export function usePageCutouts({ pdfId, currentPage, isReadOnlyProcessing, reloadDetail, reloadAnimationSpec, withShareToken, t }: UsePageCutoutsArgs): PageCutoutsState {
  const [cutoutMode, setCutoutMode] = useState(false);
  const [regions, setRegions] = useState<CutoutRegion[]>([]);
  const [pendingRestore, setPendingRestore] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [animate, setAnimate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyPageCutoutsResponse | null>(null);
  const [serverCuts, setServerCuts] = useState<PageCutoutItem[]>([]);
  const [showExistingCutouts, setShowExistingCutouts] = useState(true);
  const pageNumber = currentPage?.page_number ?? null;
  const renderType = currentPage?.render_type;
  const pageUpdatedAt = currentPage?.updated_at;

  const loadCuts = useCallback(async () => {
    if (!pdfId || pageNumber == null || renderType === 'react' || renderType === 'notebook') {
      setServerCuts([]);
      return;
    }
    try {
      const res = await fetchPageCutouts(pdfId, pageNumber);
      setServerCuts(res.cuts);
    } catch {
      setServerCuts([]);
    }
  }, [pdfId, pageNumber, renderType]);

  useEffect(() => {
    void loadCuts();
  }, [loadCuts, pageUpdatedAt]);

  // The draft belongs to one page: turning the page drops it.
  useEffect(() => {
    setRegions([]);
    setPendingRestore(new Set());
    setCutoutMode(false);
    setError(null);
    setResult(null);
  }, [pdfId, pageNumber]);

  const existingCutouts = useMemo<ExistingCutout[]>(
    () =>
      pdfId
        ? serverCuts.map((c) => {
            const url = figureImageUrl(pdfId, c.figureId);
            return { ...c, imageUrl: withShareToken(url) ?? url };
          })
        : [],
    [pdfId, serverCuts, withShareToken],
  );

  const addCutoutRegion = useCallback((region: CutoutRegion) => {
    setRegions((prev) => (prev.length >= MAX_CUTOUT_REGIONS ? prev : [...prev, region]));
    setResult(null);
  }, []);
  const removeCutoutRegion = useCallback((index: number) => setRegions((prev) => prev.filter((_, i) => i !== index)), []);
  const clearCutoutRegions = useCallback(() => setRegions([]), []);

  const toggleRestore = useCallback((figureId: string) => {
    setPendingRestore((prev) => {
      const next = new Set(prev);
      if (next.has(figureId)) next.delete(figureId);
      else next.add(figureId);
      return next;
    });
    setResult(null);
  }, []);

  const recutCutout = useCallback(
    (figureId: string) => {
      const cut = serverCuts.find((c) => c.figureId === figureId);
      if (!cut) return;
      setPendingRestore((prev) => new Set(prev).add(figureId));
      setRegions((prev) => (prev.length >= MAX_CUTOUT_REGIONS ? prev : [...prev, { ...cut.origin, label: cut.caption ?? undefined }]));
      setCutoutMode(true);
      setResult(null);
    },
    [serverCuts],
  );

  const setCutoutHidden = useCallback(
    async (figureId: string, hidden: boolean) => {
      if (!pdfId || pageNumber == null || isReadOnlyProcessing) return;
      setError(null);
      try {
        const res = await setPageCutoutHidden(pdfId, pageNumber, figureId, hidden);
        setServerCuts(res.cuts);
        reloadAnimationSpec();
        await reloadDetail();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('play.cutout.failed' as never));
      }
    },
    [pdfId, pageNumber, isReadOnlyProcessing, reloadAnimationSpec, reloadDetail, t],
  );

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

  const pendingChangeCount = pendingRestore.size + regions.length;

  const applyChanges = useCallback(async () => {
    if (!pdfId || pageNumber == null || isReadOnlyProcessing || busy || pendingChangeCount === 0) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await applyPageCutouts(pdfId, pageNumber, {
        restore: [...pendingRestore],
        cut: regions,
        prompt: prompt.trim() || undefined,
        animate,
      });
      setResult(res);
      setServerCuts(res.cuts);
      // Regions that failed stay in the draft so one more 套用 retries just them.
      const failedIndexes = new Set(res.results.filter((r) => r.status === 'failed').map((r) => r.index));
      setRegions((prev) => prev.filter((_, i) => failedIndexes.has(i)));
      setPendingRestore(new Set());
      setCutoutMode(false);
      await reloadDetail();
      reloadAnimationSpec();
      return failedIndexes.size === 0;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('play.cutout.failed' as never));
      return false;
    } finally {
      setBusy(false);
    }
  }, [pdfId, pageNumber, isReadOnlyProcessing, busy, pendingChangeCount, pendingRestore, regions, prompt, animate, reloadDetail, reloadAnimationSpec, t]);

  const discardChanges = useCallback(() => {
    setRegions([]);
    setPendingRestore(new Set());
    setCutoutMode(false);
    setError(null);
  }, []);

  return {
    existingCutouts,
    showExistingCutouts,
    setShowExistingCutouts,
    pendingRestore,
    toggleRestore,
    recutCutout,
    setCutoutHidden,
    pendingChangeCount,
    applyChanges,
    discardChanges,
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
    runCutouts: applyChanges,
  };
}

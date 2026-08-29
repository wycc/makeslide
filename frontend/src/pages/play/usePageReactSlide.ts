import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  applyPageSlideEdits,
  bakeReactSlide,
  detectSlideTextRegions,
  extractSlideTextBatch,
  type DetectedTextRegion,
  deletePageReactSlide,
  extractSlideText,
  undoReactSlideBackground,
  fetchPageReactSlide,
  generatePageReactSlide,
  generatePageReactSlideBackground,
  fetchReactSlideAssets,
  reactSlideBackgroundUrl,
  uploadReactSlideAsset,
  type SlideEdit,
  savePageReactSlide,
  saveSlideTheme,
  generateSlideTheme as generateSlideThemeApi,
} from '../../lib/api';
import type { PdfDetail, PdfDetailPage } from '../../types';
import {
  defaultReactSlideConfig,
  defaultSlideTheme,
  overridesToEdits,
  type ReactSlideConfig,
  type SlideTheme,
} from '../../lib/reactSlide';
import { useI18n } from '../../i18n';

interface UsePageReactSlideParams {
  pdfId: string | undefined;
  currentPage: PdfDetailPage | null;
  shareToken: string;
  editTab: string;
  setDetail: Dispatch<SetStateAction<PdfDetail | null>>;
  /** Re-fetch the deck after baking, so the thumbnail strip picks up the new page image. */
  reloadDetail: () => Promise<void>;
}

export interface PageReactSlideState {
  /** JSX source shown in the code editor. */
  reactCode: string;
  setReactCode: Dispatch<SetStateAction<string>>;
  /** Compiled JS the sandbox runs; only replaced by the server (save/generate). */
  reactCompiled: string;
  reactConfig: ReactSlideConfig;
  setReactConfig: Dispatch<SetStateAction<ReactSlideConfig>>;
  slideTheme: SlideTheme;
  setSlideTheme: Dispatch<SetStateAction<SlideTheme>>;
  /** URL of the generated background image, already cache-busted; undefined when there is none. */
  reactBackgroundUrl: string | undefined;
  reactAssets: Record<string, string>;
  /** The deck's canvas (from the backend); React pages lay out against it, not a fixed 16:9. */
  reactCanvas: { width: number; height: number } | undefined;
  reactBusy: boolean;
  reactError: string | null;
  reactMessage: string | null;
  setReactError: Dispatch<SetStateAction<string | null>>;
  /** True once the page's data has been loaded at least once for the current page. */
  reactLoaded: boolean;
  handleSaveReactSlide: (code?: string) => Promise<boolean>;
  handleSaveReactConfig: (config: ReactSlideConfig) => Promise<boolean>;
  handleGenerateReactSlide: (prompt: string) => Promise<boolean>;
  handleGenerateReactBackground: (prompt: string, overlayOpacity?: number) => Promise<boolean>;
  handleSaveSlideTheme: (theme: SlideTheme) => Promise<boolean>;
  handleGenerateSlideTheme: (prompt: string) => Promise<boolean>;
  /** Fusion — see the implementation's comment. `force` converts even if the bake failed. */
  handleConvertToPlainSlide: (options?: { force?: boolean }) => Promise<boolean>;
  /** Render this page into its JPG so thumbnails and exports show the React slide. */
  handleBakeReactSlide: () => Promise<boolean>;
  /** Lift the text inside a region out of the background and into a React text layer. */
  handleExtractText: (region: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => Promise<boolean>;
  /** Detect every text box on the page; returns them for the user to choose from. */
  handleDetectTextRegions: () => Promise<DetectedTextRegion[]>;
  /** Lift every selected box in one pass. */
  handleExtractTextBatch: (regions: Array<{ xPct: number; yPct: number; widthPct: number; heightPct: number }>) => Promise<boolean>;
  /** Put back the background from before the last replace/erase. */
  handleUndoBackground: () => Promise<boolean>;
  /** Add text or a picture to the page, converting it to a React slide first if needed. */
  handleAddOverlay: (input: { text?: string; file?: File; style: Record<string, string>; href?: string }) => Promise<boolean>;
  /** Set (or clear, with '') the link on one element. */
  handleSetElementLink: (id: string, href: string) => Promise<boolean>;
}

/**
 * Wait for an image to be in the browser's cache, so it can be shown without a gap.
 *
 * Resolves on failure too, and gives up after a moment: this only exists to make a swap look
 * clean, and a background that will not load must not be able to hold the edit hostage.
 */
async function preloadImage(url: string, timeoutMs = 8000): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    const img = new Image();
    img.onload = done;
    img.onerror = done;
    img.src = url;
  });
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Loads and edits one page's React slide (docs/react-slide-design.md).
 *
 * Data is fetched when the page is already a React slide (the player needs it to render) or when
 * the React editor tab is open (the user is about to make one) — never otherwise, so ordinary
 * image decks pay nothing for this feature.
 *
 * `render_type` changes are pushed back into the deck detail so the renderer switches over
 * immediately after "generate"/"convert back" without waiting for a deck refetch.
 */
export function usePageReactSlide({
  pdfId,
  currentPage,
  shareToken,
  editTab,
  setDetail,
  reloadDetail,
}: UsePageReactSlideParams): PageReactSlideState {
  const { t } = useI18n();
  const [reactCode, setReactCode] = useState('');
  const [reactCompiled, setReactCompiled] = useState('');
  const [reactConfig, setReactConfig] = useState<ReactSlideConfig>(defaultReactSlideConfig());
  const [slideTheme, setSlideTheme] = useState<SlideTheme>(defaultSlideTheme());
  const [reactBusy, setReactBusy] = useState(false);
  const [reactError, setReactError] = useState<string | null>(null);
  const [reactMessage, setReactMessage] = useState<string | null>(null);
  const [reactLoaded, setReactLoaded] = useState(false);
  const pageNumber = currentPage?.page_number ?? null;
  const isReactPage = currentPage?.render_type === 'react';
  const shouldLoad = Boolean(pdfId) && pageNumber != null && (isReactPage || editTab === 'react');
  // Guards against a slow response for a page the user has already navigated away from
  // overwriting the newer page's code.
  const loadKeyRef = useRef('');

  useEffect(() => {
    if (!pdfId || pageNumber == null || !shouldLoad) {
      setReactLoaded(false);
      return;
    }
    const key = `${pdfId}:${pageNumber}`;
    loadKeyRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPageReactSlide(pdfId, pageNumber, shareToken);
        if (cancelled || loadKeyRef.current !== key) return;
        setReactCode(data.code);
        setReactCompiled(data.compiled);
        setReactConfig(data.config ?? defaultReactSlideConfig());
        setSlideTheme(data.theme ?? defaultSlideTheme());
        setReactCanvas(data.canvas);
        setReactError(null);
        setReactLoaded(true);
      } catch (err) {
        if (cancelled || loadKeyRef.current !== key) return;
        setReactError(errorMessage(err, t('play.react.loadFailed')));
        setReactLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, shareToken, shouldLoad, t]);

  const applyRenderType = useCallback(
    (renderType: PdfDetailPage['render_type']) => {
      if (pageNumber == null) return;
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((p) => (p.page_number === pageNumber ? { ...p, render_type: renderType } : p)),
            }
          : prev,
      );
    },
    [pageNumber, setDetail],
  );

  const handleSaveReactSlide = useCallback(
    async (code?: string) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const source = code ?? reactCode;
        const saved = await savePageReactSlide(pdfId, pageNumber, { code: source });
        setReactConfig(saved.config);
        applyRenderType('react');
        // The server compiled it; re-fetch so the sandbox runs exactly what was stored rather
        // than a locally guessed compilation.
        const data = await fetchPageReactSlide(pdfId, pageNumber, shareToken);
        setReactCompiled(data.compiled);
        setReactMessage(t('play.react.saved'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.saveFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [applyRenderType, pageNumber, pdfId, reactCode, shareToken, t],
  );

  /**
   * Save the page's edits.
   *
   * The element tweaks in `config.overrides` are a *pending* buffer, not stored state: they exist
   * so the sandbox can restyle live while the user drags a slider, and this is where they become
   * permanent — written into the JSX, which is the only place an edit lives. The rest of the
   * config (background, text layers) is saved as before.
   *
   * Order matters: the edits go in first, because writing them recompiles the page and returns the
   * new source; saving the config afterwards is what clears the buffer on disk.
   */
  const handleSaveReactConfig = useCallback(
    async (config: ReactSlideConfig) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      try {
        const edits = overridesToEdits(config.overrides ?? {});
        let skipped: Array<{ reason: string }> = [];
        if (edits.length > 0) {
          const applied = await applyPageSlideEdits(pdfId, pageNumber, edits);
          setReactCode(applied.code);
          setReactCompiled(applied.compiled);
          skipped = applied.skipped;
        }
        const saved = await savePageReactSlide(pdfId, pageNumber, {
          config: { ...config, overrides: {} },
        });
        setReactConfig(saved.config);
        // A skipped edit means the element it addressed is gone (regenerated, or hand-edited
        // away). Saying so beats letting the change disappear while the panel still shows it.
        setReactMessage(
          skipped.length > 0
            ? t('play.react.savedWithSkipped').replace('{count}', String(skipped.length))
            : t('play.react.saved'),
        );
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.saveFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pageNumber, pdfId, t],
  );

  const handleGenerateReactSlide = useCallback(
    async (prompt: string) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await generatePageReactSlide(pdfId, pageNumber, prompt);
        setReactCode(result.code);
        setReactCompiled(result.compiled);
        setReactConfig(result.config);
        applyRenderType('react');
        setReactMessage(t('play.react.generated'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.generateFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [applyRenderType, pageNumber, pdfId, t],
  );

  /**
   * Add a block of text or a picture to this page (docs/page-overlay-and-fusion.md).
   *
   * On an image page this converts to a React slide first, because that is where an added element
   * can be edited, versioned, and — through baking — reach the exports. The conversion is the
   * caller's decision, made in a dialog that says what it costs; by the time this runs it has been
   * agreed to.
   *
   * The added element goes into the JSX like any other, so from here on it is not "an overlay" —
   * it is part of the slide.
   */
  const handleAddOverlay = useCallback(
    async (input: { text?: string; file?: File; style: Record<string, string>; href?: string }) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        if (currentPage?.render_type !== 'react') {
          // Convert with the page's existing code, or the default skeleton the server returns for
          // a page that has none — no LLM call is involved in becoming a React page.
          const existing = await fetchPageReactSlide(pdfId, pageNumber, shareToken);
          const saved = await savePageReactSlide(pdfId, pageNumber, { code: existing.code });
          setReactCode(saved.code ?? existing.code);
          setReactCompiled(saved.compiled ?? existing.compiled);
          setReactConfig(saved.config);
          applyRenderType('react');
        }
        const edit: SlideEdit = input.file
          ? {
              kind: 'insertImage',
              asset: (await uploadReactSlideAsset(pdfId, pageNumber, input.file)).name,
              style: input.style,
              href: input.href,
            }
          : { kind: 'insertText', text: input.text ?? '', style: input.style, href: input.href };
        const result = await applyPageSlideEdits(pdfId, pageNumber, [edit]);
        setReactCode(result.code);
        setReactCompiled(result.compiled);
        if (result.skipped.length > 0) {
          // Reported, never dropped: an element the user asked for that did not appear needs to be
          // said out loud, not left for them to notice.
          setReactError(result.skipped.map((s) => s.reason).join('; '));
          return false;
        }
        setReactMessage(t('play.react.overlayAdded'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.overlayFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [applyRenderType, currentPage?.render_type, pageNumber, pdfId, shareToken, t],
  );

  /** Make the selected element clickable, or clear its link with an empty href. */
  const handleSetElementLink = useCallback(
    async (id: string, href: string) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await applyPageSlideEdits(pdfId, pageNumber, [{ kind: 'link', id, href }]);
        setReactCode(result.code);
        setReactCompiled(result.compiled);
        if (result.skipped.length > 0) {
          setReactError(result.skipped.map((s) => s.reason).join('; '));
          return false;
        }
        setReactMessage(href ? t('play.react.linkSet') : t('play.react.linkCleared'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.linkFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pageNumber, pdfId, t],
  );

  const handleGenerateReactBackground = useCallback(
    async (prompt: string, overlayOpacity?: number) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await generatePageReactSlideBackground(pdfId, pageNumber, prompt, overlayOpacity);
        setReactConfig(result.config);
        setReactMessage(t('play.react.backgroundGenerated'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.backgroundFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pageNumber, pdfId, t],
  );

  const handleSaveSlideTheme = useCallback(
    async (theme: SlideTheme) => {
      if (!pdfId) return false;
      setReactBusy(true);
      setReactError(null);
      try {
        setSlideTheme(await saveSlideTheme(pdfId, theme));
        setReactMessage(t('play.react.themeSaved'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.themeSaveFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pdfId, t],
  );

  const handleGenerateSlideTheme = useCallback(
    async (prompt: string) => {
      if (!pdfId) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        setSlideTheme(await generateSlideThemeApi(pdfId, prompt));
        setReactMessage(t('play.react.themeGenerated'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.themeGenerateFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pdfId, t],
  );

  /**
   * Fusion: convert back to an image page, with everything added baked into the picture.
   *
   * The server refuses to convert when that bake fails, so this reports failure rather than
   * quietly landing on a page whose picture predates everything the user added. `force` is the
   * user's explicit "convert anyway, I know I lose those changes".
   */
  const handleConvertToPlainSlide = useCallback(
    async (options?: { force?: boolean }) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await deletePageReactSlide(pdfId, pageNumber, options);
        applyRenderType(result.render_type);
        // The page image is what every export reads from now on, so the strip must show the new one.
        await reloadDetail();
        setReactMessage(t('play.react.convertedToSlide'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.convertFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [applyRenderType, pageNumber, pdfId, reloadDetail, t],
  );

  const handleBakeReactSlide = useCallback(async () => {
    if (!pdfId || pageNumber == null) return false;
    setReactBusy(true);
    setReactError(null);
    setReactMessage(null);
    try {
      await bakeReactSlide(pdfId, pageNumber);
      // The page image changed, so the thumbnail strip and cover need the new one.
      await reloadDetail();
      setReactMessage(t('play.react.baked'));
      return true;
    } catch (err) {
      setReactError(errorMessage(err, t('play.react.bakeFailed')));
      return false;
    } finally {
      setReactBusy(false);
    }
  }, [pageNumber, pdfId, reloadDetail, t]);

  const handleExtractText = useCallback(
    async (region: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await extractSlideText(pdfId, pageNumber, region);
        // Swap the background and the text together. They are produced by two different steps —
        // recognition writes the element, the erase repaints the picture — and applying them as
        // they arrive shows the lifted text on top of a background that still has the same words
        // in it. Waiting for the new background to be decoded first makes the change one step.
        if (result.erase === 'done' && result.config.background?.mode === 'image') {
          await preloadImage(reactSlideBackgroundUrl(pdfId, pageNumber, result.config.updated_at));
        }
        setReactConfig(result.config);
        // The recognised text is now an element in the JSX, so the editor has to pick up the new
        // source — otherwise the next save would send back the code from before the extraction.
        if (result.code) setReactCode(result.code);
        if (result.compiled) setReactCompiled(result.compiled);
        if (!result.layer) {
          setReactMessage(t('play.react.extractNoText'));
          return false;
        }
        // The erase is best-effort: say so plainly rather than reporting success while the words
        // are still visible twice on the slide.
        setReactMessage(result.erase === 'failed' ? t('play.react.extractedEraseFailed') : t('play.react.extracted'));
        return true;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.extractFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pageNumber, pdfId, t],
  );

  /**
   * Find every piece of text on the page. The boxes are offered for the user to choose from rather
   * than converted automatically: detection finds all of it, including chart labels that belong to
   * the picture, and an automatic pass would have to be undone one element at a time.
   */
  const handleDetectTextRegions = useCallback(async () => {
    if (!pdfId || pageNumber == null) return [];
    setReactBusy(true);
    setReactError(null);
    setReactMessage(null);
    try {
      const { regions } = await detectSlideTextRegions(pdfId, pageNumber);
      setReactMessage(
        regions.length > 0
          ? t('play.react.detectFound').replace('{count}', String(regions.length))
          : t('play.react.detectNone'),
      );
      return regions;
    } catch (err) {
      setReactError(errorMessage(err, t('play.react.detectFailed')));
      return [];
    } finally {
      setReactBusy(false);
    }
  }, [pageNumber, pdfId, t]);

  /**
   * Lift every selected box in one request.
   *
   * One pass rather than one per box: each box would otherwise recompile the page and rewrite the
   * file, so ten boxes meant ten compiles and ten chances to stop half converted. The background
   * is swapped in only once everything has been written, for the same reason a single extraction
   * waits — the slide should never show lifted text on a background that still contains it.
   */
  const handleExtractTextBatch = useCallback(
    async (regions: Array<{ xPct: number; yPct: number; widthPct: number; heightPct: number }>) => {
      if (!pdfId || pageNumber == null || regions.length === 0) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await extractSlideTextBatch(pdfId, pageNumber, regions);
        if ((result.erase === 'done' || result.erase === 'partial') && result.config.background?.mode === 'image') {
          await preloadImage(reactSlideBackgroundUrl(pdfId, pageNumber, result.config.updated_at));
        }
        setReactConfig(result.config);
        if (result.code) setReactCode(result.code);
        if (result.compiled) setReactCompiled(result.compiled);
        setReactMessage(
          t('play.react.batchExtracted')
            .replace('{added}', String(result.added))
            .replace('{empty}', String(result.empty))
            + (result.erase === 'failed' || result.erase === 'partial' ? ` ${t('play.react.extractedEraseFailed')}` : ''),
        );
        return result.added > 0;
      } catch (err) {
        setReactError(errorMessage(err, t('play.react.extractFailed')));
        return false;
      } finally {
        setReactBusy(false);
      }
    },
    [pageNumber, pdfId, t],
  );

  const handleUndoBackground = useCallback(async () => {
    if (!pdfId || pageNumber == null) return false;
    setReactBusy(true);
    setReactError(null);
    setReactMessage(null);
    try {
      const result = await undoReactSlideBackground(pdfId, pageNumber);
      setReactConfig(result.config);
      setReactMessage(t('play.react.backgroundUndone'));
      return true;
    } catch (err) {
      setReactError(errorMessage(err, t('play.react.backgroundUndoFailed')));
      return false;
    } finally {
      setReactBusy(false);
    }
  }, [pageNumber, pdfId, t]);

  // The page's images, inline, for the sandbox's MS_ASSET. Fetched here rather than loaded by the
  // sandbox itself: it is an opaque origin, so its own requests carry no session and would 403.
  const [reactAssets, setReactAssets] = useState<Record<string, string>>({});
  const [reactCanvas, setReactCanvas] = useState<{ width: number; height: number } | undefined>(undefined);
  useEffect(() => {
    if (!pdfId || pageNumber == null || !shouldLoad) {
      setReactAssets({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const assets = await fetchReactSlideAssets(pdfId, pageNumber, shareToken);
        if (!cancelled) setReactAssets(assets);
      } catch {
        // A page with no assets is the common case and 404s are not worth a banner; a slide whose
        // picture is missing shows the alt-less gap, which is visible on its own.
        if (!cancelled) setReactAssets({});
      }
    })();
    return () => {
      cancelled = true;
    };
    // reactCode changes after an insert, which is exactly when a new asset exists.
  }, [pdfId, pageNumber, shareToken, shouldLoad, reactCode]);

  const reactBackgroundUrl = useMemo(() => {
    if (!pdfId || pageNumber == null) return undefined;
    if (reactConfig.background?.mode !== 'image' || !reactConfig.background.file) return undefined;
    return reactSlideBackgroundUrl(pdfId, pageNumber, reactConfig.updated_at);
  }, [pdfId, pageNumber, reactConfig.background?.mode, reactConfig.background?.file, reactConfig.updated_at]);

  return {
    reactCode,
    setReactCode,
    reactCompiled,
    reactConfig,
    setReactConfig,
    slideTheme,
    setSlideTheme,
    reactBackgroundUrl,
    reactAssets,
    reactCanvas,
    reactBusy,
    reactError,
    reactMessage,
    setReactError,
    reactLoaded,
    handleSaveReactSlide,
    handleSaveReactConfig,
    handleGenerateReactSlide,
    handleGenerateReactBackground,
    handleSaveSlideTheme,
    handleGenerateSlideTheme,
    handleConvertToPlainSlide,
    handleBakeReactSlide,
    handleExtractText,
    handleDetectTextRegions,
    handleExtractTextBatch,
    handleUndoBackground,
    handleAddOverlay,
    handleSetElementLink,
  };
}

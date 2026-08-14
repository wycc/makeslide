import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  applyPageSlideEdits,
  bakeReactSlide,
  deletePageReactSlide,
  extractSlideText,
  undoReactSlideBackground,
  fetchPageReactSlide,
  generatePageReactSlide,
  generatePageReactSlideBackground,
  reactSlideBackgroundUrl,
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
  reactBusy: boolean;
  reactError: string | null;
  reactMessage: string | null;
  setReactError: Dispatch<SetStateAction<string | null>>;
  /** True once the page's data has been loaded at least once for the current page. */
  reactLoaded: boolean;
  handleSaveReactSlide: (code?: string) => Promise<boolean>;
  handleSaveReactConfig: (config: ReactSlideConfig) => Promise<boolean>;
  handleGenerateReactSlide: (prompt: string, keepOverrides: boolean) => Promise<boolean>;
  handleGenerateReactBackground: (prompt: string, overlayOpacity?: number) => Promise<boolean>;
  handleSaveSlideTheme: (theme: SlideTheme) => Promise<boolean>;
  handleGenerateSlideTheme: (prompt: string) => Promise<boolean>;
  handleConvertToPlainSlide: () => Promise<boolean>;
  /** Render this page into its JPG so thumbnails and exports show the React slide. */
  handleBakeReactSlide: () => Promise<boolean>;
  /** Lift the text inside a region out of the background and into a React text layer. */
  handleExtractText: (region: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => Promise<boolean>;
  /** Put back the background from before the last replace/erase. */
  handleUndoBackground: () => Promise<boolean>;
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
    async (prompt: string, keepOverrides: boolean) => {
      if (!pdfId || pageNumber == null) return false;
      setReactBusy(true);
      setReactError(null);
      setReactMessage(null);
      try {
        const result = await generatePageReactSlide(pdfId, pageNumber, prompt, keepOverrides);
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

  const handleConvertToPlainSlide = useCallback(async () => {
    if (!pdfId || pageNumber == null) return false;
    setReactBusy(true);
    setReactError(null);
    setReactMessage(null);
    try {
      const result = await deletePageReactSlide(pdfId, pageNumber);
      applyRenderType(result.render_type);
      setReactMessage(t('play.react.convertedToSlide'));
      return true;
    } catch (err) {
      setReactError(errorMessage(err, t('play.react.convertFailed')));
      return false;
    } finally {
      setReactBusy(false);
    }
  }, [applyRenderType, pageNumber, pdfId, t]);

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
    handleUndoBackground,
  };
}

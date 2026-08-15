import { useEffect, useMemo, useState } from 'react';
import { usePlayPageContext } from './PlayPageContext';
import { useI18n } from '../../i18n';
import {
  SLIDE_THEME_COLOR_TOKENS,
  SLIDE_THEME_TOKEN_KEYS,
  describeOverride,
  type ReactSlideConfig,
  type ReactSlideOverride,
  type SlideThemeTokenKey,
} from '../../lib/reactSlide';
import { ReactSlideElementEditor } from './ReactSlideElementEditor';

/**
 * The editor for React slide pages (docs/react-slide-design.md §10.1).
 *
 * Four things live here, in the order a user actually needs them: describe the page and let the
 * AI write it, restyle the whole deck with a theme, give the page a background, then click
 * individual elements to fix the text and CSS the generator got wrong. The raw code is at the
 * bottom for the cases none of the above covers.
 *
 * Overrides are applied to the live sandbox as they are typed (`setReactConfig`) and only sent to
 * the server on "save", so dragging a value around doesn't write a file per keystroke.
 */
export function ReactSlideTab() {
  const {
    currentPage,
    isReadOnlyProcessing,
    reactCode,
    setReactCode,
    reactConfig,
    setReactConfig,
    slideTheme,
    setSlideTheme,
    reactBusy,
    reactError,
    reactMessage,
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
    imageEditRegion,
    reactInspect,
    setReactInspect,
    reactSelection,
    deleteReactSelection,
    openVersionHistory,
    handleDetectTextRegions,
    setImageEditRegion,
  } = usePlayPageContext();
  const { t } = useI18n();

  const [prompt, setPrompt] = useState('');
  const [keepOverrides, setKeepOverrides] = useState(false);
  const [themePrompt, setThemePrompt] = useState('');
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [showCode, setShowCode] = useState(false);
  // Detected boxes are held here, not in the shared config: they are a suggestion the user picks
  // from, and they stop meaning anything the moment the page's background changes.
  const [detectedRegions, setDetectedRegions] = useState<Array<{ xPct: number; yPct: number; widthPct: number; heightPct: number }>>([]);

  const isReactPage = currentPage?.render_type === 'react';
  const disabled = isReadOnlyProcessing || reactBusy || !currentPage;

  useEffect(() => {
    setPrompt(reactConfig.prompt ?? '');
    setBackgroundPrompt(reactConfig.background?.prompt ?? '');
  }, [reactConfig.prompt, reactConfig.background?.prompt, currentPage?.page_number]);

  const selectedOverride = useMemo(
    () => (reactSelection ? reactConfig.overrides[reactSelection.id] ?? {} : null),
    [reactConfig.overrides, reactSelection],
  );

  function patchConfig(patch: (config: ReactSlideConfig) => ReactSlideConfig): void {
    setReactConfig((prev) => patch(prev));
  }

  function updateOverride(path: string, next: ReactSlideOverride | null): void {
    patchConfig((prev) => {
      const overrides = { ...prev.overrides };
      if (next === null) delete overrides[path];
      else overrides[path] = next;
      return { ...prev, overrides };
    });
  }

  const overrideEntries = Object.entries(reactConfig.overrides ?? {});

  return (
    <div className="space-y-4 text-sm">
      {!isReactPage ? (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
          {t('play.react.notReactPageHint')}
        </p>
      ) : null}

      {/* ── 1. Generate ─────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-muted">{t('play.react.generateTitle')}</h3>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={disabled}
          placeholder={t('play.react.promptPlaceholder')}
          className="w-full rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-text"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || prompt.trim().length === 0}
            onClick={() => void handleGenerateReactSlide(prompt.trim(), keepOverrides)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            ⚛️ {t('play.react.generateButton')}
          </button>
          <label className="flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={keepOverrides}
              onChange={(e) => setKeepOverrides(e.target.checked)}
              disabled={disabled}
            />
            {t('play.react.keepOverrides')}
          </label>
          {isReactPage ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleConvertToPlainSlide()}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted"
            >
              {t('play.react.convertToSlide')}
            </button>
          ) : null}
        </div>
      </section>

      {/* ── 2. Theme ────────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-muted">{t('play.react.themeTitle')}</h3>
        <p className="text-[11px] text-muted">{t('play.react.themeHint')}</p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={themePrompt}
            onChange={(e) => setThemePrompt(e.target.value)}
            disabled={disabled}
            placeholder={t('play.react.themePromptPlaceholder')}
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-text"
          />
          <button
            type="button"
            disabled={disabled || themePrompt.trim().length === 0}
            onClick={() => void handleGenerateSlideTheme(themePrompt.trim())}
            className="rounded-md bg-fuchsia-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            🎨 {t('play.react.generateTheme')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SLIDE_THEME_TOKEN_KEYS.map((token: SlideThemeTokenKey) => (
            <label key={token} className="flex items-center gap-2 text-[11px] text-muted">
              <span className="w-40 shrink-0 font-mono">{token}</span>
              {SLIDE_THEME_COLOR_TOKENS.has(token) ? (
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(slideTheme.tokens[token]) ? slideTheme.tokens[token] : '#000000'}
                  disabled={disabled}
                  onChange={(e) =>
                    setSlideTheme((prev) => ({ ...prev, tokens: { ...prev.tokens, [token]: e.target.value } }))
                  }
                  className="h-6 w-10 rounded border border-border bg-transparent"
                />
              ) : null}
              <input
                type="text"
                value={slideTheme.tokens[token]}
                disabled={disabled}
                onChange={(e) =>
                  setSlideTheme((prev) => ({ ...prev, tokens: { ...prev.tokens, [token]: e.target.value } }))
                }
                className="min-w-0 flex-1 rounded border border-border bg-surface-muted px-1.5 py-1 font-mono text-[11px] text-text"
              />
            </label>
          ))}
        </div>
        <textarea
          value={slideTheme.customCss ?? ''}
          onChange={(e) => setSlideTheme((prev) => ({ ...prev, customCss: e.target.value }))}
          rows={3}
          disabled={disabled}
          placeholder={t('play.react.customCssPlaceholder')}
          className="w-full rounded-md border border-border bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-text"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleSaveSlideTheme(slideTheme)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text"
        >
          {t('play.react.saveTheme')}
        </button>
      </section>

      {/* ── 3. Background ───────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-muted">{t('play.react.backgroundTitle')}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(['none', 'color', 'image'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1 text-muted">
              <input
                type="radio"
                name="react-slide-bg-mode"
                checked={(reactConfig.background?.mode ?? 'none') === mode}
                disabled={disabled}
                onChange={() =>
                  patchConfig((prev) => ({ ...prev, background: { ...prev.background, mode } }))
                }
              />
              {t(`play.react.backgroundMode.${mode}` as 'play.react.backgroundMode.none')}
            </label>
          ))}
        </div>
        {reactConfig.background?.mode === 'color' ? (
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(reactConfig.background.color ?? '') ? reactConfig.background.color! : '#0f172a'}
            disabled={disabled}
            onChange={(e) =>
              patchConfig((prev) => ({ ...prev, background: { ...prev.background, color: e.target.value } }))
            }
            className="h-7 w-14 rounded border border-border bg-transparent"
          />
        ) : null}
        {reactConfig.background?.mode === 'image' ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={backgroundPrompt}
                onChange={(e) => setBackgroundPrompt(e.target.value)}
                disabled={disabled}
                placeholder={t('play.react.backgroundPromptPlaceholder')}
                className="min-w-[12rem] flex-1 rounded-md border border-border bg-surface-muted px-2 py-1.5 text-xs text-text"
              />
              <button
                type="button"
                disabled={disabled || backgroundPrompt.trim().length === 0}
                onClick={() =>
                  void handleGenerateReactBackground(
                    backgroundPrompt.trim(),
                    reactConfig.background?.overlayOpacity,
                  )
                }
                className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                🖼 {t('play.react.generateBackground')}
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              {t('play.react.overlayOpacity')}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={reactConfig.background?.overlayOpacity ?? 0.45}
                disabled={disabled}
                onChange={(e) =>
                  patchConfig((prev) => ({
                    ...prev,
                    background: { ...prev.background, overlayOpacity: Number(e.target.value) },
                  }))
                }
              />
              <span className="font-mono">{(reactConfig.background?.overlayOpacity ?? 0.45).toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              {t('play.react.backgroundFit')}
              <select
                value={reactConfig.background?.fit ?? 'cover'}
                disabled={disabled}
                onChange={(e) =>
                  patchConfig((prev) => ({
                    ...prev,
                    background: { ...prev.background, fit: e.target.value as 'cover' | 'contain' },
                  }))
                }
                className="rounded border border-border bg-surface-muted px-1.5 py-1 text-[11px] text-text"
              >
                <option value="cover">cover</option>
                <option value="contain">contain</option>
              </select>
            </label>
          </div>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleSaveReactConfig(reactConfig)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text"
        >
          {t('play.react.saveBackground')}
        </button>
      </section>

      {/* ── 3a. Image text → React text ─────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-muted">{t('play.react.extractTitle')}</h3>
        <p className="text-[11px] text-muted">{t('play.react.extractHint')}</p>
        <p className="text-[11px] text-muted">
          {imageEditRegion
            ? t('play.react.extractRegion').replace(
                '{region}',
                `${Math.round(imageEditRegion.x * 100)}%, ${Math.round(imageEditRegion.y * 100)}% · ${Math.round(imageEditRegion.w * 100)}×${Math.round(imageEditRegion.h * 100)}%`,
              )
            : t('play.react.extractNoRegion')}
        </p>
        {detectedRegions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {detectedRegions.map((region, i) => (
              <button
                key={`${region.xPct}-${region.yPct}-${i}`}
                type="button"
                disabled={disabled}
                onClick={() => setImageEditRegion({
                  x: region.xPct / 100,
                  y: region.yPct / 100,
                  w: region.widthPct / 100,
                  h: region.heightPct / 100,
                })}
                title={`${region.xPct.toFixed(0)}%, ${region.yPct.toFixed(0)}%`}
                className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text hover:bg-surface-muted disabled:opacity-40"
              >
                {t('play.react.detectPick').replace('{i}', String(i + 1))}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || !isReactPage}
            onClick={() => {
              void handleDetectTextRegions().then(setDetectedRegions);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
          >
            {t('play.react.detectButton')}
          </button>
          <button
            type="button"
            disabled={disabled || !isReactPage || !imageEditRegion}
            onClick={() => {
              if (!imageEditRegion) return;
              void handleExtractText({
                xPct: imageEditRegion.x * 100,
                yPct: imageEditRegion.y * 100,
                widthPct: imageEditRegion.w * 100,
                heightPct: imageEditRegion.h * 100,
              });
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('play.react.extractButton')}
          </button>
          <button
            type="button"
            disabled={disabled || !isReactPage}
            onClick={() => void handleUndoBackground()}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
          >
            ↩ {t('play.react.backgroundUndo')}
          </button>
        </div>
      </section>

      {/* ── 3b. Export image ────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <h3 className="text-xs font-semibold text-muted">{t('play.react.bakeTitle')}</h3>
        <p className="text-[11px] text-muted">{t('play.react.bakeHint')}</p>
        <button
          type="button"
          disabled={disabled || !isReactPage}
          onClick={() => void handleBakeReactSlide()}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
        >
          📸 {t('play.react.bakeButton')}
        </button>
      </section>

      {/* ── 4. Element editing ──────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted">{t('play.react.inspectTitle')}</h3>
          <button
            type="button"
            disabled={!isReactPage}
            onClick={() => setReactInspect((v) => !v)}
            aria-pressed={reactInspect}
            className={`rounded-full border px-3 py-1 text-xs ${
              reactInspect ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-200' : 'border-border text-muted'
            }`}
          >
            {reactInspect ? t('play.react.inspectOn') : t('play.react.inspectOff')}
          </button>
        </div>
        <p className="text-[11px] text-muted">{t('play.react.inspectHint')}</p>

        {reactInspect ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted">
            {t('play.react.inspector.floatingHint')}
          </p>
        ) : reactSelection ? (
          <div className="rounded-md border border-border bg-surface-muted p-2">
            <ReactSlideElementEditor
              selection={reactSelection}
              override={selectedOverride ?? undefined}
              disabled={disabled}
              onChange={(next) => updateOverride(reactSelection.id, next)}
              onDelete={deleteReactSelection}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted">{t('play.react.noSelection')}</p>
        )}

        {overrideEntries.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-muted">
              {t('play.react.overrideList')} ({overrideEntries.length})
            </div>
            {overrideEntries.map(([path, override]) => (
              <div key={path} className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate font-mono">{describeOverride(path, override)}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => updateOverride(path, null)}
                  className="shrink-0 rounded border border-border px-1.5 py-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          disabled={disabled}
          onClick={() => void handleSaveReactConfig(reactConfig)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {t('play.react.saveEdits')}
        </button>
        {/* Edits are written into the code now, so the code's history *is* the undo stack —
            including for a deletion, which leaves nothing on the slide to click back onto. */}
        <button
          type="button"
          disabled={!isReactPage || !currentPage}
          onClick={() => currentPage && void openVersionHistory('react-slide', currentPage.page_number)}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text disabled:opacity-50"
        >
          {t('play.react.history')}
        </button>
      </section>

      {/* ── 5. Raw code ─────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-surface p-3">
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="text-xs font-semibold text-muted underline"
        >
          {showCode ? t('play.react.hideCode') : t('play.react.showCode')}
        </button>
        {showCode ? (
          <>
            <textarea
              value={reactCode}
              onChange={(e) => setReactCode(e.target.value)}
              rows={16}
              disabled={disabled}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface-muted px-2 py-1.5 font-mono text-[11px] text-text"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleSaveReactSlide()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {t('play.react.saveCode')}
            </button>
          </>
        ) : null}
      </section>

      {reactError ? (
        <p className="whitespace-pre-wrap rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {reactError}
        </p>
      ) : null}
      {reactMessage && !reactError ? (
        <p className="text-xs text-emerald-400">{reactMessage}</p>
      ) : null}
    </div>
  );
}

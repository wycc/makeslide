import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { describeRegion, MAX_CUTOUT_REGIONS } from '../../lib/cutoutRegions';

/**
 * "剪下區域" (docs/page-elements.md §9): box parts of the base image, cut them out as figures, have
 * the AI erase them from the picture, and get one overlay-image animation per box so each part
 * can be revealed on the timeline. Lives in the 元素 tab because it edits the base image; the
 * result is continued in the 動畫 tab.
 */
export function CutoutRegionsPanel() {
  const { t } = useI18n();
  const {
    currentPage,
    isReadOnlyProcessing,
    slideBusy,
    setEditTab,
    cutoutMode,
    setCutoutMode,
    cutoutRegions,
    removeCutoutRegion,
    clearCutoutRegions,
    cutoutPrompt,
    setCutoutPrompt,
    cutoutAnimate,
    setCutoutAnimate,
    cutoutBusy,
    cutoutError,
    cutoutResult,
    clearCutoutResult,
    runCutouts,
  } = usePlayPageContext();
  if (!currentPage) return null;
  const disabled = isReadOnlyProcessing || slideBusy || cutoutBusy;
  const toolButton = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';
  const doneCount = cutoutResult?.results.filter((r) => r.status === 'done').length ?? 0;
  const failedCount = cutoutResult ? cutoutResult.results.length - doneCount : 0;

  return (
    <section className="space-y-2 rounded-md border border-orange-300/60 bg-orange-50/60 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-text">✂️ {t('play.cutout.title')}</h3>
        <button
          type="button"
          className={`${toolButton} ${cutoutMode ? 'border-orange-400 bg-orange-100 text-orange-800 dark:border-orange-500/60 dark:bg-orange-500/25 dark:text-orange-100' : ''}`}
          disabled={disabled}
          onClick={() => setCutoutMode(!cutoutMode)}
          aria-pressed={cutoutMode}
        >
          {cutoutMode ? t('play.cutout.stopDrawing') : t('play.cutout.startDrawing')}
        </button>
        {cutoutRegions.length > 0 ? (
          <button type="button" className={toolButton} disabled={disabled} onClick={clearCutoutRegions}>
            {t('play.cutout.clearRegions')}
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-muted">
          {t('play.cutout.count').replace('{count}', String(cutoutRegions.length)).replace('{max}', String(MAX_CUTOUT_REGIONS))}
        </span>
      </div>
      <p className="text-[11px] text-muted">{cutoutMode ? t('play.cutout.drawingHint') : t('play.cutout.description')}</p>

      {cutoutRegions.length > 0 ? (
        <ol className="space-y-1">
          {cutoutRegions.map((r, i) => (
            <li key={`${r.x}-${r.y}-${i}`} className="flex items-center gap-2 text-xs text-text">
              <span className="inline-block w-5 rounded bg-orange-500 text-center text-[10px] font-semibold text-white">{i + 1}</span>
              <span className="font-mono text-[11px]">{describeRegion(r)}</span>
              <button type="button" className="ml-auto text-[11px] text-muted underline hover:text-text disabled:opacity-40" disabled={disabled} onClick={() => removeCutoutRegion(i)}>
                {t('play.cutout.removeRegion')}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <label className="block">
        <span className="text-[11px] text-muted">{t('play.cutout.promptLabel')}</span>
        <input
          type="text"
          value={cutoutPrompt}
          disabled={disabled}
          maxLength={2000}
          placeholder={t('play.cutout.promptPlaceholder')}
          onChange={(e) => setCutoutPrompt(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-text">
        <input type="checkbox" checked={cutoutAnimate} disabled={disabled} onChange={(e) => setCutoutAnimate(e.target.checked)} />
        {t('play.cutout.animateLabel')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || cutoutRegions.length === 0}
          onClick={() => void runCutouts()}
          className="rounded-md border border-orange-500/60 bg-orange-500/20 px-3 py-1.5 text-sm text-orange-800 hover:bg-orange-500/30 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-100"
        >
          {cutoutBusy ? t('play.cutout.running') : t('play.cutout.run').replace('{count}', String(cutoutRegions.length))}
        </button>
        {cutoutError ? <span className="text-xs text-rose-600 dark:text-rose-300">{cutoutError}</span> : null}
      </div>

      {cutoutResult ? (
        <div className="rounded-md border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100">
          <p>
            {t('play.cutout.done').replace('{done}', String(doneCount))}
            {failedCount > 0 ? ` ${t('play.cutout.doneFailed').replace('{failed}', String(failedCount))}` : ''}
          </p>
          {cutoutResult.results.filter((r) => r.status === 'failed').map((r) => (
            <p key={r.index} className="text-rose-700 dark:text-rose-200">#{r.index + 1}: {r.message}</p>
          ))}
          <div className="mt-1 flex gap-2">
            {cutoutResult.render_type === 'gsap-image' ? (
              <button type="button" className="rounded-md border border-fuchsia-400/60 bg-fuchsia-500/15 px-2 py-0.5 text-xs text-fuchsia-800 hover:bg-fuchsia-500/25 dark:text-fuchsia-100" onClick={() => setEditTab('animation')}>
                🎞 {t('play.cutout.goToAnimation')}
              </button>
            ) : null}
            <button type="button" className="text-xs underline" onClick={clearCutoutResult}>{t('play.cutout.dismiss')}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

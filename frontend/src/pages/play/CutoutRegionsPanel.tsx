import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { describeRegion, MAX_CUTOUT_REGIONS } from '../../lib/cutoutRegions';

/**
 * "剪下區域" (docs/page-elements.md §9): one list of the page's regions — the ones already cut out
 * (restore / re-box / hide) and the ones drawn to be cut — edited as a draft and sent in one
 * "套用變更". Lives in the 元素 tab because it edits the base image; timing and position of the
 * reveals are continued in the 動畫 tab.
 */
export function CutoutRegionsPanel() {
  const { t } = useI18n();
  const {
    currentPage,
    isReadOnlyProcessing,
    slideBusy,
    setEditTab,
    existingCutouts,
    showExistingCutouts,
    setShowExistingCutouts,
    pendingRestore,
    toggleRestore,
    recutCutout,
    setCutoutHidden,
    missingEffectCount,
    reattachCutoutEffects,
    pendingChangeCount,
    applyChanges,
    discardChanges,
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
    cutoutDetecting,
    detectCutouts,
    cutoutError,
    cutoutResult,
    clearCutoutResult,
  } = usePlayPageContext();
  if (!currentPage) return null;
  const disabled = isReadOnlyProcessing || slideBusy || cutoutBusy || cutoutDetecting;
  const toolButton = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';
  const smallButton = 'rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40';
  const doneCount = cutoutResult?.results.filter((r) => r.status === 'done').length ?? 0;
  const failedCount = cutoutResult ? cutoutResult.results.length - doneCount : 0;
  const restoredCount = cutoutResult?.restored.filter((r) => r.status !== 'skipped').length ?? 0;

  return (
    <section className="space-y-2 rounded-md border border-orange-300/60 bg-orange-50/60 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-text">✂️ {t('play.cutout.title')}</h3>
        <button
          type="button"
          className={`${toolButton} border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100`}
          disabled={disabled}
          onClick={() => void detectCutouts()}
          title={t('play.cutout.detectTitle')}
        >
          {cutoutDetecting ? t('play.cutout.detecting') : `✨ ${t('play.cutout.detect')}`}
        </button>
        <button
          type="button"
          className={`${toolButton} ${cutoutMode ? 'border-orange-400 bg-orange-100 text-orange-800 dark:border-orange-500/60 dark:bg-orange-500/25 dark:text-orange-100' : ''}`}
          disabled={disabled}
          onClick={() => setCutoutMode(!cutoutMode)}
          aria-pressed={cutoutMode}
        >
          {cutoutMode ? t('play.cutout.stopDrawing') : t('play.cutout.startDrawing')}
        </button>
        <span className="ml-auto text-[11px] text-muted">
          {t('play.cutout.count').replace('{count}', String(cutoutRegions.length)).replace('{max}', String(MAX_CUTOUT_REGIONS))}
        </span>
      </div>
      <p className="text-[11px] text-muted">{cutoutMode ? t('play.cutout.drawingHint') : t('play.cutout.description')}</p>

      {existingCutouts.length > 0 ? (
        <div className="rounded-md border border-fuchsia-300/50 bg-fuchsia-50/60 px-3 py-2 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-text">✂ {t('play.cutout.existingTitle').replace('{count}', String(existingCutouts.length))}</span>
            <label className="flex items-center gap-1 text-[11px] text-text">
              <input type="checkbox" checked={showExistingCutouts} onChange={(e) => setShowExistingCutouts(e.target.checked)} />
              {t('play.cutout.existingShow')}
            </label>
            <button type="button" className="ml-auto rounded-md border border-fuchsia-400/60 bg-fuchsia-500/15 px-2 py-0.5 text-[11px] text-fuchsia-800 hover:bg-fuchsia-500/25 dark:text-fuchsia-100" onClick={() => setEditTab('animation')}>
              🎞 {t('play.cutout.goToAnimation')}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted">{t('play.cutout.existingHint')}</p>
          {missingEffectCount > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-rose-400/60 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-800 dark:text-rose-200">
              <span>{t('play.cutout.missingEffects').replace('{count}', String(missingEffectCount))}</span>
              <button type="button" className={smallButton} disabled={disabled} onClick={() => void reattachCutoutEffects()}>
                {t('play.cutout.reattach')}
              </button>
            </div>
          ) : null}
          <ol className="mt-1 space-y-1">
            {existingCutouts.map((c, i) => {
              const restoring = pendingRestore.has(c.figureId);
              return (
                <li key={c.figureId} className="flex flex-wrap items-center gap-2 text-[11px] text-text">
                  <span className={`inline-block w-5 rounded text-center text-[10px] font-semibold text-white ${restoring ? 'bg-green-600' : 'bg-fuchsia-600'}`}>{i + 1}</span>
                  <img src={c.imageUrl} alt="" className="h-6 w-10 rounded border border-border bg-white object-contain" />
                  <span className="truncate">{c.caption ?? c.figureId}</span>
                  {c.hidden ? <span className="rounded bg-slate-500/20 px-1 text-[10px] text-muted">{t('play.cutout.stateHidden')}</span> : null}
                  {c.missingEffect ? <span className="rounded bg-rose-500/20 px-1 text-[10px] text-rose-800 dark:text-rose-200">{t('play.cutout.stateNoEffect')}</span> : null}
                  {restoring ? <span className="rounded bg-green-500/20 px-1 text-[10px] text-green-800 dark:text-green-200">{t('play.cutout.stateRestoring')}</span> : null}
                  {c.restorable === 'paste-back' ? <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-800 dark:text-amber-200" title={t('play.cutout.pasteBackHint')}>{t('play.cutout.statePasteBack')}</span> : null}
                  <span className="ml-auto font-mono text-muted">{describeRegion(c.box)}</span>
                  <span className="flex gap-1">
                    <button type="button" className={smallButton} disabled={disabled} onClick={() => toggleRestore(c.figureId)} title={t('play.cutout.restoreTitle')}>
                      {restoring ? t('play.cutout.undoRestore') : t('play.cutout.restore')}
                    </button>
                    <button type="button" className={smallButton} disabled={disabled || restoring} onClick={() => recutCutout(c.figureId)} title={t('play.cutout.recutTitle')}>
                      {t('play.cutout.recut')}
                    </button>
                    <button type="button" className={smallButton} disabled={disabled || restoring} onClick={() => void setCutoutHidden(c.figureId, !c.hidden)} title={t('play.cutout.hideTitle')}>
                      {c.hidden ? t('play.cutout.show') : t('play.cutout.hide')}
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {cutoutRegions.length > 0 ? (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text">{t('play.cutout.pendingTitle').replace('{count}', String(cutoutRegions.length))}</span>
            <button type="button" className={smallButton} disabled={disabled} onClick={clearCutoutRegions}>
              {t('play.cutout.clearRegions')}
            </button>
          </div>
          <ol className="mt-1 space-y-1">
            {cutoutRegions.map((r, i) => (
              <li key={`${r.x}-${r.y}-${i}`} className="flex items-center gap-2 text-xs text-text">
                <span className="inline-block w-5 rounded bg-orange-500 text-center text-[10px] font-semibold text-white">{i + 1}</span>
                {r.label ? <span className="truncate">{r.label}</span> : null}
                <span className="font-mono text-[11px] text-muted">{describeRegion(r)}</span>
                <button type="button" className="ml-auto text-[11px] text-muted underline hover:text-text disabled:opacity-40" disabled={disabled} onClick={() => removeCutoutRegion(i)}>
                  {t('play.cutout.removeRegion')}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {cutoutRegions.length > 0 ? (
        <>
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
          {cutoutAnimate ? <p className="text-[11px] text-muted">{t('play.cutout.placementHint')}</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-orange-300/40 pt-2 dark:border-orange-500/20">
        <span className="text-xs text-text">
          {pendingChangeCount > 0 ? t('play.cutout.pendingChanges').replace('{count}', String(pendingChangeCount)) : t('play.cutout.noPendingChanges')}
        </span>
        <button
          type="button"
          disabled={disabled || pendingChangeCount === 0}
          onClick={() => void applyChanges()}
          className="rounded-md border border-orange-500/60 bg-orange-500/20 px-3 py-1.5 text-sm text-orange-800 hover:bg-orange-500/30 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-100"
        >
          {cutoutBusy ? t('play.cutout.running') : t('play.cutout.apply')}
        </button>
        <button type="button" className={toolButton} disabled={disabled || pendingChangeCount === 0} onClick={discardChanges}>
          {t('play.cutout.discard')}
        </button>
        {cutoutError ? <span className="text-xs text-rose-600 dark:text-rose-300">{cutoutError}</span> : null}
      </div>

      {cutoutResult ? (
        <div className="rounded-md border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-100">
          <p>
            {t('play.cutout.applied').replace('{cut}', String(doneCount)).replace('{restored}', String(restoredCount))}
            {failedCount > 0 ? ` ${t('play.cutout.doneFailed').replace('{failed}', String(failedCount))}` : ''}
          </p>
          <ul className="mt-1 space-y-0.5">
            {cutoutResult.results.map((r) =>
              r.status === 'failed' ? (
                <li key={r.index} className="text-rose-700 dark:text-rose-200">#{r.index + 1}: {r.message}</li>
              ) : (
                <li key={r.index} className="text-[11px]">
                  #{r.index + 1}:{' '}
                  {r.reveal === 'immediate'
                    ? t('play.cutout.atStart')
                    : r.line !== null && r.sentence
                      ? t('play.cutout.atSentence').replace('{line}', String(r.line + 1)).replace('{sentence}', r.sentence.length > 40 ? `${r.sentence.slice(0, 40)}…` : r.sentence)
                      : t('play.cutout.atTimeline')}
                  {r.params ? ` · ${t('play.cutout.atPosition').replace('{x}', String(Math.round(r.params.xPct))).replace('{y}', String(Math.round(r.params.yPct))).replace('{w}', String(Math.round(r.params.widthPct)))}` : ''}
                </li>
              ),
            )}
          </ul>
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

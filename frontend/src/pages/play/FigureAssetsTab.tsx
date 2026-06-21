import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { fetchPageFigures, savePageFigureSelection } from '../../lib/api';
import { createSequentialQueue } from '../../lib/saveQueue';
import type { PageFigure } from '../../types';
import { usePlayPageContext } from './PlayPageContext';

export function FigureAssetsTab() {
  const { pdfId, currentPage, currentShareToken, withShareToken, isReadOnlyProcessing } = usePlayPageContext();
  const { t } = useI18n();
  const [figures, setFigures] = useState<PageFigure[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);

  const pageNumber = currentPage?.page_number;

  // 同一頁面的兩次儲存呼叫各自帶著「當下完整的排除清單」，若連續切換兩個圖表的勾選狀態，
  // 較早送出但較慢回應的請求可能在較晚送出但較快回應的請求之後才落地，悄悄把後一次操作蓋掉；
  // 用 `createSequentialQueue` 把同一頁的儲存呼叫排成依序執行，確保送出順序＝落地順序。
  const saveQueueRef = useRef(createSequentialQueue<string[]>(async () => undefined));
  useEffect(() => {
    saveQueueRef.current = createSequentialQueue<string[]>(async (excludedIds) => {
      if (!pdfId || !pageNumber) return;
      await savePageFigureSelection(pdfId, pageNumber, excludedIds);
    });
  }, [pdfId, pageNumber]);

  useEffect(() => {
    if (!pdfId || !pageNumber) {
      setFigures(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPageFigures(pdfId, pageNumber, currentShareToken)
      .then((res) => {
        if (!cancelled) setFigures(res.figures);
      })
      .catch(() => {
        if (!cancelled) setError(t('play.figures.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, currentShareToken, t]);

  const toggleExcluded = async (figure: PageFigure) => {
    if (!pdfId || !pageNumber || !figures || isReadOnlyProcessing || savingBatch) return;
    const previous = figures;
    const updated = figures.map((f) => (f.id === figure.id ? { ...f, excluded: !f.excluded } : f));
    setFigures(updated);
    setSavingId(figure.id);
    setError(null);
    try {
      await saveQueueRef.current(updated.filter((f) => f.excluded).map((f) => f.id));
    } catch {
      setFigures(previous);
      setError(t('play.figures.saveError'));
    } finally {
      setSavingId(null);
    }
  };

  const saveAllFigures = async (excluded: boolean) => {
    if (!pdfId || !pageNumber || !figures || isReadOnlyProcessing || savingBatch || savingId) return;
    const previous = figures;
    const updated = figures.map((figure) => ({ ...figure, excluded }));
    setFigures(updated);
    setSavingBatch(true);
    setError(null);
    try {
      await saveQueueRef.current(updated.filter((figure) => figure.excluded).map((figure) => figure.id));
    } catch {
      setFigures(previous);
      setError(t('play.figures.saveError'));
    } finally {
      setSavingBatch(false);
    }
  };

  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-slate-300">
        📊 {t('play.figures.title')}（第 {pageNumber ?? '-'} 頁）
      </h2>
      <p className="mb-3 text-xs text-slate-400">{t('play.figures.description')}</p>
      {loading ? (
        <p className="text-sm text-slate-400">{t('play.figures.loading')}</p>
      ) : !figures || figures.length === 0 ? (
        error ? (
          <p className="text-sm text-rose-300">{error}</p>
        ) : (
          <p className="text-sm text-slate-500">{t('play.figures.empty')}</p>
        )
      ) : (
        <>
          {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-sky-700/70 px-2 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-500 hover:bg-sky-950/60 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isReadOnlyProcessing || savingBatch || Boolean(savingId)}
              onClick={() => void saveAllFigures(false)}
            >
              {t('play.figures.useAll')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-700 px-2 py-1 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800/70 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isReadOnlyProcessing || savingBatch || Boolean(savingId)}
              onClick={() => void saveAllFigures(true)}
            >
              {t('play.figures.excludeAll')}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {figures.map((figure) => (
              <div
                key={figure.id}
                className={`rounded-md border p-2 ${
                  figure.excluded ? 'border-slate-800 bg-slate-900/30 opacity-60' : 'border-slate-700 bg-slate-900/60'
                }`}
              >
                <img
                  src={withShareToken(figure.image_url) ?? figure.image_url}
                  alt={figure.caption ?? figure.id}
                  className="mb-2 max-h-40 w-full rounded border border-slate-800 bg-slate-950 object-contain"
                />
                <p className="mb-1 line-clamp-3 text-xs text-slate-300">
                  {figure.caption ?? figure.context ?? t('play.figures.noCaption')}
                </p>
                <div className="mb-2 flex items-center gap-1">
                  <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {figure.source === 'vector' ? t('play.figures.sourceVector') : t('play.figures.sourceRaster')}
                  </span>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-500"
                    checked={!figure.excluded}
                    disabled={isReadOnlyProcessing || savingBatch || savingId === figure.id}
                    onChange={() => void toggleExcluded(figure)}
                  />
                  {t('play.figures.useAsReference')}
                </label>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

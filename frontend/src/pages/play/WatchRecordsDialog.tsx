import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { fetchWatchProgressDetails, ApiError, type WatchProgressDetailRecord } from '../../lib/api';
import {
  groupWatchRecordsByViewer,
  watchRecordListenedPercent,
  formatWatchDuration,
} from '../../lib/watchProgress';
import { useOverlayDismiss } from '../../components/useOverlayDismiss';

interface WatchRecordsDialogProps {
  pdfId: string | undefined;
  /** 指定頁碼時只顯示單張投影片的觀看記錄；null 則顯示整份簡報、每位使用者各頁。 */
  page: number | null;
  onClose: () => void;
}

/**
 * 「觀看記錄」視窗：以使用者為單位列出每位觀眾各頁的觀看情形（聆聽時間、完整度、是否看完）。
 * 由投影片管理的「觀看記錄」按鈕（整份）或單張投影片綠色徽章（單頁，帶 page）開啟。
 */
export function WatchRecordsDialog({ pdfId, page, onClose }: WatchRecordsDialogProps) {
  const { t } = useI18n();
  const { onBackdropClick } = useOverlayDismiss(onClose);
  const formatMessage = (key: Parameters<typeof t>[0], values: Record<string, string | number>) =>
    interpolateTemplate(t(key), values);

  const [records, setRecords] = useState<WatchProgressDetailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pdfId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const rows = await fetchWatchProgressDetails(pdfId, page ?? undefined);
        if (!cancelled) setRecords(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t('play.watchRecords.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, page, t]);

  const viewers = groupWatchRecordsByViewer(records);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('play.watchRecords.title')}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-100">
            👁 {t('play.watchRecords.title')}
            {page != null ? (
              <span className="ml-2 text-sm font-normal text-slate-400">
                {t('play.common.pagePrefix')}{page}{t('play.common.pageSuffix')}
              </span>
            ) : (
              <span className="ml-2 text-sm font-normal text-slate-400">{t('play.watchRecords.allSlides')}</span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.watchRecords.close')}
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-slate-400">{t('play.watchRecords.loading')}</p>
          ) : viewers.length === 0 ? (
            <p className="text-sm text-slate-400">{t('play.watchRecords.empty')}</p>
          ) : (
            viewers.map((viewer) => (
              <section key={viewer.viewer_id} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="truncate text-sm font-medium text-cyan-200">{viewer.viewer_id}</h4>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {formatMessage('play.watchRecords.viewerSummary', {
                      pages: viewer.records.length,
                      completed: viewer.records.filter((r) => r.completed).length,
                    })}
                  </span>
                </div>
                <div className="overflow-hidden rounded-md border border-slate-700">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800/60 text-slate-400">
                      <tr>
                        <th className="px-2 py-1 font-normal">{t('play.watchRecords.colPage')}</th>
                        <th className="px-2 py-1 font-normal">{t('play.watchRecords.colListened')}</th>
                        <th className="px-2 py-1 font-normal">{t('play.watchRecords.colCompletion')}</th>
                        <th className="px-2 py-1 text-center font-normal">{t('play.watchRecords.colDone')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewer.records.map((r) => {
                        const pct = watchRecordListenedPercent(r.listened_ms, r.duration_ms);
                        return (
                          <tr key={`${viewer.viewer_id}-${r.page_number}`} className="border-t border-slate-800 text-slate-200">
                            <td className="px-2 py-1">
                              {t('play.common.pagePrefix')}{r.page_number}{t('play.common.pageSuffix')}
                            </td>
                            <td className="px-2 py-1 font-mono text-slate-300">{formatWatchDuration(r.listened_ms)}</td>
                            <td className="px-2 py-1 font-mono text-slate-300">{pct == null ? '—' : `${pct}%`}</td>
                            <td className="px-2 py-1 text-center">
                              {r.completed ? (
                                <span className="text-emerald-300">✓</span>
                              ) : (
                                <span className="text-slate-600">–</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

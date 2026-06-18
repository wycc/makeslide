import { imageVersionUrl, type FileVersionEntry } from '../../lib/api';
import { useI18n } from '../../i18n';

interface VersionHistoryDialogProps {
  pdfId: string | undefined;
  versionHistoryType: 'image' | 'script';
  versionHistoryPage: number | null;
  versionHistoryEntries: FileVersionEntry[];
  versionHistoryLoading: boolean;
  versionPreviewHash: string | null;
  versionPreviewScript: string | null;
  versionRestoring: boolean;
  versionError: string | null;
  isReadOnlyProcessing: boolean;
  onClose: () => void;
  onPreview: (hash: string) => void;
  onRestore: () => void;
}

export function VersionHistoryDialog({
  pdfId,
  versionHistoryType,
  versionHistoryPage,
  versionHistoryEntries,
  versionHistoryLoading,
  versionPreviewHash,
  versionPreviewScript,
  versionRestoring,
  versionError,
  isReadOnlyProcessing,
  onClose,
  onPreview,
  onRestore,
}: VersionHistoryDialogProps) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="flex w-full max-w-5xl flex-col rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl" style={{ maxHeight: '90vh' }}>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">
          {versionHistoryType === 'image' ? t('play.versionHistory.titleImage') : t('play.versionHistory.titleScript')}
          {versionHistoryPage != null ? t('play.versionHistory.pageSuffix').replace('{page}', String(versionHistoryPage)) : ''}
        </h3>
        {versionError ? (
          <p className="mb-2 text-xs text-rose-400">{versionError}</p>
        ) : null}
        <div className="flex flex-1 gap-3 overflow-hidden">
          <div className="w-64 flex-shrink-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950">
            {versionHistoryLoading ? (
              <p className="p-3 text-xs text-slate-400">{t('play.versionHistory.loading')}</p>
            ) : versionHistoryEntries.length === 0 ? (
              <p className="p-3 text-xs text-slate-400">{t('play.versionHistory.empty')}</p>
            ) : (
              versionHistoryEntries.map((entry) => (
                <button
                  key={entry.hash}
                  type="button"
                  onClick={() => void onPreview(entry.hash)}
                  className={`w-full border-b border-slate-800 px-3 py-2 text-left text-xs hover:bg-slate-800 ${versionPreviewHash === entry.hash ? 'bg-slate-800 text-emerald-300' : 'text-slate-300'}`}
                >
                  <div className="font-mono text-[10px] text-slate-500">{entry.hash.slice(0, 7)}</div>
                  <div className="mt-0.5 truncate">{entry.message}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {new Date(entry.date).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="flex flex-1 flex-col items-center justify-center overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2">
            {versionPreviewHash == null ? (
              <p className="text-xs text-slate-500">{t('play.versionHistory.selectPrompt')}</p>
            ) : versionHistoryType === 'image' && pdfId && versionHistoryPage != null ? (
              <img
                src={`${imageVersionUrl(pdfId, versionHistoryPage, versionPreviewHash)}?t=${Date.now()}`}
                alt={t('play.versionHistory.imageAlt')}
                className="max-h-[55vh] w-auto rounded"
              />
            ) : versionHistoryType === 'script' ? (
              versionPreviewScript != null ? (
                <pre className="h-full w-full overflow-auto whitespace-pre-wrap p-3 text-xs text-slate-200">{versionPreviewScript}</pre>
              ) : (
                <p className="text-xs text-slate-500">{t('play.versionHistory.loading')}</p>
              )
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            {t('play.versionHistory.close')}
          </button>
          <button
            type="button"
            disabled={versionPreviewHash == null || versionRestoring || isReadOnlyProcessing}
            onClick={() => void onRestore()}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {versionRestoring ? t('play.versionHistory.restoring') : t('play.versionHistory.restore')}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { useNarrationRecorder } from '../../hooks/useNarrationRecorder';
import { getNarration, narrationAudioUrl, deleteNarration, type NarrationInfo } from '../../lib/api/pdfs';
import { slideAtTime } from '../../lib/slideTimeline';

// 簡報旁白（MVP）：擁有者/協作者可錄講者旁白（錄音 + 記錄翻頁），任何可讀者可播放——
// 播放時依時間軸自動翻到對應頁。
export function NarrationPanel() {
  const { t } = useI18n();
  const { pdfId, detail, currentPage, deckPages, currentIdx, setCurrentIdx } = usePlayPageContext();
  const canRecord = Boolean(detail?.is_owner || detail?.visibility === 'public_editable');

  const [info, setInfo] = useState<NarrationInfo | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const reload = useCallback(() => {
    if (!pdfId) return;
    void getNarration(pdfId).then(setInfo).catch(() => setInfo({ exists: false }));
  }, [pdfId]);

  useEffect(() => { reload(); }, [reload]);

  const recorder = useNarrationRecorder(pdfId, currentPage?.page_number ?? null, reload);

  // 播放時依目前秒數自動翻頁。
  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !info || !info.exists) return;
    const page = slideAtTime(info.segments, audio.currentTime * 1000);
    if (page == null) return;
    const idx = deckPages.findIndex((p) => p.page_number === page);
    if (idx >= 0 && idx !== currentIdx) setCurrentIdx(idx);
  }, [info, deckPages, currentIdx, setCurrentIdx]);

  const handleDelete = useCallback(() => {
    if (!pdfId) return;
    void deleteNarration(pdfId).then(() => setInfo({ exists: false })).catch(() => { /* ignore */ });
  }, [pdfId]);

  if (!recorder.supported && !info?.exists) {
    // 無錄音能力且無既有旁白可播 → 不顯示面板。
    if (!canRecord) return null;
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className="mb-2 text-sm font-semibold text-text">{t('play.narration.title')}</h2>

      {recorder.error === 'mic' && <p className="mb-2 text-xs text-rose-600 dark:text-rose-300">{t('play.narration.micError')}</p>}
      {recorder.error === 'save' && <p className="mb-2 text-xs text-rose-600 dark:text-rose-300">{t('play.narration.saveError')}</p>}

      {/* 播放既有旁白 */}
      {info?.exists && !recorder.recording && (
        <div className="mb-2">
          <p className="mb-1 text-[11px] text-muted">{t('play.narration.syncHint')}</p>
          <audio
            ref={audioRef}
            src={pdfId ? narrationAudioUrl(pdfId) : undefined}
            controls
            onTimeUpdate={handleTimeUpdate}
            className="w-full"
          />
        </div>
      )}
      {info && !info.exists && !recorder.recording && !recorder.saving && (
        <p className="mb-2 text-xs text-muted">{t('play.narration.none')}</p>
      )}

      {/* 錄製控制（擁有者/協作者） */}
      {canRecord && (
        <div className="flex flex-wrap items-center gap-2">
          {recorder.recording ? (
            <>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />{t('play.narration.recording')}
              </span>
              <button
                type="button"
                onClick={() => void recorder.stopAndSave()}
                className="rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-200"
              >
                {t('play.narration.stopSave')}
              </button>
              <button
                type="button"
                onClick={recorder.cancelRecording}
                className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs text-text hover:bg-border"
              >
                {t('play.narration.cancel')}
              </button>
            </>
          ) : recorder.saving ? (
            <span className="text-xs text-muted">{t('play.narration.saving')}</span>
          ) : recorder.supported ? (
            <>
              <button
                type="button"
                onClick={() => void recorder.startRecording()}
                className="rounded-md border border-indigo-500/60 bg-indigo-500/15 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-200"
              >
                {info?.exists ? t('play.narration.rerecord') : t('play.narration.record')}
              </button>
              {info?.exists && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 hover:bg-rose-500/20 dark:text-rose-200"
                >
                  {t('play.narration.delete')}
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-muted">{t('play.narration.unsupported')}</span>
          )}
        </div>
      )}
    </section>
  );
}

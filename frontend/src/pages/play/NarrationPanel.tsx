import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';
import { useNarrationRecorder } from '../../hooks/useNarrationRecorder';
import {
  getNarration,
  narrationSegmentAudioUrl,
  deleteNarrationSegment,
  reorderNarrationSegments,
  transcribeNarrationSegment,
  updateNarrationTranscript,
  type NarrationSegment,
} from '../../lib/api/pdfs';
import { slideAtTime } from '../../lib/slideTimeline';
import { cursorAtTime, drawingSnapshotAtTime, subtitleAtTime } from '../../lib/narrationTracks';
import { ApiError } from '../../lib/api';

// 簡報旁白（分段）：擁有者/協作者可分段錄音，每段可重錄/刪除/上下移；段列表顯示每段用過的
// 頁面。任何可讀者可逐段播放——播放時依該段時間軸自動翻頁。
export function NarrationPanel() {
  const { t } = useI18n();
  const { pdfId, detail, currentPage, deckPages, currentIdx, setCurrentIdx, setNarrationCapture, setNarrationOverlay, setNarrationSubtitle } = usePlayPageContext();
  const canRecord = Boolean(detail?.is_owner || detail?.visibility === 'public_editable');

  const [segments, setSegments] = useState<NarrationSegment[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [syncedPage, setSyncedPage] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const reload = useCallback(() => {
    if (!pdfId) return;
    void getNarration(pdfId).then((r) => setSegments(r.segments)).catch(() => setSegments([]));
  }, [pdfId]);
  useEffect(() => { reload(); }, [reload]);

  const recorder = useNarrationRecorder(pdfId, currentPage?.page_number ?? null, reload);

  // 錄音期間，讓投影片外框把游標移動、原生畫筆快照送進 recorder。
  useEffect(() => {
    if (recorder.recording) setNarrationCapture({ active: true, onCursorMove: recorder.onCursorMove, onDrawSnapshot: recorder.onDrawSnapshot });
    else setNarrationCapture({ active: false, onCursorMove: null, onDrawSnapshot: null });
    return () => setNarrationCapture({ active: false, onCursorMove: null, onDrawSnapshot: null });
  }, [recorder.recording, recorder.onCursorMove, recorder.onDrawSnapshot, setNarrationCapture]);

  const goToPage = useCallback((page: number) => {
    const idx = deckPages.findIndex((p) => p.page_number === page);
    if (idx >= 0 && idx !== currentIdx) setCurrentIdx(idx);
  }, [deckPages, currentIdx, setCurrentIdx]);

  const playing = segments?.find((s) => s.id === playingId) ?? null;
  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    const ms = audio.currentTime * 1000;
    const page = slideAtTime(playing.slide_timeline, ms);
    if (page != null) { goToPage(page); setSyncedPage(page); }
    // 重播：把當下游標與畫面快照送進 context，由投影片面板繪出（游標＝十字、畫筆＝唯讀 DrawingCanvas）。
    setNarrationOverlay({ cursor: cursorAtTime(playing.cursor_track, ms), drawing: drawingSnapshotAtTime(playing.draw_snapshots, ms) });
    // 同步字幕：有逐字時間戳就用滾動字幕，否則退回當頁逐字稿。顯示於投影片上取代原字幕。
    const sub = playing.word_cues.length > 0
      ? subtitleAtTime(playing.word_cues, ms)
      : (page != null ? (playing.transcript_by_page[String(page)] ?? '') : '');
    setNarrationSubtitle(sub || null);
  }, [playing, goToPage, setNarrationOverlay, setNarrationSubtitle]);

  // 沒有在播放時清掉重播疊加與字幕。
  useEffect(() => {
    if (!playingId) { setNarrationOverlay(null); setNarrationSubtitle(null); }
  }, [playingId, setNarrationOverlay, setNarrationSubtitle]);

  // 播放中、目前頁的逐字稿（T5 同步顯示）。
  const syncedTranscript = playing && syncedPage != null ? (playing.transcript_by_page[String(syncedPage)] ?? '') : '';

  // 切到某段：跳到該段第一頁後，由下方 effect 在 src 更新後開始播放。
  const startSegment = useCallback((seg: NarrationSegment) => {
    if (seg.pages[0] != null) goToPage(seg.pages[0]);
    setPlayingId(seg.id);
  }, [goToPage]);

  // playingId 改變即載入新音檔並播放（比 setTimeout 穩健）。
  useEffect(() => {
    if (!playingId) return;
    const audio = audioRef.current;
    if (audio) { audio.load(); void audio.play().catch(() => { /* 使用者手動播放即可 */ }); }
  }, [playingId]);

  const playSegment = useCallback((seg: NarrationSegment) => {
    setPlayAll(false);
    startSegment(seg);
  }, [startSegment]);

  const playAllFromStart = useCallback(() => {
    if (!segments || segments.length === 0) return;
    setPlayAll(true);
    startSegment(segments[0]!);
  }, [segments, startSegment]);

  // 一段播完：連播模式下自動接下一段，否則停止。
  const handleEnded = useCallback(() => {
    if (!playAll || !segments) { setPlayingId(null); return; }
    const idx = segments.findIndex((s) => s.id === playingId);
    const next = segments[idx + 1];
    if (next) startSegment(next);
    else { setPlayAll(false); setPlayingId(null); }
  }, [playAll, segments, playingId, startSegment]);

  const handleDelete = useCallback((segId: string) => {
    if (!pdfId) return;
    void deleteNarrationSegment(pdfId, segId).then(reload).catch(() => { /* ignore */ });
  }, [pdfId, reload]);

  const move = useCallback((index: number, delta: number) => {
    if (!pdfId || !segments) return;
    const next = [...segments];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSegments(next);
    void reorderNarrationSegments(pdfId, next.map((s) => s.id)).then(reload).catch(reload);
  }, [pdfId, segments, reload]);

  if (segments == null) return null; // 尚未載入
  if (!canRecord && segments.length === 0) return null; // 觀看者且無旁白 → 不顯示

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{t('play.narration.title')}</h2>
        {canRecord && !recorder.recording && !recorder.saving && recorder.supported && (
          <button
            type="button"
            onClick={() => void recorder.startRecording(null)}
            className="rounded-md border border-indigo-500/60 bg-indigo-500/15 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-200"
          >
            {t('play.narration.addSegment')}
          </button>
        )}
      </div>

      {recorder.error === 'mic' && <p className="mb-2 text-xs text-rose-600 dark:text-rose-300">{t('play.narration.micError')}</p>}
      {recorder.error === 'save' && <p className="mb-2 text-xs text-rose-600 dark:text-rose-300">{t('play.narration.saveError')}</p>}
      {canRecord && !recorder.supported && <p className="mb-2 text-xs text-muted">{t('play.narration.unsupported')}</p>}

      {recorder.recording && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-rose-300/60 bg-rose-500/10 px-2 py-1.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            {recorder.targetSegmentId ? t('play.narration.reRecording') : t('play.narration.recording')}
          </span>
          <button type="button" onClick={() => void recorder.stopAndSave()} className="rounded-md border border-emerald-500/60 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-200">
            {t('play.narration.stopSave')}
          </button>
          <button type="button" onClick={recorder.cancelRecording} className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs text-text hover:bg-border">
            {t('play.narration.cancel')}
          </button>
          <span className="w-full text-[11px] text-muted">
            {t('play.narration.captureHint')}
            <span className="ml-1 font-mono text-text">🖱 {recorder.captureCounts.cursor} · ✏ {recorder.captureCounts.strokes}</span>
          </span>
        </div>
      )}
      {recorder.saving && <p className="mb-2 text-xs text-muted">{t('play.narration.saving')}</p>}

      {segments.length === 0 && !recorder.recording && !recorder.saving && (
        <p className="text-xs text-muted">{t('play.narration.none')}</p>
      )}

      {segments.length > 0 && (
        <>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">{t('play.narration.syncHint')}</p>
            {segments.length > 1 && (
              <button
                type="button"
                onClick={playAllFromStart}
                className={`rounded border px-2 py-0.5 text-[11px] font-medium ${playAll ? 'border-emerald-400 bg-emerald-500/20 text-emerald-700 dark:text-emerald-200' : 'border-cyan-500/50 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-200'}`}
              >
                ▶ {t('play.narration.playAll')}
              </button>
            )}
          </div>
          <ol className="space-y-1.5">
            {segments.map((seg, i) => (
              <li key={seg.id} className="rounded-md border border-border bg-surface-muted/50 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text">
                    {t('play.narration.segmentLabel').replace('{n}', String(i + 1))}
                    <span className="ml-2 font-normal text-muted">
                      {t('play.narration.pages').replace('{pages}', seg.pages.join(', ') || '—')} · {Math.round(seg.duration_ms / 1000)}s
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedId((cur) => (cur === seg.id ? null : seg.id))}
                      className={`rounded border px-1.5 py-0.5 text-[11px] ${expandedId === seg.id ? 'border-amber-400 bg-amber-500/20 text-amber-700 dark:text-amber-200' : 'border-border bg-surface text-text hover:bg-border'}`}
                    >
                      📝 {t('play.narration.transcript')}
                    </button>
                    <button
                      type="button"
                      onClick={() => playSegment(seg)}
                      className={`rounded border px-1.5 py-0.5 text-[11px] ${playingId === seg.id ? 'border-emerald-400 bg-emerald-500/20 text-emerald-700 dark:text-emerald-200' : 'border-border bg-surface text-text hover:bg-border'}`}
                    >
                      ▶ {t('play.narration.play')}
                    </button>
                  </div>
                </div>
                {canRecord && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-text disabled:opacity-30">▲</button>
                    <button type="button" disabled={i === segments.length - 1} onClick={() => move(i, 1)} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:text-text disabled:opacity-30">▼</button>
                    <button type="button" disabled={recorder.recording || recorder.saving} onClick={() => void recorder.startRecording(seg.id)} className="rounded border border-indigo-400/50 px-1.5 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-500/10 disabled:opacity-40 dark:text-indigo-300">{t('play.narration.reRecordSeg')}</button>
                    <button type="button" onClick={() => handleDelete(seg.id)} className="rounded border border-rose-400/50 px-1.5 py-0.5 text-[11px] text-rose-700 hover:bg-rose-500/10 dark:text-rose-300">{t('play.narration.deleteSegment')}</button>
                  </div>
                )}
                {expandedId === seg.id && (
                  <SegmentTranscriptEditor seg={seg} canEdit={canRecord} pdfId={pdfId} onJumpToPage={goToPage} onSaved={reload} />
                )}
              </li>
            ))}
          </ol>
          <audio
            ref={audioRef}
            src={pdfId && playingId ? narrationSegmentAudioUrl(pdfId, playingId) : undefined}
            controls
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            className="mt-2 w-full"
          />
          {playing && syncedTranscript && (
            <p className="mt-1 rounded-md border border-border bg-surface-muted/60 px-2 py-1.5 text-xs leading-relaxed text-text">
              {syncedTranscript}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// 逐段逐頁的逐字稿編輯器（T6）：每頁一個 textarea，聚焦時自動跳到該頁；可一鍵語音轉文字。
function SegmentTranscriptEditor({
  seg,
  canEdit,
  pdfId,
  onJumpToPage,
  onSaved,
}: {
  seg: NarrationSegment;
  canEdit: boolean;
  pdfId: string | undefined;
  onJumpToPage: (page: number) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...seg.transcript_by_page }));
  const [busy, setBusy] = useState<'transcribe' | 'save' | null>(null);
  const [status, setStatus] = useState<'ok' | 'fail' | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const transcribe = async () => {
    if (!pdfId) return;
    setBusy('transcribe');
    setStatus(null);
    setErrMsg(null);
    try {
      const r = await transcribeNarrationSegment(pdfId, seg.id);
      setDraft({ ...r.transcript_by_page });
      onSaved();
    } catch (err) {
      setStatus('fail');
      setErrMsg(err instanceof ApiError ? err.message : null);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!pdfId) return;
    setBusy('save');
    setStatus(null);
    try {
      await updateNarrationTranscript(pdfId, seg.id, draft);
      setStatus('ok');
      onSaved();
    } catch {
      setStatus('fail');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border border-amber-300/40 bg-amber-500/5 p-2">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy !== null} onClick={() => void transcribe()} className="rounded border border-violet-400/50 px-2 py-0.5 text-[11px] text-violet-700 hover:bg-violet-500/10 disabled:opacity-40 dark:text-violet-300">
            {busy === 'transcribe' ? t('play.narration.transcribing') : t('play.narration.transcribe')}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void save()} className="rounded border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-40 dark:text-emerald-200">
            {busy === 'save' ? '…' : t('play.narration.saveTranscript')}
          </button>
          {status === 'ok' && <span className="text-[11px] text-emerald-600 dark:text-emerald-300">✓</span>}
          {status === 'fail' && <span className="text-[11px] text-rose-600 dark:text-rose-300">{errMsg ?? t('play.narration.transcribeError')}</span>}
        </div>
      )}
      {seg.pages.length === 0 && <p className="text-[11px] text-muted">—</p>}
      {seg.pages.map((page) => (
        <label key={page} className="block">
          <span className="text-[11px] text-muted">{t('play.narration.pageLabel').replace('{n}', String(page))}</span>
          <textarea
            value={draft[String(page)] ?? ''}
            readOnly={!canEdit}
            onFocus={() => onJumpToPage(page)}
            onChange={(e) => setDraft((d) => ({ ...d, [String(page)]: e.target.value }))}
            rows={2}
            className="mt-0.5 w-full resize-y rounded border border-border bg-surface px-2 py-1 text-xs text-text focus:border-primary focus:outline-none"
          />
        </label>
      ))}
    </div>
  );
}

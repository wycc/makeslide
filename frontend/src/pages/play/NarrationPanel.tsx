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
import { cursorAtTime, drawingSnapshotForPage, drawingSnapshotAtTime, subtitleAtTime, audioCueAtTime } from '../../lib/narrationTracks';
import { ApiError } from '../../lib/api';

// 簡報旁白（分段）：擁有者/協作者可分段錄音，每段可重錄/刪除/上下移；段列表顯示每段用過的
// 頁面。任何可讀者可逐段播放——播放時依該段時間軸自動翻頁。
export function NarrationPanel() {
  const { t } = useI18n();
  const { pdfId, detail, currentPage, deckPages, currentIdx, setCurrentIdx, setNarrationCapture, setNarrationOverlay, setNarrationSubtitle, setNarrationPlaying, isPlaying, audioRef, scripts, withShareToken } = usePlayPageContext();
  const canRecord = Boolean(detail?.is_owner || detail?.visibility === 'public_editable');

  const [segments, setSegments] = useState<NarrationSegment[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [syncedPage, setSyncedPage] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  // 重播時用來播放「錄音當下講者播過的原有 TTS」，與旁白音檔獨立。
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  // 目前正在播放的 TTS 區間（以 startMs 識別），避免每次 timeupdate 重新載入。
  const activeCueStartRef = useRef<number | null>(null);

  const reload = useCallback(() => {
    if (!pdfId) return;
    void getNarration(pdfId).then((r) => setSegments(r.segments)).catch(() => setSegments([]));
  }, [pdfId]);
  useEffect(() => { reload(); }, [reload]);

  const recorder = useNarrationRecorder(pdfId, currentPage?.page_number ?? null, reload);

  // 一律把 recorder 的擷取函式提供出去（它們內部以 recordingRef 自我把關，非錄音期間呼叫即 no-op）。
  // 不用單一 active 旗標來開關 handler，避免旗標與實際錄音狀態不同步導致擷取失效。
  useEffect(() => {
    setNarrationCapture({ active: recorder.recording, onCursorMove: recorder.onCursorMove, onDrawSnapshot: recorder.onDrawSnapshot });
    return () => setNarrationCapture({ active: false, onCursorMove: null, onDrawSnapshot: null });
  }, [recorder.recording, recorder.onCursorMove, recorder.onDrawSnapshot, setNarrationCapture]);

  const goToPage = useCallback((page: number) => {
    const idx = deckPages.findIndex((p) => p.page_number === page);
    if (idx >= 0 && idx !== currentIdx) setCurrentIdx(idx);
  }, [deckPages, currentIdx, setCurrentIdx]);

  const playing = segments?.find((s) => s.id === playingId) ?? null;

  // 停掉重播中的 TTS（旁白暫停/結束/離開區間時）。
  const stopTts = useCallback(() => {
    const tts = ttsAudioRef.current;
    if (tts && !tts.paused) tts.pause();
    activeCueStartRef.current = null;
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const audio = narrationAudioRef.current;
    if (!audio || !playing) return;
    const ms = audio.currentTime * 1000;
    const page = slideAtTime(playing.slide_timeline, ms);
    if (page != null) { goToPage(page); setSyncedPage(page); }
    // 重播：把當下游標與畫面快照送進 context，由投影片面板繪出（游標＝十字、畫筆＝唯讀 DrawingCanvas）。
    // 畫筆以「當前頁」為單位取快照，避免沒畫東西的新頁殘留上一頁的筆畫；無頁碼舊資料退回不分頁行為。
    const drawing = page != null
      ? drawingSnapshotForPage(playing.draw_snapshots, ms, page)
      : drawingSnapshotAtTime(playing.draw_snapshots, ms);
    setNarrationOverlay({ cursor: cursorAtTime(playing.cursor_track, ms), drawing });

    // 錄音當下講者播過的原有 TTS：於該區間同步播放該頁語音。
    const cue = audioCueAtTime(playing.audio_cues, ms);
    const tts = ttsAudioRef.current;
    if (tts) {
      if (cue) {
        if (activeCueStartRef.current !== cue.startMs) {
          // 進入新的一段 TTS：載入該頁音檔並對齊播放位置。
          activeCueStartRef.current = cue.startMs;
          const rawUrl = deckPages.find((p) => p.page_number === cue.page)?.audio_url ?? null;
          const url = rawUrl ? (withShareToken(rawUrl) ?? rawUrl) : null;
          if (url) {
            tts.src = url;
            tts.currentTime = cue.fromSec + Math.max(0, (ms - cue.startMs) / 1000);
            void tts.play().catch(() => { /* 自動播放被擋則略過 */ });
          }
        }
      } else if (activeCueStartRef.current !== null) {
        stopTts();
      }
    }

    // 同步字幕：TTS 區間內顯示該頁逐字稿（一般播放字幕）；否則用旁白逐字稿（有時間戳用滾動字幕）。
    const sub = cue
      ? (scripts[cue.page] ?? playing.transcript_by_page[String(cue.page)] ?? '')
      : playing.word_cues.length > 0
        ? subtitleAtTime(playing.word_cues, ms)
        : (page != null ? (playing.transcript_by_page[String(page)] ?? '') : '');
    setNarrationSubtitle(sub || null);
  }, [playing, goToPage, setNarrationOverlay, setNarrationSubtitle, deckPages, withShareToken, scripts, stopTts]);

  // 沒有在播放時清掉重播疊加與字幕，並停掉 TTS。播放中則標記 narrationPlaying（隱藏投影片上原有已存標註）。
  useEffect(() => {
    setNarrationPlaying(!!playingId);
    if (!playingId) { setNarrationOverlay(null); setNarrationSubtitle(null); stopTts(); }
    return () => setNarrationPlaying(false);
  }, [playingId, setNarrationOverlay, setNarrationSubtitle, setNarrationPlaying, stopTts]);

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
    const audio = narrationAudioRef.current;
    if (audio) { audio.load(); void audio.play().catch(() => { /* 使用者手動播放即可 */ }); }
  }, [playingId]);

  // 錄音期間偵測講者是否正在播放原有 TTS：isPlaying/換頁時開關 TTS 區間（fromSec 取主播放器目前秒數）。
  useEffect(() => {
    if (!recorder.recording) return;
    if (isPlaying && currentPage) recorder.ttsPlayStart(currentPage.page_number, audioRef.current?.currentTime ?? 0);
    else recorder.ttsPlayStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording, isPlaying, currentPage?.page_number]);

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
            ref={narrationAudioRef}
            src={pdfId && playingId ? narrationSegmentAudioUrl(pdfId, playingId) : undefined}
            controls
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => { stopTts(); handleEnded(); }}
            onPause={stopTts}
            className="mt-2 w-full"
          />
          {/* 重播「錄音當下播過的原有 TTS」，與旁白音檔獨立、不顯示控制列。 */}
          <audio ref={ttsAudioRef} className="hidden" />
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

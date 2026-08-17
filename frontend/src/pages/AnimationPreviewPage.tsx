import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SlideRenderer } from '../components/slide/SlideRenderer';
import { fetchPageAnimation, fetchPdfDetail } from '../lib/api';
import { resolveAnimationSpec } from '../lib/animationSpec';
import { buildSentenceTimeline, estimateNarrationSeconds, splitScriptIntoSentences } from '../lib/subtitles';
import { previewClockAt, previewDurationSeconds, specForSingleEffect } from './preview/animationPreview';
import type { PdfDetailPage, SlideAnimationSpec } from '../types';

/**
 * `#/preview/:id?page=N` — one page's animation and nothing else.
 *
 * The play page cannot serve this purpose: it carries a header, panels, controls and playback
 * state, all of which land in a screenshot and get in the way of driving it from a script. Here the
 * only thing on screen is the slide, so a Playwright screenshot is of the animation, and `?effect=`
 * can isolate one effect out of a page that has twenty.
 *
 * Playback is driven by a plain rAF clock rather than the audio element: the preview never plays
 * narration, and tying it to `<audio>` would reintroduce autoplay policies and a missing-file
 * failure mode into the one place that is supposed to just show the animation.
 */
export function AnimationPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const pageNumber = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const effectId = searchParams.get('effect')?.trim() || null;
  const shareToken = searchParams.get('share')?.trim() || '';
  const loop = searchParams.get('loop') === '1';
  const paused = searchParams.get('autoplay') === '0';
  // Off by default: "show nothing but the animation" is the point. `?hud=1` brings back the clock
  // when you are trying to say *when* something goes wrong.
  const showHud = searchParams.get('hud') === '1';

  const [page, setPage] = useState<PdfDetailPage | null>(null);
  const [rawSpec, setRawSpec] = useState<SlideAnimationSpec | null>(null);
  const [script, setScript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchPdfDetail(id, shareToken || undefined);
        const target = detail.pages.find((item) => item.page_number === pageNumber) ?? null;
        if (!target) throw new Error(`第 ${pageNumber} 頁不存在（這份簡報共 ${detail.pages.length} 頁）`);
        const animation = await fetchPageAnimation(id, pageNumber, shareToken || undefined);
        // The transcript is only needed to place transcript-anchored effects; a page without one
        // simply has nothing to anchor to.
        const scriptText = target.script_url
          ? await fetch(target.script_url).then((r) => (r.ok ? r.text() : '')).catch(() => '')
          : '';
        if (cancelled) return;
        setPage(target);
        setRawSpec(animation.spec ?? null);
        setScript(scriptText);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, pageNumber, shareToken]);

  // No narration here, so effects anchored to transcript sentences are placed on the estimated
  // reading-time timeline — the same fallback the player uses for a page without audio.
  const spec = useMemo(() => {
    const sentences = splitScriptIntoSentences(script);
    const timeline = buildSentenceTimeline(sentences, estimateNarrationSeconds(sentences));
    return specForSingleEffect(resolveAnimationSpec(rawSpec, timeline), effectId);
  }, [rawSpec, script, effectId]);

  const duration = previewDurationSeconds(spec);

  useEffect(() => {
    setTime(0);
    setFinished(false);
  }, [spec, paused]);

  useEffect(() => {
    if (paused || !(duration > 0)) return;
    const startedAt = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const state = previewClockAt((now - startedAt) / 1000, duration, loop);
      setTime(state.time);
      setFinished(state.finished);
      if (!state.finished) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [duration, loop, paused]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6 text-center text-sm text-rose-300">
        {error}
      </div>
    );
  }
  if (!page) {
    return <div className="flex min-h-screen items-center justify-center bg-black text-sm text-slate-500">…</div>;
  }
  if (effectId && !spec) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6 text-center text-sm text-amber-300">
        這一頁沒有 id 為 {effectId} 的效果。
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-black">
      <SlideRenderer
        renderType={page.render_type}
        spec={spec}
        pageKey={`${id}:${pageNumber}:${effectId ?? 'all'}`}
        currentTime={time}
        isPlaying={!paused && !finished}
        playbackRate={1}
        src={page.image_url ?? ''}
        alt={`第 ${pageNumber} 頁`}
        wrapperClassName="relative inline-block"
        wrapperStyle={{ maxHeight: '100vh' }}
        imgStyle={{ maxHeight: '100vh', maxWidth: '100vw', objectFit: 'contain' }}
        pdfId={id}
        pageNumber={pageNumber}
      />
      {showHud ? (
        <div className="pointer-events-none fixed bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-[11px] text-slate-300">
          {time.toFixed(2)} / {duration.toFixed(2)}s　效果 {spec?.effects.length ?? 0}
          {finished ? '　done' : ''}
        </div>
      ) : null}
      {/* A stable hook for automation: wait for [data-preview-state="done"] instead of a sleep. */}
      <div data-preview-state={finished ? 'done' : 'playing'} data-preview-time={time.toFixed(2)} hidden />
    </div>
  );
}

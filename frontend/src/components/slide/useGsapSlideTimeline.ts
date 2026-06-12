import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { gsap } from 'gsap';
import type { SlideAnimationSpec } from '../../types';
import { hasPlayableAnimation } from '../../lib/animationSpec';
import { buildGsapTimeline } from './buildGsapTimeline';

// The audio element only fires timeupdate ~4 times/sec, so the timeline is
// driven by play/pause and we only seek when audio and timeline drift apart
// (covers scrubbing, follower sync and mid-page entry without jitter).
const DRIFT_TOLERANCE_SECONDS = 0.3;

interface UseGsapSlideTimelineOptions {
  stageRef: RefObject<HTMLDivElement>;
  spec: SlideAnimationSpec | null;
  /** Changes whenever the displayed page changes; forces a timeline rebuild. */
  pageKey: string;
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  onError?: () => void;
}

export function useGsapSlideTimeline({
  stageRef,
  spec,
  pageKey,
  currentTime,
  isPlaying,
  playbackRate,
  onError,
}: UseGsapSlideTimelineOptions): { animationFailed: boolean } {
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const [animationFailed, setAnimationFailed] = useState(false);

  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // 換頁時重置失敗狀態，讓下一頁有機會重新嘗試動畫
  useEffect(() => {
    setAnimationFailed(false);
  }, [pageKey]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || animationFailed || !hasPlayableAnimation(spec)) {
      return;
    }
    let tl: gsap.core.Timeline | null = null;
    try {
      gsap.set(stage, { clearProps: 'all' });
      tl = buildGsapTimeline(stage, spec);
      timelineRef.current = tl;
      tl.timeScale(playbackRateRef.current > 0 ? playbackRateRef.current : 1);
      tl.seek(Math.min(currentTimeRef.current, tl.duration()), false);
      if (isPlayingRef.current) tl.play();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[slide-animation] failed to build timeline, falling back to static image', err);
      try {
        tl?.kill();
        gsap.set(stage, { clearProps: 'all' });
      } catch {
        /* best-effort cleanup */
      }
      timelineRef.current = null;
      setAnimationFailed(true);
      onErrorRef.current?.();
      return;
    }
    return () => {
      timelineRef.current = null;
      tl?.kill();
      // stage 可能已被 React 卸載；clearProps 避免殘留 transform 影響下一頁
      try {
        gsap.set(stage, { clearProps: 'all' });
      } catch {
        /* ignore */
      }
    };
  }, [stageRef, spec, pageKey, animationFailed]);

  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (isPlaying) tl.play();
    else tl.pause();
  }, [isPlaying, spec, pageKey]);

  useEffect(() => {
    timelineRef.current?.timeScale(playbackRate > 0 ? playbackRate : 1);
  }, [playbackRate]);

  useEffect(() => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (Math.abs(tl.time() - currentTime) > DRIFT_TOLERANCE_SECONDS) {
      tl.seek(Math.min(currentTime, tl.duration()), false);
    }
  }, [currentTime]);

  // 將目前播放時間/狀態同步給每個 custom-script 效果的 sandboxed iframe，
  // 讓其內部動畫可依 `t`（自該效果淡入起算的秒數）更新畫面。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !spec) return;
    for (const effect of spec.effects) {
      if (effect.type !== 'custom-script') continue;
      const iframe = stage.querySelector<HTMLIFrameElement>(`[data-effect-id="${effect.id}"]`);
      const win = iframe?.contentWindow;
      if (!win) continue;
      const t = Math.max(0, currentTime - effect.start);
      win.postMessage({ type: 'sync', t, playing: isPlaying }, '*');
    }
  }, [stageRef, spec, pageKey, currentTime, isPlaying]);

  return { animationFailed };
}

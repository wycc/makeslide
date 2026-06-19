import { gsap } from 'gsap';
import type { SlideAnimationEffect, SlideAnimationSpec } from '../../types';

function panDistance(effect: SlideAnimationEffect): number {
  const d = effect.params?.distancePct;
  return typeof d === 'number' && Number.isFinite(d) ? d : 3;
}

/**
 * `from`/`to` GSAP vars for a whole-slide transform effect's entrance tween
 * (`from` is also the "reverted" state used when `exitDuration` is set).
 * Returns `null` for non-transform effect types (overlay effects).
 */
function transformFromTo(effect: SlideAnimationEffect): { from: Record<string, number>; to: Record<string, number> } | null {
  switch (effect.type) {
    case 'fade-in':
      return { from: { autoAlpha: 0 }, to: { autoAlpha: 1 } };
    case 'zoom-in':
      return { from: { scale: effect.params?.fromScale ?? 1 }, to: { scale: effect.params?.toScale ?? 1.08 } };
    case 'zoom-out':
      return { from: { scale: effect.params?.fromScale ?? 1.08 }, to: { scale: effect.params?.toScale ?? 1 } };
    case 'pan-left': {
      const d = panDistance(effect);
      return { from: { xPercent: d }, to: { xPercent: -d } };
    }
    case 'pan-right': {
      const d = panDistance(effect);
      return { from: { xPercent: -d }, to: { xPercent: d } };
    }
    case 'pan-up': {
      const d = panDistance(effect);
      return { from: { yPercent: d }, to: { yPercent: -d } };
    }
    case 'pan-down': {
      const d = panDistance(effect);
      return { from: { yPercent: -d }, to: { yPercent: d } };
    }
    default:
      return null;
  }
}

/**
 * Builds a paused GSAP timeline from a whitelisted-preset spec. Only the
 * effect types/eases the backend validator accepts are handled here; the
 * spec never carries raw GSAP vars.
 */
export function buildGsapTimeline(stage: HTMLElement, spec: SlideAnimationSpec): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true, defaults: { overwrite: 'auto' } });

  gsap.set(stage, {
    autoAlpha: 1,
    scale: 1,
    xPercent: 0,
    yPercent: 0,
    transformOrigin: 'center center',
  });

  for (const effect of spec.effects) {
    const common = { duration: effect.duration, ease: effect.ease };
    const transform = transformFromTo(effect);
    if (transform) {
      const { from, to } = transform;
      tl.fromTo(stage, from, { ...to, ...common }, effect.start);
      if (effect.exitDuration !== undefined) {
        // 對稱的「消失（恢復原狀）」：以相同的 duration/ease 動畫回到進場前的狀態。
        tl.to(stage, { ...from, ...common }, effect.start + effect.duration + effect.exitDuration);
      }
      continue;
    }
    switch (effect.type) {
      case 'highlight-box': {
        const overlay = stage.querySelector<HTMLElement>(`[data-effect-id="${effect.id}"]`);
        if (overlay) {
          tl.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, ...common }, effect.start);
          if (effect.highlightPulse) {
            const hColor = effect.highlightColor ?? '#ef4444';
            const hBw = effect.highlightBorderWidth ?? 4;
            const hOuter = effect.highlightOuterColor;
            const normalShadow = hOuter
              ? `0 0 0 2px ${hOuter}, 0 0 ${hBw * 4}px ${hColor}b3`
              : `0 0 ${hBw * 4}px ${hColor}b3`;
            const pulseShadow = hOuter
              ? `0 0 0 4px ${hOuter}, 0 0 ${hBw * 10}px ${hColor}`
              : `0 0 ${hBw * 10}px ${hColor}`;
            tl.fromTo(
              overlay,
              { boxShadow: normalShadow },
              { boxShadow: pulseShadow, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1 },
              effect.start + effect.duration,
            );
          }
          if (effect.exitDuration !== undefined) {
            tl.to(overlay, { autoAlpha: 0, ...common }, effect.start + effect.duration + effect.exitDuration);
          }
        }
        break;
      }
      case 'pointer': {
        const overlay = stage.querySelector<HTMLElement>(`[data-effect-id="${effect.id}"]`);
        if (overlay) {
          tl.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: effect.pointerOpacity ?? 1, ...common }, effect.start);
          if (effect.pointerPulse) {
            const isDot = (effect.pointerShape ?? 'arrow') === 'dot';
            const pulseScale = isDot ? 1.3 : 1.15;
            tl.fromTo(
              overlay,
              { scale: 1, transformOrigin: '50% 50%' },
              { scale: pulseScale, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 },
              effect.start + effect.duration,
            );
          }
          if (effect.exitDuration !== undefined) {
            tl.to(overlay, { autoAlpha: 0, scale: 1, ...common }, effect.start + effect.duration + effect.exitDuration);
          }
        }
        break;
      }
      case 'spotlight':
      case 'text-callout':
      case 'shape':
      case 'overlay-image':
      case 'formula':
      case 'custom-script': {
        const overlay = stage.querySelector<HTMLElement>(`[data-effect-id="${effect.id}"]`);
        if (overlay) {
          if (effect.type === 'custom-script') {
            // custom-script 不套用淡入：自訂動畫應從一開始就完全可見，由其內部腳本自行控制畫面呈現。
            tl.set(overlay, { autoAlpha: 1 }, effect.start);
          } else {
            tl.fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, ...common }, effect.start);
          }
          if (effect.exitDuration !== undefined) {
            tl.to(overlay, { autoAlpha: 0, ...common }, effect.start + effect.duration + effect.exitDuration);
          }
        }
        break;
      }
      case 'pause-playback': {
        const overlay = stage.querySelector<HTMLElement>(`[data-effect-id="${effect.id}"]`);
        if (overlay) {
          tl.fromTo(overlay, { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, ...common }, effect.start);
          if (effect.exitDuration !== undefined) {
            tl.to(overlay, { autoAlpha: 0, scale: 0.98, ...common }, effect.start + effect.duration + effect.exitDuration);
          }
        }
        break;
      }
      case 'step-list': {
        const overlay = stage.querySelector<HTMLElement>(`[data-effect-id="${effect.id}"]`);
        if (overlay) {
          // 容器本身立即可見；每個項目各自做交錯淡入，總長度為 effect.duration。
          tl.set(overlay, { autoAlpha: 1 }, effect.start);
          const items = overlay.querySelectorAll<HTMLElement>('li');
          if (items.length > 0) {
            const stagger = effect.duration / items.length;
            tl.fromTo(
              items,
              { autoAlpha: 0, x: -8 },
              { autoAlpha: 1, x: 0, duration: stagger, ease: effect.ease, stagger },
              effect.start,
            );
          }
          if (effect.exitDuration !== undefined) {
            tl.to(overlay, { autoAlpha: 0, ...common }, effect.start + effect.duration + effect.exitDuration);
          }
        }
        break;
      }
    }
  }

  return tl;
}

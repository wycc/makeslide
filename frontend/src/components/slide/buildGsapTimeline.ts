import { gsap } from 'gsap';
import type { SlideAnimationEffect, SlideAnimationSpec } from '../../types';

function panDistance(effect: SlideAnimationEffect): number {
  const d = effect.params?.distancePct;
  return typeof d === 'number' && Number.isFinite(d) ? d : 3;
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
    switch (effect.type) {
      case 'fade-in':
        tl.fromTo(stage, { autoAlpha: 0 }, { autoAlpha: 1, ...common }, effect.start);
        break;
      case 'zoom-in':
        tl.fromTo(
          stage,
          { scale: effect.params?.fromScale ?? 1 },
          { scale: effect.params?.toScale ?? 1.08, ...common },
          effect.start,
        );
        break;
      case 'zoom-out':
        tl.fromTo(
          stage,
          { scale: effect.params?.fromScale ?? 1.08 },
          { scale: effect.params?.toScale ?? 1, ...common },
          effect.start,
        );
        break;
      case 'pan-left': {
        const d = panDistance(effect);
        tl.fromTo(stage, { xPercent: d }, { xPercent: -d, ...common }, effect.start);
        break;
      }
      case 'pan-right': {
        const d = panDistance(effect);
        tl.fromTo(stage, { xPercent: -d }, { xPercent: d, ...common }, effect.start);
        break;
      }
      case 'pan-up': {
        const d = panDistance(effect);
        tl.fromTo(stage, { yPercent: d }, { yPercent: -d, ...common }, effect.start);
        break;
      }
      case 'pan-down': {
        const d = panDistance(effect);
        tl.fromTo(stage, { yPercent: -d }, { yPercent: d, ...common }, effect.start);
        break;
      }
      case 'highlight-box':
      case 'spotlight':
      case 'text-callout':
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
    }
  }

  return tl;
}

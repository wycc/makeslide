import type { ExistingCutout } from '../../pages/play/usePageCutouts';

/**
 * Shows the regions already cut out of this page (docs/page-elements.md §9.8) while editing: the
 * base image no longer contains them (they were erased), and during playback they only appear
 * when their animation fires, so without this the slide looks like pieces went missing. Each
 * figure is drawn where its overlay effect shows it, with a numbered dashed outline. Passive —
 * it never takes the pointer.
 */
export function CutoutFiguresPreview({ cutouts }: { cutouts: ExistingCutout[] }) {
  if (cutouts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="cutout-figures-preview">
      {cutouts.map((c, i) => (
        <div
          key={c.figureId}
          className="absolute"
          style={{
            left: `${c.box.x * 100}%`,
            top: `${c.box.y * 100}%`,
            width: `${c.box.w * 100}%`,
            height: `${c.box.h * 100}%`,
            outline: '2px dashed rgba(217, 70, 239, 0.9)',
            outlineOffset: -1,
            boxSizing: 'border-box',
          }}
          title={c.caption ?? undefined}
        >
          <img src={c.imageUrl} alt={c.caption ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          <span className="absolute left-0 top-0 rounded-br bg-fuchsia-600 px-1 text-[10px] font-semibold leading-4 text-white">✂ {i + 1}</span>
        </div>
      ))}
    </div>
  );
}

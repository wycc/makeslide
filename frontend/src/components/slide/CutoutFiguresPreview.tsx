import type { ExistingCutout } from '../../pages/play/usePageCutouts';

/**
 * Draws the regions already cut out of this page while editing (docs/page-elements.md §9.9): the
 * base image no longer contains them and during playback they only appear when their animation
 * fires, so without this the slide looks like pieces went missing. Each figure is shown where its
 * overlay effect shows it; one marked for restoring is shown back at its origin with a green
 * outline (a fast, approximate stand-in for what 套用 will do exactly); hidden ones are faded.
 * Passive — it never takes the pointer.
 */
export function CutoutFiguresPreview({ cutouts, pendingRestore }: { cutouts: ExistingCutout[]; pendingRestore: ReadonlySet<string> }) {
  if (cutouts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="cutout-figures-preview">
      {cutouts.map((c, i) => {
        const restoring = pendingRestore.has(c.figureId);
        const box = restoring ? c.origin : c.box;
        return (
          <div
            key={c.figureId}
            className="absolute"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              outline: restoring ? '2px solid rgba(34, 197, 94, 0.95)' : '2px dashed rgba(217, 70, 239, 0.9)',
              outlineOffset: -1,
              boxSizing: 'border-box',
              opacity: c.hidden && !restoring ? 0.35 : 1,
            }}
            title={c.caption ?? undefined}
          >
            <img src={c.imageUrl} alt={c.caption ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: restoring ? 'fill' : 'contain', display: 'block' }} />
            <span className={`absolute left-0 top-0 rounded-br px-1 text-[10px] font-semibold leading-4 text-white ${restoring ? 'bg-green-600' : 'bg-fuchsia-600'}`}>
              {restoring ? '↩' : '✂'} {i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

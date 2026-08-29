import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { fetchOverlayPreflight, type OverlayPreflight } from '../../lib/api';

interface AddOverlayDialogProps {
  pdfId: string;
  pageNumber: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { text?: string; file?: File; style: Record<string, string>; href?: string }) => void;
}

/**
 * Where an added element lands by default: lower-left, in from the edge.
 *
 * A fixed spot rather than a guess at empty space — the slide's content is a picture we cannot
 * read, so any "smart" placement would be a guess dressed up as a decision. Lower-left is the
 * least likely to sit on a title, and the element can be dragged and restyled the moment it exists.
 */
const DEFAULT_TEXT_STYLE: Record<string, string> = {
  position: 'absolute',
  left: '8%',
  top: '78%',
  'max-width': '50%',
  'font-size': '40px',
  'font-weight': '600',
  color: 'var(--slide-fg)',
  'white-space': 'pre-wrap',
};

const DEFAULT_IMAGE_STYLE: Record<string, string> = {
  position: 'absolute',
  left: '8%',
  top: '70%',
  width: '20%',
  height: 'auto',
};

/**
 * Add a piece of text or a picture to the current page (docs/page-overlay-and-fusion.md).
 *
 * On an image page this is also the conversion dialog, which is why it opens with a preflight
 * request: the three things the user needs to know before converting (that the page becomes a
 * React slide, that its animations stop playing, and whether this server can bake at all) are all
 * facts about *this* page on *this* deployment, and none of them are visible from the UI.
 */
export function AddOverlayDialog({ pdfId, pageNumber, busy, error, onClose, onSubmit }: AddOverlayDialogProps) {
  const { t } = useI18n();
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [href, setHref] = useState('');
  const [preflight, setPreflight] = useState<OverlayPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchOverlayPreflight(pdfId, pageNumber);
        if (!cancelled) setPreflight(result);
      } catch {
        if (!cancelled) setPreflightError(t('play.addOverlay.preflightFailed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfId, pageNumber, t]);

  const converting = preflight != null && preflight.render_type !== 'react';
  // Baking is what carries an added element into every export, so a deployment that cannot bake
  // must not be able to enter React mode at all — see design doc §3.2. Pages that are already
  // React slides are unaffected: they are past this gate.
  const blocked = preflight != null && converting && !preflight.bake_available;
  const canSubmit =
    !busy && !blocked && preflight != null && (kind === 'text' ? text.trim().length > 0 : file != null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-4 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-text">{t('play.addOverlay.title')}</h3>

        <div className="mb-3 flex gap-2">
          {(['text', 'image'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              disabled={busy}
              className={`rounded border px-3 py-1.5 text-sm disabled:opacity-40 ${
                kind === value
                  ? 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border text-text hover:bg-surface-muted'
              }`}
            >
              {value === 'text' ? t('play.addOverlay.kindText') : t('play.addOverlay.kindImage')}
            </button>
          ))}
        </div>

        {kind === 'text' ? (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('play.addOverlay.textLabel')}</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              rows={3}
              placeholder={t('play.addOverlay.textPlaceholder')}
              className="w-full rounded border border-border bg-surface-muted p-2 text-sm text-text"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">{t('play.addOverlay.imageLabel')}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-text"
            />
            <span className="mt-1 block text-[11px] text-muted">{t('play.addOverlay.imageHint')}</span>
          </label>
        )}

        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-muted">{t('play.addOverlay.linkLabel')}</span>
          <input
            type="url"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            disabled={busy}
            placeholder={t('play.addOverlay.linkPlaceholder')}
            className="w-full rounded border border-border bg-surface-muted p-2 text-sm text-text"
          />
          <span className="mt-1 block text-[11px] text-muted">{t('play.addOverlay.linkHint')}</span>
        </label>

        {/* The consequences of converting, stated before it happens rather than discovered after. */}
        {converting ? (
          <div className="mt-3 space-y-2">
            <p className="rounded border border-border bg-surface-muted p-2 text-[11px] text-muted">
              {t('play.addOverlay.convertNotice')}
            </p>
            {preflight.animation_effect_count > 0 ? (
              <p className="rounded border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
                {t('play.addOverlay.animationWarning').replace(
                  '{count}',
                  String(preflight.animation_effect_count),
                )}
              </p>
            ) : null}
            {blocked ? (
              <p className="rounded border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">
                {t('play.addOverlay.bakeUnavailable')}
                {preflight.bake_reason ? <span className="mt-1 block opacity-80">{preflight.bake_reason}</span> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {preflightError ? <p className="mt-2 text-xs text-danger">{preflightError}</p> : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-muted disabled:opacity-40"
          >
            {t('play.addOverlay.cancel')}
          </button>
          <button
            type="button"
            onClick={() =>
              onSubmit({
                text: kind === 'text' ? text : undefined,
                file: kind === 'image' ? (file ?? undefined) : undefined,
                style: kind === 'text' ? DEFAULT_TEXT_STYLE : DEFAULT_IMAGE_STYLE,
                href: href.trim() || undefined,
              })
            }
            disabled={!canSubmit}
            className="rounded border border-primary/50 bg-primary/15 px-3 py-1.5 text-sm text-primary disabled:opacity-40"
          >
            {t('play.addOverlay.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

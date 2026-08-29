import { useI18n } from '../../i18n';

interface FusionFailedDialogProps {
  /** What the server said went wrong, shown verbatim: it is usually the actionable part. */
  message: string;
  busy: boolean;
  onRetry: () => void;
  onForce: () => void;
  onClose: () => void;
}

/**
 * The fusion bake failed, so the page is still a React slide — what now?
 *
 * The server deliberately refuses to convert in this case (docs/page-overlay-and-fusion.md §3.3):
 * converting anyway shows the picture the page had *before* anything was added, and everything the
 * user put on the slide disappears with only a log line to say why. So the choice is theirs, and
 * the destructive option is spelled out rather than being what happens by default.
 */
export function FusionFailedDialog({ message, busy, onRetry, onForce, onClose }: FusionFailedDialogProps) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-4 shadow-2xl">
        <h3 className="mb-1 text-sm font-semibold text-text">{t('play.fusion.title')}</h3>
        <p className="mb-2 text-xs text-muted">{t('play.fusion.description')}</p>
        <p className="mb-3 rounded border border-danger/40 bg-danger/10 p-2 text-[11px] text-danger">{message}</p>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="w-full rounded border border-primary/50 bg-primary/15 px-3 py-2 text-sm text-primary disabled:opacity-40"
          >
            {t('play.fusion.retry')}
          </button>
          <button
            type="button"
            onClick={onForce}
            disabled={busy}
            className="w-full rounded border border-danger/50 px-3 py-2 text-left text-sm text-danger disabled:opacity-40"
          >
            <span className="block">{t('play.fusion.force')}</span>
            <span className="mt-0.5 block text-[11px] opacity-80">{t('play.fusion.forceHint')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-full rounded border border-border px-3 py-2 text-sm text-text hover:bg-surface-muted disabled:opacity-40"
          >
            {t('play.fusion.stay')}
          </button>
        </div>
      </div>
    </div>
  );
}

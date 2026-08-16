import { useMemo } from 'react';
import { useI18n } from '../../i18n';
import { countChangedLines, diffLines } from '../../lib/textDiff';

interface ScriptPatchDialogProps {
  page: number;
  instruction: string;
  original: string;
  proposed: string;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}

/**
 * Review a script the tutor is offering, before any of it is written.
 *
 * A diff rather than the new text on its own: "here is a better script" is impossible to check
 * without seeing what it changed, and a script is the one artifact whose wording the user has
 * usually already tuned. Applying is a deliberate second click — see docs/tutor-edit-tools.md §5.
 */
export function ScriptPatchDialog({
  page,
  instruction,
  original,
  proposed,
  busy,
  onApply,
  onClose,
}: ScriptPatchDialogProps) {
  const { t } = useI18n();
  const lines = useMemo(() => diffLines(original, proposed), [original, proposed]);
  const changed = countChangedLines(lines);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-surface p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-text">
          {t('play.tutorProposal.scriptTitle').replace('{page}', String(page))}
        </h3>
        <p className="mt-1 text-xs text-muted">{instruction}</p>
        <p className="mt-1 text-[11px] text-muted">
          {t('play.tutorProposal.changedLines').replace('{count}', String(changed))}
        </p>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded border border-border bg-surface-muted">
          <table className="w-full border-collapse font-mono text-[12px]">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={`${line.op}-${i}`}
                  className={
                    line.op === 'added'
                      ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200'
                      : line.op === 'removed'
                        ? 'bg-rose-500/12 text-rose-800 dark:text-rose-200'
                        : 'text-muted'
                  }
                >
                  {/* The marker column is what makes this readable in a screenshot or for anyone who
                      cannot separate the two background colours. */}
                  <td className="w-6 select-none border-r border-border px-1 text-center align-top opacity-70">
                    {line.op === 'added' ? '+' : line.op === 'removed' ? '−' : ''}
                  </td>
                  <td className="whitespace-pre-wrap break-words px-2 py-0.5 align-top">{line.text || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-muted disabled:opacity-40"
          >
            {t('play.tutorProposal.cancel')}
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy || changed === 0}
            className="rounded border border-primary/50 bg-primary/15 px-3 py-1.5 text-sm text-primary disabled:opacity-40"
          >
            {busy ? t('play.tutorProposal.applying') : t('play.tutorProposal.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

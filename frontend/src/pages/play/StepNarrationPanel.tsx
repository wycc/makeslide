import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  ApiError,
  fetchPptxImportStatus,
  renarratePptxSteps,
  savePageStepScript,
  updatePdfScriptSettings,
} from '../../lib/api';
import type { PdfDetailPage } from '../../types';

/**
 * The transcript tab for a page that is revealed in steps (a pptx import).
 *
 * Such a page does not narrate from `script.txt`: each step carries its own words and its own
 * audio clip, and the build advances when a clip ends. The ordinary transcript box therefore edits
 * text the page never speaks — which is what this panel replaces. Every save goes through the
 * per-step route so the words and the voice change together.
 */
interface Props {
  pdfId: string;
  page: PdfDetailPage;
  /** Which step the player is showing, so the row being played is easy to find. */
  currentStep: number | undefined;
  /** The deck's per-page target, which the settings PATCH requires alongside the per-step one. */
  scriptMaxCharsPerPage: number | null;
  scriptCharsPerStep: number | null;
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
}

export function StepNarrationPanel({
  pdfId,
  page,
  currentStep,
  scriptMaxCharsPerPage,
  scriptCharsPerStep,
  readOnly,
  onChanged,
}: Props) {
  const { t } = useI18n();
  const steps = page.steps ?? [];
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyStep, setBusyStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [charsPerStep, setCharsPerStep] = useState<string>(scriptCharsPerStep ? String(scriptCharsPerStep) : '');
  /**
   * An instruction for this rewrite only. Kept out of the deck's prompt on purpose: that one is
   * followed by every later regeneration, while this is "this time, explain the why".
   */
  const [hint, setHint] = useState('');
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [rewriteProgress, setRewriteProgress] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A page change (or a reload after an AI rewrite) must show the stored words, not what was
  // being typed against a different page.
  useEffect(() => {
    setDrafts({});
    setError(null);
    setNotice(null);
    // A hint typed for one page must not silently apply to the next.
    setHint('');
  }, [page.page_number, page.updated_at]);

  useEffect(() => {
    setCharsPerStep(scriptCharsPerStep ? String(scriptCharsPerStep) : '');
  }, [scriptCharsPerStep]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const valueOf = (index: number) => drafts[index] ?? steps[index]?.script ?? '';
  const dirty = (index: number) => drafts[index] !== undefined && drafts[index] !== (steps[index]?.script ?? '');

  const save = async (index: number, voice: boolean) => {
    if (readOnly) return;
    setBusyStep(index);
    setError(null);
    setNotice(null);
    try {
      const result = await savePageStepScript(pdfId, page.page_number, index, valueOf(index), { voice });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      // A failed voice is not a failed save: the words are stored, and saying so is the difference
      // between "try again" and "my edit vanished".
      if (result.voice_error) setError(t('play.stepNarration.voiceFailed').replace('{message}', result.voice_error));
      else if (!voice) setNotice(t('play.stepNarration.savedTextOnly'));
      else setNotice(t('play.stepNarration.savedWithVoice'));
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('play.stepNarration.saveFailed'));
    } finally {
      setBusyStep(null);
    }
  };

  const pollNarration = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const status = await fetchPptxImportStatus(pdfId);
          const narration = status.narration;
          if (!narration || narration.status !== 'running') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRewriteBusy(false);
            setRewriteProgress(null);
            if (narration?.error) setError(narration.error);
            else setNotice(t('play.stepNarration.rewriteDone'));
            await onChanged();
            return;
          }
          setRewriteProgress(
            t('play.stepNarration.rewriteProgress')
              .replace('{done}', String(narration.progress.done))
              .replace('{total}', String(narration.progress.total)),
          );
        } catch {
          // A failed poll is not a failed job; the next tick tries again.
        }
      })();
    }, 3000);
  };

  const rewriteThisPage = async () => {
    if (readOnly) return;
    setRewriteBusy(true);
    setError(null);
    setNotice(null);
    try {
      const chars = charsPerStep.trim() ? Number(charsPerStep) : undefined;
      if (chars !== undefined && (!Number.isInteger(chars) || chars < 40 || chars > 2000)) {
        setError(t('play.stepNarration.charsRange'));
        setRewriteBusy(false);
        return;
      }
      // Store the choice as well as using it, so the next rewrite (and the deck's other pages)
      // keep the same length instead of quietly reverting to the default.
      if (chars !== undefined && chars !== scriptCharsPerStep) {
        await updatePdfScriptSettings(pdfId, scriptMaxCharsPerPage, undefined, chars);
      }
      await renarratePptxSteps(pdfId, {
        pages: [page.page_number],
        charsPerStep: chars,
        instruction: hint.trim() || undefined,
      });
      setRewriteProgress(t('play.stepNarration.rewriteStarted'));
      pollNarration();
    } catch (err) {
      setRewriteBusy(false);
      setError(err instanceof ApiError ? err.message : t('play.stepNarration.rewriteFailed'));
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-2">
        <p className="text-xs text-muted">
          {t('play.stepNarration.intro').replace('{count}', String(steps.length))}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted" htmlFor="step-chars">
            {t('play.stepNarration.charsLabel')}
          </label>
          <input
            id="step-chars"
            type="number"
            min={40}
            max={2000}
            value={charsPerStep}
            onChange={(e) => setCharsPerStep(e.target.value)}
            placeholder={t('play.stepNarration.charsPlaceholder')}
            disabled={readOnly || rewriteBusy}
            className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void rewriteThisPage()}
            disabled={readOnly || rewriteBusy || steps.length === 0}
            className="rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 px-2.5 py-1 text-xs text-fuchsia-700 dark:text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rewriteBusy ? t('play.stepNarration.rewriteBusy') : t('play.stepNarration.rewritePage')}
          </button>
          {rewriteProgress ? <span className="text-xs text-muted">{rewriteProgress}</span> : null}
        </div>
        <input
          type="text"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder={t('play.stepNarration.hintPlaceholder')}
          disabled={readOnly || rewriteBusy}
          className="mt-2 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text disabled:opacity-50"
        />
        <p className="mt-1 text-[11px] text-muted">{t('play.stepNarration.rewriteHint')}</p>
        <p className="text-[11px] text-muted">{t('play.stepNarration.hintIsOneOff')}</p>
      </div>

      {error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p> : null}

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const isCurrent = currentStep === index;
          return (
            <li
              key={step.index}
              className={`rounded-md border px-3 py-2 ${isCurrent ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border bg-surface'}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text">
                  {t('play.stepNarration.stepLabel').replace('{n}', String(index + 1))}
                  {isCurrent ? ` · ${t('play.stepNarration.currentBadge')}` : ''}
                </span>
                <span className="text-[11px] text-muted">
                  {step.audio_url
                    ? t('play.stepNarration.hasVoice').replace(
                        '{seconds}',
                        step.audio_duration_seconds ? step.audio_duration_seconds.toFixed(1) : '—',
                      )
                    : t('play.stepNarration.noVoice')}
                </span>
              </div>
              <textarea
                value={valueOf(index)}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [index]: e.target.value }))}
                rows={3}
                disabled={readOnly || busyStep === index}
                className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text disabled:opacity-60"
              />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save(index, true)}
                  disabled={readOnly || busyStep === index || !dirty(index)}
                  className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyStep === index ? t('play.stepNarration.saving') : t('play.stepNarration.saveAndVoice')}
                </button>
                <button
                  type="button"
                  onClick={() => void save(index, false)}
                  disabled={readOnly || busyStep === index || !dirty(index)}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                  title={t('play.stepNarration.saveTextOnlyHint')}
                >
                  {t('play.stepNarration.saveTextOnly')}
                </button>
                {dirty(index) ? (
                  <span className="text-[11px] text-amber-600 dark:text-amber-300">
                    {t('play.stepNarration.unsaved')}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  ApiError,
  fetchPageSteps,
  fetchPptxImportStatus,
  renarratePptxSteps,
  savePageStepScript,
} from '../../lib/api';
import type { PdfDetailPage, PdfDetailPageStep } from '../../types';

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
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
}

export function StepNarrationPanel({
  pdfId,
  page,
  currentStep,
  readOnly,
  onChanged,
}: Props) {
  const { t } = useI18n();
  /**
   * The steps as the server has them right now.
   *
   * A rewrite fills the page in as it goes — the words land in the manifest when they are written,
   * each clip when it is recorded — so waiting for the job to finish before showing anything hides
   * most of what the user is waiting for. Null until a poll brings something newer than the deck
   * detail this panel was rendered with.
   */
  const [liveSteps, setLiveSteps] = useState<PdfDetailPageStep[] | null>(null);
  const steps = liveSteps ?? page.steps ?? [];
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyStep, setBusyStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Which length this rewrite aims for.
   *
   *  deck  — the deck's own settings (the normal case)
   *  page  — a whole page's worth, just this once; the model spreads it over the steps by what
   *          each one reveals, so the small ones stay short
   *  keep  — leave every step the length it is and only rewrite what it says
   */
  const [lengthMode, setLengthMode] = useState<'deck' | 'page' | 'keep'>('deck');
  const [charsPerPage, setCharsPerPage] = useState<string>('');
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
    // The detail this render carries is now the fresher of the two.
    setLiveSteps(null);
  }, [page.page_number, page.updated_at]);



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
      // Show the saved row immediately; the deck reload that follows is what makes it canonical.
      setLiveSteps((prev) => {
        const base = prev ?? page.steps ?? [];
        return base.map((step, i) =>
          i === index
            ? {
                ...step,
                script: result.script,
                audio_url: result.audio_url,
                audio_duration_seconds: result.audio_duration_seconds,
              }
            : step,
        );
      });
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
          const [status, live] = await Promise.all([
            fetchPptxImportStatus(pdfId),
            // Watched alongside the status so the rows fill in as the page is written and voiced,
            // instead of everything appearing at once when the job ends.
            fetchPageSteps(pdfId, page.page_number).catch(() => null),
          ]);
          if (live?.steps?.length) setLiveSteps(live.steps);
          const narration = status.narration;
          if (!narration || narration.status !== 'running') {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRewriteBusy(false);
            setRewriteProgress(null);
            if (narration?.error) setError(narration.error);
            else setNotice(t('play.stepNarration.rewriteDone'));
            // The reload brings the canonical detail; drop the live copy so the two cannot disagree.
            setLiveSteps(null);
            await onChanged();
            return;
          }
          // Page counts alone say nothing on a one-page rewrite — its only page finishes at the
          // very end. What takes the minutes is inside the page, so that is what is shown.
          const p = narration.progress;
          if (p.stage === 'planning') {
            setRewriteProgress(t('play.stepNarration.progressPlanning'));
          } else if (p.stage === 'speaking' && p.stepTotal) {
            setRewriteProgress(
              t('play.stepNarration.progressSpeaking')
                .replace('{page}', String(p.pageNumber))
                .replace('{done}', String(p.stepDone ?? 0))
                .replace('{total}', String(p.stepTotal)),
            );
          } else if (p.total > 1) {
            setRewriteProgress(
              t('play.stepNarration.progressWritingDeck')
                .replace('{page}', String(p.pageNumber))
                .replace('{done}', String(p.done))
                .replace('{total}', String(p.total)),
            );
          } else {
            setRewriteProgress(t('play.stepNarration.progressWriting').replace('{page}', String(p.pageNumber)));
          }
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
      const chars = lengthMode === 'page' && charsPerPage.trim() ? Number(charsPerPage) : undefined;
      if (lengthMode === 'page' && (chars === undefined || !Number.isInteger(chars) || chars < 80 || chars > 4000)) {
        setError(t('play.stepNarration.charsRange'));
        setRewriteBusy(false);
        return;
      }
      await renarratePptxSteps(pdfId, {
        pages: [page.page_number],
        // A one-off: the deck's own setting is left alone, because "make this page longer just
        // now" is not the same request as "make every page longer from now on".
        charsPerPage: chars,
        keepLengths: lengthMode === 'keep',
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
          <label className="text-xs text-muted" htmlFor="step-length-mode">
            {t('play.stepNarration.lengthModeLabel')}
          </label>
          <select
            id="step-length-mode"
            value={lengthMode}
            onChange={(e) => setLengthMode(e.target.value as 'deck' | 'page' | 'keep')}
            disabled={readOnly || rewriteBusy}
            className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text disabled:opacity-50"
          >
            <option value="deck">{t('play.stepNarration.lengthModeDeck')}</option>
            <option value="page">{t('play.stepNarration.lengthModePage')}</option>
            <option value="keep">{t('play.stepNarration.lengthModeKeep')}</option>
          </select>
          {lengthMode === 'page' ? (
            <input
              type="number"
              min={80}
              max={4000}
              value={charsPerPage}
              onChange={(e) => setCharsPerPage(e.target.value)}
              placeholder={t('play.stepNarration.pageCharsPlaceholder')}
              disabled={readOnly || rewriteBusy}
              aria-label={t('play.stepNarration.lengthModePage')}
              className="w-24 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text disabled:opacity-50"
            />
          ) : null}
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
        <p className="mt-1 text-[11px] text-muted">
          {t(lengthMode === 'keep' ? 'play.stepNarration.lengthHintKeep' : 'play.stepNarration.lengthHintBudget')}
        </p>
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

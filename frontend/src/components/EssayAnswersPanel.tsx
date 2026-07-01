import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { fetchEssayAnswers, essayAnswerPhotoUrl, updateEssayTeacherScore, ApiError } from '../lib/api';
import type { QuizEssayAnswer } from '../lib/api';

export interface EssayAnswersPanelProps {
  pdfId: string;
  quizId: number;
  quizTitle?: string;
  onClose: () => void;
}

/** 老師端：某測驗所有問答題作答的檢視與覆核（看照片、AI 分數與評語，可修改分數）。 */
export function EssayAnswersPanel({ pdfId, quizId, quizTitle, onClose }: EssayAnswersPanelProps) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState<QuizEssayAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(null);
    fetchEssayAnswers(pdfId, quizId)
      .then((list) => { if (alive) setAnswers(list); })
      .catch((err) => { if (alive) setError(err instanceof ApiError ? err.message : t('quiz.essay.loadFailed')); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [pdfId, quizId, t]);

  const saveScore = async (answer: QuizEssayAnswer) => {
    const raw = (drafts[answer.id] ?? '').trim();
    const value = raw === '' ? null : Number(raw);
    if (value != null && !Number.isFinite(value)) return;
    setSavingId(answer.id);
    try {
      const res = await updateEssayTeacherScore(pdfId, quizId, answer.id, value);
      setAnswers((prev) => prev.map((a) => (a.id === answer.id ? { ...a, teacher_score: res.teacher_score, effective_score: res.teacher_score ?? a.ai_score } : a)));
      setDrafts((prev) => { const next = { ...prev }; delete next[answer.id]; return next; });
    } catch {
      setError(t('quiz.essay.saveFailed'));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{t('quiz.essay.panelTitle')}{quizTitle ? `：${quizTitle}` : ''}</h2>
        <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">{t('quiz.essay.close')}</button>
      </div>
      {busy ? <p className="mt-1 text-xs text-slate-500">{t('quiz.essay.loading')}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-400">{error}</p> : null}
      {!busy && !error && answers.length === 0 ? <p className="mt-1 text-xs text-slate-500">{t('quiz.essay.empty')}</p> : null}
      {answers.length > 0 ? (
        <ul className="mt-2 space-y-3">
          {answers.map((a) => (
            <li key={a.id} className="rounded border border-slate-700 bg-slate-950/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-slate-200">{a.code || a.display_name || t('quiz.essay.anonymous')}</span>
                <span className="text-[11px] text-slate-500">{t('quiz.essay.questionLabel')}: {a.question_id}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {Array.from({ length: a.photo_count }).map((_, i) => (
                  <a key={i} href={essayAnswerPhotoUrl(pdfId, quizId, a.id, i)} target="_blank" rel="noopener noreferrer">
                    <img src={essayAnswerPhotoUrl(pdfId, quizId, a.id, i)} alt={`answer-${i}`} className="h-24 w-24 rounded border border-slate-700 object-cover hover:opacity-80" />
                  </a>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-300">
                <p>
                  {t('quiz.essay.aiScore')}: <span className="font-mono">{a.ai_score == null ? '—' : a.ai_score} / {a.max_score}</span>
                </p>
                {a.ai_feedback ? <p className="mt-1 rounded bg-slate-900 px-2 py-1 text-slate-300">{a.ai_feedback}</p> : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-slate-400">{t('quiz.essay.teacherScore')}:</label>
                <input
                  type="number"
                  min={0}
                  max={a.max_score}
                  step="0.5"
                  value={drafts[a.id] ?? (a.teacher_score == null ? '' : String(a.teacher_score))}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  placeholder={a.ai_score == null ? '' : String(a.ai_score)}
                  className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => void saveScore(a)}
                  disabled={savingId === a.id}
                  className="rounded border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-50"
                >
                  {savingId === a.id ? t('quiz.essay.saving') : t('quiz.essay.save')}
                </button>
                <span className="text-xs text-slate-500">{t('quiz.essay.finalScore')}: <span className="font-mono text-slate-300">{a.effective_score == null ? '—' : a.effective_score}</span></span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

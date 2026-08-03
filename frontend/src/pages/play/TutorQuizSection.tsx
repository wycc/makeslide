import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import { usePlayPageContext } from './PlayPageContext';
import { TutorQuizDialog } from './TutorQuizDialog';
import { fetchTutorQuizSession, type TutorQuizSession } from '../../lib/api';
import { getOrCreateViewerId } from '../../lib/viewerId';
import { countAnswered, levelToneClass } from '../../lib/tutorQuizProgress';

/**
 * 「課堂互動」分頁裡的課後輔導測試入口：顯示目前這輪練習的難度與進度，
 * 點按鈕開啟作答視窗。與旁邊的「測驗」入口不同——那是老師出好的整份測驗，
 * 這裡是自己一題一題練、難度會跟著跑的個人練習。
 */
export function TutorQuizSection() {
  const { t } = useI18n();
  const { pdfId } = usePlayPageContext();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<TutorQuizSession | null>(null);
  const [answered, setAnswered] = useState(0);

  const refresh = useCallback(async () => {
    if (!pdfId) return;
    try {
      const state = await fetchTutorQuizSession(pdfId, getOrCreateViewerId());
      setSession(state.session);
      setAnswered(countAnswered(state.questions));
    } catch {
      // 摘要抓不到就顯示「尚未開始」，不打斷側欄其他區塊。
      setSession(null);
      setAnswered(0);
    }
  }, [pdfId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!pdfId) return null;

  const status = session
    ? interpolateTemplate(t('play.tutorQuiz.sectionStatus'), {
        level: session.current_level,
        answered,
        correct: session.correct_count,
      })
    : t('play.tutorQuiz.sectionEmpty');

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text">🎯 {t('play.tutorQuiz.title')}</h2>
          <p className="text-[11px] text-muted">{status}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {session && (
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${levelToneClass(session.current_level)}`}>
              L{session.current_level}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-indigo-500/50 bg-indigo-500/15 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-500/25 dark:text-indigo-200"
          >
            {session ? t('play.tutorQuiz.continueButton') : t('play.tutorQuiz.startButton')}
          </button>
        </div>
      </div>
      {open && (
        <TutorQuizDialog
          onClose={() => { setOpen(false); void refresh(); }}
          onSessionChange={() => { void refresh(); }}
        />
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { parseMarkdownLite } from '../lib/markdownLite';
import type { MdBlock, MdInline } from '../lib/markdownLite';
import {
  DEFAULT_MAX_VIOLATIONS,
  evaluateViolation,
  isQuizFinished,
  isQuizLockedOut,
  isQuizStarted,
  markQuizLockedOut,
  markQuizStarted,
  shouldCountViolation,
} from '../lib/quizProctor';

/** 進入全螢幕或返回作答後的寬限期：此期間內的失焦/可見性事件不計為違規，
 *  避免把「切換全螢幕」這個轉場本身誤判成離開測驗。 */
const GRACE_MS = 900;

type Phase = 'rules' | 'testing' | 'locked' | 'completed';

function renderInline(inline: MdInline[]): ReactNode {
  return inline.map((seg, i) =>
    seg.bold ? <strong key={i} className="font-semibold text-slate-50">{seg.text}</strong> : <span key={i}>{seg.text}</span>,
  );
}

function RulesMarkdown({ blocks }: { blocks: MdBlock[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-200">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          const cls = block.level === 1
            ? 'text-lg font-bold text-fuchsia-100'
            : block.level === 2
              ? 'mt-4 text-base font-semibold text-fuchsia-100'
              : 'mt-3 text-sm font-semibold text-fuchsia-200';
          return <p key={i} className={cls}>{renderInline(block.inline)}</p>;
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={i} className={`ml-5 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
              {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ListTag>
          );
        }
        return <p key={i}>{renderInline(block.inline)}</p>;
      })}
    </div>
  );
}

export interface QuizProctorGateProps {
  /** 是否需要監考（例如：學生正在作答且老師尚未公布答案）。false 時直接顯示 children、不監控。 */
  active: boolean;
  /** 唯一標示本次測驗的鍵；用於鎖定「同一次測驗結束後不允許再進入」。 */
  sessionKey: string;
  /** 第二次違規時觸發自動交卷。 */
  onForceSubmit: () => void;
  /** 作答畫面。 */
  children: ReactNode;
  /** 允許的違規次數上限（預設 1）。 */
  maxViolations?: number;
  /** 按下同意後、進入測驗前執行（例如請求相機並開始錄影）。reject 則不進入測驗、顯示錯誤。 */
  onBeforeStart?: () => Promise<void>;
  /** 測驗結束（自動交卷、老師公布答案或離開）時執行（例如停止錄影並上傳）。 */
  onEnd?: () => void;
}

/**
 * 測驗監考門檻元件：作答前先顯示規則（載自 public/quiz-rules.md，方便客製化），
 * 學生同意後進入全螢幕並開始監控「離開全螢幕／切換視窗或分頁」。最多允許一次違規，
 * 超過即自動交卷並鎖定本次測驗，重整或重新進入都會被擋下。
 *
 * 全螢幕採 best-effort：在不支援 Element.requestFullscreen 的行動瀏覽器上，仍以
 * visibilitychange/blur 監控切換 App 的行為。
 */
export function QuizProctorGate({ active, sessionKey, onForceSubmit, children, maxViolations = DEFAULT_MAX_VIOLATIONS, onBeforeStart, onEnd }: QuizProctorGateProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('rules');
  const [rulesBlocks, setRulesBlocks] = useState<MdBlock[] | null>(null);
  const [rulesFailed, setRulesFailed] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const violationCountRef = useRef(0);
  const lastViolationAtRef = useRef<number | null>(null);
  const graceUntilRef = useRef(0);
  const phaseRef = useRef<Phase>('rules');
  phaseRef.current = phase;
  // 讓 unmount cleanup 取用最新的 onEnd，而不必納入 effect 依賴。
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // 依 sessionKey 決定初始 phase：已鎖定或先前已由其他頁面實例開始過（重整後重新進入）
  // 直接進入 locked，否則從規則畫面開始。
  useEffect(() => {
    violationCountRef.current = 0;
    lastViolationAtRef.current = null;
    setShowWarning(false);
    setPhase(
      isQuizFinished(sessionKey)
        ? 'completed'
        : isQuizLockedOut(sessionKey) || isQuizStarted(sessionKey)
          ? 'locked'
          : 'rules',
    );
  }, [sessionKey]);

  // 載入可客製化的規則 markdown（相對 document.baseURI，兼容子路徑與 Electron file://）。
  useEffect(() => {
    let alive = true;
    const url = new URL('quiz-rules.md', document.baseURI).href;
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => { if (alive) { setRulesBlocks(parseMarkdownLite(text)); setRulesFailed(false); } })
      .catch(() => { if (alive) { setRulesBlocks([]); setRulesFailed(true); } });
    return () => { alive = false; };
  }, []);

  const enterFullscreen = useCallback(() => {
    graceUntilRef.current = Date.now() + GRACE_MS;
    const el = containerRef.current;
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => { /* 行動瀏覽器可能拒絕：退回僅可見性監控 */ });
    }
  }, []);

  const registerViolation = useCallback(() => {
    if (phaseRef.current !== 'testing') return;
    const now = Date.now();
    if (now < graceUntilRef.current) return;
    if (!shouldCountViolation(lastViolationAtRef.current, now)) return;
    lastViolationAtRef.current = now;
    const { nextCount, action } = evaluateViolation(violationCountRef.current, maxViolations);
    violationCountRef.current = nextCount;
    if (action === 'lock') {
      markQuizLockedOut(sessionKey);
      setShowWarning(false);
      setPhase('locked');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      onForceSubmit();
      onEndRef.current?.();
    } else {
      setShowWarning(true);
    }
  }, [maxViolations, onForceSubmit, sessionKey]);

  // 監控：僅在 testing 階段掛載事件。
  useEffect(() => {
    if (phase !== 'testing') return;
    const onVisibility = () => { if (document.hidden) registerViolation(); };
    const onBlur = () => registerViolation();
    const onFsChange = () => { if (!document.fullscreenElement) registerViolation(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [phase, registerViolation]);

  // 老師公布答案或測驗結束（active 轉 false）時，退出全螢幕並結束錄影上傳。
  const endedForInactiveRef = useRef(false);
  useEffect(() => {
    if (!active) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (!endedForInactiveRef.current) {
        endedForInactiveRef.current = true;
        onEndRef.current?.();
      }
    } else {
      endedForInactiveRef.current = false;
    }
  }, [active]);

  // 元件卸載（例如老師直接結束測驗使作答畫面消失）時，仍結束錄影並上傳。
  useEffect(() => () => { onEndRef.current?.(); }, []);

  // 不需監考時直接顯示作答內容（例如老師已公布答案的檢視）。
  if (!active) return <>{children}</>;

  return (
    <div ref={containerRef} className="bg-slate-950 [&:fullscreen]:h-screen [&:fullscreen]:overflow-y-auto">
      {phase === 'completed' ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-8 text-center">
          <div className="text-4xl">✅</div>
          <h2 className="text-lg font-bold text-emerald-100">{t('quiz.proctor.completedTitle')}</h2>
          <p className="max-w-md text-sm text-emerald-100/80">{t('quiz.proctor.completedBody')}</p>
        </div>
      ) : phase === 'locked' ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-8 text-center">
          <div className="text-4xl">🔒</div>
          <h2 className="text-lg font-bold text-rose-100">{t('quiz.proctor.lockedTitle')}</h2>
          <p className="max-w-md text-sm text-rose-100/80">{t('quiz.proctor.lockedBody')}</p>
        </div>
      ) : phase === 'rules' ? (
        <div className="mx-auto max-w-2xl rounded-xl border border-fuchsia-500/30 bg-slate-900/80 p-6">
          <h2 className="mb-1 text-lg font-bold text-fuchsia-100">{t('quiz.proctor.rulesHeading')}</h2>
          <p className="mb-4 text-xs text-fuchsia-100/70">{t('quiz.proctor.fullscreenHint')}</p>
          <div className="mb-5 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60 p-4">
            {rulesBlocks === null ? (
              <p className="text-sm text-slate-400">{t('quiz.proctor.loadingRules')}</p>
            ) : rulesFailed ? (
              <p className="text-sm text-amber-300">{t('quiz.proctor.rulesLoadFailed')}</p>
            ) : (
              <RulesMarkdown blocks={rulesBlocks} />
            )}
          </div>
          {startError ? <p className="mb-2 text-sm text-rose-300">{t('quiz.proctor.cameraError')}</p> : null}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-400">{t('quiz.proctor.agreeHint')}</p>
            <button
              type="button"
              onClick={async () => {
                setStartError(null);
                setStarting(true);
                try {
                  if (onBeforeStart) await onBeforeStart();
                  markQuizStarted(sessionKey);
                  enterFullscreen();
                  setPhase('testing');
                } catch {
                  setStartError('start_failed');
                } finally {
                  setStarting(false);
                }
              }}
              disabled={rulesBlocks === null || starting}
              className="shrink-0 rounded-md border border-emerald-500/50 bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? t('quiz.proctor.starting') : t('quiz.proctor.agreeButton')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {children}
          {showWarning ? (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-amber-400/60 bg-slate-900 p-6 text-center shadow-2xl">
                <div className="mb-2 text-4xl">⚠️</div>
                <h2 className="mb-2 text-lg font-bold text-amber-100">{t('quiz.proctor.warningTitle')}</h2>
                <p className="mb-5 text-sm text-amber-100/90">{t('quiz.proctor.warningBody')}</p>
                <button
                  type="button"
                  onClick={() => { setShowWarning(false); enterFullscreen(); }}
                  className="w-full rounded-md border border-emerald-500/50 bg-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30"
                >
                  {t('quiz.proctor.returnButton')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

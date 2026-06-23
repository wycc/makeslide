import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchQualityCheck, type PageQualityResult, type QualityIssueCode } from '../../lib/api';
import { useI18n } from '../../i18n';
import { usePlayPageContext } from './PlayPageContext';

type IssueKeyMap = Record<QualityIssueCode, 'play.quality.missing_image' | 'play.quality.missing_audio' | 'play.quality.missing_script' | 'play.quality.empty_script' | 'play.quality.short_script' | 'play.quality.animation_over_limit'>;

const ISSUE_KEY: IssueKeyMap = {
  missing_image: 'play.quality.missing_image',
  missing_audio: 'play.quality.missing_audio',
  missing_script: 'play.quality.missing_script',
  empty_script: 'play.quality.empty_script',
  short_script: 'play.quality.short_script',
  animation_over_limit: 'play.quality.animation_over_limit',
};

export function QualityCheckPanel() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pdfId } = usePlayPageContext();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PageQualityResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!pdfId || running) return;
    setRunning(true);
    setError(null);
    try {
      const data = await fetchQualityCheck(pdfId);
      setResults(data.pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : '品質檢查失敗');
    } finally {
      setRunning(false);
    }
  };

  const issueLabel = (code: QualityIssueCode, detail?: string): string => {
    const raw = t(ISSUE_KEY[code]);
    return detail ? raw.replace('{detail}', detail) : raw;
  };

  const issuePages = results?.filter((r) => r.issues.length > 0) ?? [];

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          {t('play.quality.title')}
          {results !== null && !running && (
            issuePages.length === 0 ? (
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-normal text-emerald-400">✓</span>
            ) : (
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-normal text-rose-300">{issuePages.length}</span>
            )
          )}
        </h2>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running || !pdfId}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {running ? t('play.quality.running') : t('play.quality.run')}
        </button>
      </div>

      {error && (
        <p className="text-xs text-rose-400">{error}</p>
      )}

      {results !== null && !running && (
        issuePages.length === 0 ? (
          <p className="text-xs text-emerald-400">{t('play.quality.allGood')}</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-amber-400">
              {t('play.quality.issueCount').replace('{n}', String(issuePages.length))}
            </p>
            <ul className="space-y-2">
              {issuePages.map((page) => (
                <li key={page.pageNumber} className="rounded border border-slate-700 bg-slate-950/50 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200">
                      {t('play.quality.page').replace('{n}', String(page.pageNumber))}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/play/${encodeURIComponent(pdfId ?? '')}?page=${page.pageNumber}`)}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      title={t('play.quality.goToPage')}
                    >
                      →
                    </button>
                  </div>
                  <ul className="space-y-0.5">
                    {page.issues.map((issue, i) => (
                      <li key={i} className="text-xs text-amber-300">
                        {issueLabel(issue.code, issue.detail)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </section>
  );
}

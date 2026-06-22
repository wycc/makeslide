import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchContent, type SearchResults } from '../lib/api';
import { useI18n } from '../i18n';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LEN = 2;

export default function GlobalSearchBox() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < MIN_QUERY_LEN) {
      setResults(null);
      setOpen(false);
      return;
    }
    setSearching(true);
    setOpen(true);
    try {
      const data = await searchContent(q.trim());
      setResults(data);
    } catch {
      setResults(null);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void doSearch(query); }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleClear = () => {
    setQuery('');
    setResults(null);
    setOpen(false);
  };

  const handlePdfClick = (id: string) => {
    setOpen(false);
    navigate(`/play/${encodeURIComponent(id)}`);
  };

  const handlePageClick = (pdfId: string, pageNumber: number) => {
    setOpen(false);
    navigate(`/play/${encodeURIComponent(pdfId)}?page=${pageNumber}`);
  };

  const hasResults = results && (results.pdfMatches.length > 0 || results.pageMatches.length > 0);
  const noResults = results && !hasResults && !searching;

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5">
        <svg className="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results) setOpen(true); }}
          placeholder={t('home.search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            aria-label={t('home.search.clearSearch')}
            className="shrink-0 text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {searching && (
            <p className="px-4 py-3 text-sm text-slate-400">{t('home.search.searching')}</p>
          )}
          {noResults && (
            <p className="px-4 py-3 text-sm text-slate-400">
              {t('home.search.noResults').replace('{q}', query)}
            </p>
          )}
          {hasResults && (
            <>
              {results.pdfMatches.length > 0 && (
                <section>
                  <p className="border-b border-slate-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t('home.search.pdfMatches')}
                  </p>
                  {results.pdfMatches.map((pdf) => (
                    <button
                      key={pdf.id}
                      type="button"
                      onClick={() => handlePdfClick(pdf.id)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-800"
                    >
                      <svg className="h-4 w-4 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="flex-1 truncate text-sm text-slate-100">{pdf.title ?? pdf.id}</span>
                      {pdf.pageCount != null && (
                        <span className="shrink-0 text-xs text-slate-500">{pdf.pageCount} 頁</span>
                      )}
                    </button>
                  ))}
                </section>
              )}
              {results.pageMatches.length > 0 && (
                <section>
                  <p className="border-b border-slate-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t('home.search.pageMatches')}
                  </p>
                  {results.pageMatches.map((pm, idx) => (
                    <button
                      key={`${pm.pdfId}-${pm.pageNumber}-${idx}`}
                      type="button"
                      onClick={() => handlePageClick(pm.pdfId, pm.pageNumber)}
                      className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-slate-800"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-indigo-400">
                          {t('home.search.page').replace('{n}', String(pm.pageNumber))}
                        </span>
                        <span className="truncate text-xs text-slate-400">{pm.pdfTitle ?? pm.pdfId}</span>
                      </div>
                      <p className="line-clamp-2 text-xs text-slate-300">{pm.snippet}</p>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

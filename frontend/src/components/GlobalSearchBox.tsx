import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPdfs, type SearchResultItem } from '../lib/api';
import { useI18n } from '../i18n';

const DEBOUNCE_MS = 300;

export default function GlobalSearchBox() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      setOpen(false);
      return;
    }
    setSearching(true);
    setOpen(true);
    try {
      const data = await searchPdfs(trimmed);
      setResults(data.results);
    } catch {
      setResults([]);
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

  const handleResultClick = (result: SearchResultItem) => {
    setOpen(false);
    if (result.page_number != null) {
      navigate(`/play/${encodeURIComponent(result.pdf_id)}?page=${result.page_number}`);
    } else {
      navigate(`/play/${encodeURIComponent(result.pdf_id)}`);
    }
  };

  const hasResults = results !== null && results.length > 0;
  const noResults = results !== null && results.length === 0 && !searching;

  const matchTypeLabel = (matchType: SearchResultItem['match_type']) => {
    if (matchType === 'title') return t('home.search.matchType.title');
    if (matchType === 'script') return t('home.search.matchType.script');
    return t('home.search.matchType.text');
  };

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
            aria-label={t('home.clearTitleFilter')}
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
            <p className="px-4 py-3 text-sm text-slate-400">{t('home.search.noResults')}</p>
          )}
          {hasResults && (
            <ul>
              {results.map((result, idx) => (
                <li key={`${result.pdf_id}-${result.page_number ?? 'title'}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => handleResultClick(result)}
                    className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-100">
                        {result.pdf_title ?? result.pdf_id}
                      </span>
                      <span className="rounded-full border border-indigo-500/50 bg-indigo-500/10 px-1.5 py-0.5 text-xs text-indigo-300">
                        {matchTypeLabel(result.match_type)}
                      </span>
                      {result.page_number != null && (
                        <span className="text-xs text-slate-500">
                          {t('home.search.page').replace('{n}', String(result.page_number))}
                        </span>
                      )}
                    </div>
                    {result.snippet && (
                      <p className="line-clamp-2 text-xs text-slate-400">{result.snippet}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

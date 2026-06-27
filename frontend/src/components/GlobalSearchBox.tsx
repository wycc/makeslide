import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchPdfs, createPdfFromPages, type SearchResultItem } from '../lib/api';
import { getRecentSearches, addRecentSearch, clearRecentSearches } from '../lib/recentSearches';
import { addReviewItems } from '../lib/reviewList';
import { searchResultsToReviewItems } from '../lib/searchResultsToReviewItems';
import { useI18n } from '../i18n';

const DEBOUNCE_MS = 300;

export function highlightText(text: string, query: string): { text: string; isMatch: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, isMatch: false }];
  const parts: { text: string; isMatch: boolean }[] = [];
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  let pos = 0;
  while (pos < text.length) {
    const idx = lowerText.indexOf(lowerQ, pos);
    if (idx === -1) {
      parts.push({ text: text.slice(pos), isMatch: false });
      break;
    }
    if (idx > pos) parts.push({ text: text.slice(pos, idx), isMatch: false });
    parts.push({ text: text.slice(idx, idx + q.length), isMatch: true });
    pos = idx + q.length;
  }
  return parts;
}

function makeSelKey(result: SearchResultItem): string {
  return `${result.pdf_id}::${result.page_number ?? 'null'}`;
}

export default function GlobalSearchBox() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [fromPagesBusy, setFromPagesBusy] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => getRecentSearches());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Monotonic id of the latest issued search; lets us drop out-of-order responses
  // so a slower earlier query (e.g. "ab") can't clobber the results of the newer
  // one the user actually typed ("abc").
  const requestSeqRef = useRef(0);

  const doSearch = useCallback(async (q: string, semantic: boolean) => {
    const trimmed = q.trim();
    if (!trimmed) {
      requestSeqRef.current += 1; // invalidate any in-flight response
      setResults(null);
      setOpen(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    setSearching(true);
    setOpen(true);
    try {
      const data = await searchPdfs(trimmed, 20, semantic);
      if (seq !== requestSeqRef.current) return; // superseded by a newer search
      setResults(data.results);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setResults([]);
    } finally {
      if (seq === requestSeqRef.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void doSearch(query, semanticMode); }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, semanticMode, doSearch]);

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
    setSelected(new Set());
    setSelectMode(false);
  };

  // Record the committed query (Enter) into the recent-search history.
  const commitRecent = () => {
    if (!query.trim()) return;
    setRecents(addRecentSearch(query));
  };

  const handleRecentClick = (q: string) => {
    setQuery(q);
    setRecents(addRecentSearch(q));
    setOpen(true);
  };

  const handleClearRecents = () => {
    clearRecentSearches();
    setRecents([]);
  };

  const showRecents = query.trim() === '' && recents.length > 0;

  const handleResultClick = (result: SearchResultItem) => {
    if (selectMode) {
      if (result.page_number == null) return;
      const key = makeSelKey(result);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    setOpen(false);
    if (result.page_number != null) {
      navigate(`/play/${encodeURIComponent(result.pdf_id)}?page=${result.page_number}`);
    } else {
      navigate(`/play/${encodeURIComponent(result.pdf_id)}`);
    }
  };

  const handleCreateFromPages = async () => {
    if (fromPagesBusy || selected.size === 0 || !results) return;
    const pageSpecs = results
      .filter((r) => r.page_number != null && selected.has(makeSelKey(r)))
      .map((r) => ({ pdf_id: r.pdf_id, page_number: r.page_number! }));
    if (pageSpecs.length === 0) return;
    setFromPagesBusy(true);
    try {
      const resp = await createPdfFromPages(pageSpecs);
      setOpen(false);
      setSelectMode(false);
      setSelected(new Set());
      navigate(`/play/${encodeURIComponent(resp.id)}`);
    } catch {
      // ignore
    } finally {
      setFromPagesBusy(false);
    }
  };

  const handleAddToReviewList = () => {
    if (selected.size === 0 || !results) return;
    const selectedResults = results.filter((r) => r.page_number != null && selected.has(makeSelKey(r)));
    const items = searchResultsToReviewItems(selectedResults, new Date().toISOString());
    if (items.length === 0) return;
    addReviewItems(items);
    setSelectMode(false);
    setSelected(new Set());
    setOpen(false);
  };

  const hasResults = results !== null && results.length > 0;
  const noResults = results !== null && results.length === 0 && !searching;

  const matchTypeLabel = (matchType: SearchResultItem['match_type']) => {
    if (matchType === 'title') return t('home.search.matchType.title');
    if (matchType === 'script') return t('home.search.matchType.script');
    if (matchType === 'semantic') return t('home.search.matchType.semantic');
    return t('home.search.matchType.text');
  };

  const pageResults = results?.filter((r) => r.page_number != null) ?? [];

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
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRecent(); }}
          placeholder={semanticMode ? t('home.search.placeholderSemantic') : t('home.search.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="button"
          title={t('home.search.semanticToggle')}
          onClick={() => setSemanticMode((m) => !m)}
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${semanticMode ? 'bg-violet-600/30 text-violet-300' : 'text-slate-600 hover:text-slate-400'}`}
        >
          AI
        </button>
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

      {open && (showRecents || searching || noResults || hasResults) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {showRecents && (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t('home.search.recentTitle')}</span>
                <button type="button" onClick={handleClearRecents} className="text-[10px] text-slate-500 hover:text-slate-300">
                  {t('home.search.recentClear')}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recents.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleRecentClick(q)}
                    className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {searching && (
            <p className="px-4 py-3 text-sm text-slate-400">{t('home.search.searching')}</p>
          )}
          {noResults && (
            <p className="px-4 py-3 text-sm text-slate-400">{t('home.search.noResults')}</p>
          )}
          {hasResults && (
            <>
              {pageResults.length > 0 && (
                <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectMode((m) => !m);
                      if (selectMode) setSelected(new Set());
                    }}
                    className={`rounded border px-2 py-0.5 text-xs ${selectMode ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                  >
                    {selectMode ? t('home.search.selectModeOn') : t('home.search.selectMode')}
                  </button>
                  {selectMode && selected.size > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleCreateFromPages()}
                      disabled={fromPagesBusy}
                      className="rounded border border-emerald-500/60 bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {fromPagesBusy
                        ? t('home.search.creatingPresentation')
                        : t('home.search.createFromPages').replace('{n}', String(selected.size))}
                    </button>
                  )}
                  {selectMode && selected.size > 0 && (
                    <button
                      type="button"
                      onClick={handleAddToReviewList}
                      className="rounded border border-rose-500/60 bg-rose-500/20 px-2 py-0.5 text-xs text-rose-200 hover:bg-rose-500/30"
                    >
                      {t('home.search.addToReviewList').replace('{n}', String(selected.size))}
                    </button>
                  )}
                </div>
              )}
              <ul>
                {results.map((result, idx) => {
                  const key = makeSelKey(result);
                  const isSelectable = result.page_number != null;
                  const isChecked = selected.has(key);
                  return (
                    <li key={`${result.pdf_id}-${result.page_number ?? 'title'}-${idx}`}>
                      <button
                        type="button"
                        onClick={() => handleResultClick(result)}
                        className={`flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-slate-800 ${isChecked ? 'bg-indigo-500/10' : ''}`}
                      >
                        {selectMode && isSelectable && (
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${isChecked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-600'}`}>
                            {isChecked && (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
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
                            <p className="line-clamp-2 text-xs text-slate-400">
                              {highlightText(result.snippet, query).map((part, i) =>
                                part.isMatch ? (
                                  <mark key={i} className="rounded-sm bg-yellow-400/25 text-yellow-200 not-italic">{part.text}</mark>
                                ) : (
                                  <span key={i}>{part.text}</span>
                                )
                              )}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

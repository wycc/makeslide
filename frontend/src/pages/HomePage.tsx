import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  deleteCategory,
  deletePdf,
  duplicatePdf,
  fetchPdfs,
  getAuthStatus,
  logoutAuth,
  retryFailedPdf,
  startProcessing,
  updatePdfCategory,
  type AuthStatus,
} from '../lib/api';
import type { PdfListItem, UploadResponse } from '../types';
import PdfCard from '../components/PdfCard';
import PromptModal from '../components/PromptModal';
import UploadButton from '../components/UploadButton';
import { useI18n } from '../i18n';

const POLL_INTERVAL_ACTIVE_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 30000;
const DEFAULT_PROMPT_TTS_PROVIDER = 'gemini' as const;
const DEFAULT_CATEGORY = 'general';
const CATEGORY_FILTER_STORAGE_KEY = 'makeslide.home.categoryFilter';

const compareByTitle = (a: PdfListItem, b: PdfListItem) => {
  const titleA = a.title?.trim() || a.id;
  const titleB = b.title?.trim() || b.id;
  return titleA.localeCompare(titleB, 'zh-Hant', { numeric: true, sensitivity: 'base' });
};

const compareByCreatedAtDesc = (a: PdfListItem, b: PdfListItem) => {
  const timeA = Date.parse(a.created_at);
  const timeB = Date.parse(b.created_at);
  return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
};

interface PromptTarget {
  id: string;
  title: string | null;
  initialValue: string;
  ttsProvider: 'openai' | 'gemini';
  pageCount: number | null;
  hasSourceText: boolean;
}

const readStoredCategoryFilter = () => {
  if (typeof window === 'undefined') return '__all__';
  return window.localStorage.getItem(CATEGORY_FILTER_STORAGE_KEY) || '__all__';
};

export default function HomePage() {
  const { t } = useI18n();
  const RECENT_CATEGORY = t('home.recentCategory');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<PdfListItem[]>([]);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [promptTarget, setPromptTarget] = useState<PromptTarget | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>(readStoredCategoryFilter);

  const allCategories = items.reduce<string[]>((categories, pdf) => {
    const category = pdf.category?.trim() || DEFAULT_CATEGORY;
    if (!categories.includes(category)) categories.push(category);
    return categories;
  }, []).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
  const filteredItems = categoryFilter === '__all__' || categoryFilter === '__recent__'
    ? items
    : items.filter((pdf) => (pdf.category?.trim() || DEFAULT_CATEGORY) === categoryFilter);
  const categoryGroups = categoryFilter === '__recent__'
    ? [{ category: RECENT_CATEGORY, items: [...items].sort(compareByCreatedAtDesc) }]
    : filteredItems.reduce<Array<{ category: string; items: PdfListItem[] }>>((groups, pdf) => {
      const category = pdf.category?.trim() || DEFAULT_CATEGORY;
      const group = groups.find((g) => g.category === category);
      if (group) {
        group.items.push(pdf);
      } else {
        groups.push({ category, items: [pdf] });
      }
      return groups;
    }, [])
      .map((group) => ({ ...group, items: [...group.items].sort(compareByTitle) }))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant', { numeric: true, sensitivity: 'base' }));

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const updateCategoryFilter = useCallback((nextFilter: string) => {
    setCategoryFilter(nextFilter);
    window.localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, nextFilter);
  }, []);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const list = await fetchPdfs();
      setItems(list);
      setError(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
          : t('home.loadFailed');
      setError(msg);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const auth = await getAuthStatus();
        if (alive) setAuthStatus(auth);
      } catch {
        if (alive) setAuthStatus(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Adaptive polling: 5s while any item is still processing, 30s otherwise.
  // `awaiting_prompt` is *not* considered active (server is idle waiting for
  // the user), so we stay on the slow cadence when all outstanding PDFs are
  // blocked on prompt input.
  useEffect(() => {
    const hasActive = items.some(
      (p) => p.status === 'uploaded' || p.status === 'processing',
    );
    const interval = hasActive ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, interval);
    return () => {
      window.clearInterval(timer);
    };
  }, [items, load]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deletePdf(id);
        setItems((prev) => prev.filter((p) => p.id !== id));
        showToast(t('home.deleted'));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.deleteFailed');
        showToast(`${t('home.deleteFailed')}：${msg}`);
      }
    },
    [showToast],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        const copied = await duplicatePdf(id);
        setItems((prev) => [copied, ...prev]);
        showToast(t('home.duplicated'));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.duplicateFailed');
        showToast(`${t('home.duplicateFailed')}：${msg}`);
      }
    },
    [showToast],
  );

  const handleCategoryChange = useCallback(
    async (id: string, category: string) => {
      try {
        const updated = await updatePdfCategory(id, category);
        setItems((prev) => prev.map((p) => (p.id === id ? { ...p, category: updated.category } : p)));
        showToast(t('home.movedToCategory').replace('{category}', updated.category));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.updateCategoryFailed');
        showToast(`${t('home.updateCategoryFailed')}：${msg}`);
      }
    },
    [showToast],
  );

  const handleDeleteCategory = useCallback(
    async (category: string) => {
      if (category === DEFAULT_CATEGORY) {
        showToast(t('home.defaultCategoryCannotDelete'));
        return;
      }
      const hasProcessingItem = items.some((pdf) => {
        const pdfCategory = pdf.category?.trim() || DEFAULT_CATEGORY;
        return pdfCategory === category && (pdf.status === 'uploaded' || pdf.status === 'processing');
      });
      if (hasProcessingItem) {
        showToast(t('home.categoryHasProcessingItems'));
        return;
      }
      const ok = window.confirm(t('home.confirmDeleteCategory').replace('{category}', category));
      if (!ok) return;
      try {
        const resp = await deleteCategory(category);
        setItems((prev) => prev.map((p) => (p.category === category ? { ...p, category: resp.reassigned_to } : p)));
        setCategoryFilter((prev) => {
          if (prev !== category) return prev;
          window.localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, '__all__');
          return '__all__';
        });
        showToast(
          t('home.categoryDeletedAndReassigned')
            .replace('{count}', String(resp.affected_count))
            .replace('{category}', resp.reassigned_to),
        );
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.deleteCategoryFailed');
        showToast(`${t('home.deleteCategoryFailed')}：${msg}`);
      }
    },
    [items, showToast],
  );

  const openPromptFor = useCallback((pdf: PdfListItem | UploadResponse) => {
    const title = 'title' in pdf ? pdf.title : null;
    const initial =
      'user_prompt' in pdf && typeof pdf.user_prompt === 'string'
        ? pdf.user_prompt
        : '';
    setPromptTarget({
      id: pdf.id,
      title,
      initialValue: initial,
      ttsProvider:
        'tts_provider' in pdf && pdf.tts_provider
          ? pdf.tts_provider
          : DEFAULT_PROMPT_TTS_PROVIDER,
      pageCount: 'page_count' in pdf ? pdf.page_count : null,
      hasSourceText: 'has_source_text' in pdf ? Boolean(pdf.has_source_text) : false,
    });
  }, []);

  useEffect(() => {
    const openPromptId = searchParams.get('openPrompt')?.trim();
    if (!openPromptId) return;
    const target = items.find((p) => p.id === openPromptId);
    if (!target) return;
    openPromptFor(target);
    const next = new URLSearchParams(searchParams);
    next.delete('openPrompt');
    setSearchParams(next, { replace: true });
  }, [items, openPromptFor, searchParams, setSearchParams]);

  const handleUploaded = useCallback(
    (resp: UploadResponse) => {
      // Refresh the list in the background so the new card (in
      // awaiting_prompt state) shows up immediately, then open the prompt
      // modal for the user.
      void load({ silent: true });
      openPromptFor(resp);
    },
    [load, openPromptFor],
  );

  const handlePromptSubmit = useCallback(
    async (
      prompt: string,
      requireScriptConfirmation: boolean,
      opts: {
        ttsVoice: string;
        ttsSpeed: number;
        scriptMaxCharsPerPage: number;
        tonePrompt?: string;
      },
    ) => {
      if (!promptTarget) return;
      await startProcessing(promptTarget.id, prompt, requireScriptConfirmation, opts);
      setPromptTarget(null);
      showToast(prompt ? t('home.promptSubmitted') : t('home.defaultStyleStarted'));
      void load({ silent: true });
    },
    [promptTarget, showToast, load],
  );

  const handlePromptClose = useCallback(() => {
    setPromptTarget(null);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logoutAuth();
      setAuthStatus((prev) => (prev ? { ...prev, authenticated: false, user: null } : prev));
      showToast(t('home.logoutSuccess'));
      navigate('/settings', { replace: true });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('home.logoutFailed');
      showToast(`${t('home.logoutFailed')}：${msg}`);
    }
  }, [navigate, showToast]);

  const handleCardClick = useCallback(
    (pdf: PdfListItem) => {
      if (pdf.status === 'awaiting_prompt') {
        openPromptFor(pdf);
        return;
      }
      if (pdf.status === 'uploaded' || pdf.status === 'processing') {
        navigate(`/play/${pdf.id}`);
        return;
      }
      if (pdf.status !== 'ready') {
        if (pdf.status === 'failed') {
          void (async () => {
            try {
              await retryFailedPdf(pdf.id);
              showToast(t('home.retryQueued'));
              await load({ silent: true });
            } catch (err) {
              const msg = err instanceof ApiError ? err.message : t('home.retryFailed');
              showToast(`${t('home.retryFailed')}：${msg}`);
            }
          })();
          return;
        }
        showToast(t('home.notReadyYet'));
        return;
      }
      navigate(`/play/${pdf.id}`);
    },
    [navigate, openPromptFor, showToast, load],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold tracking-tight">makeslide</h1>
          <div className="flex items-center gap-2">
            {authStatus?.authenticated ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
                title={authStatus.user?.email ? `${t('home.logout')} ${authStatus.user.email}` : t('home.logoutGoogle')}
              >
                {t('home.logout')}
              </button>
            ) : null}
            <Link
              to="/settings"
              className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              {t('home.apiKeySettings')}
            </Link>
            <UploadButton onUploaded={handleUploaded} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {!loading && items.length === 0 && !error && (
          <section className="mb-6 rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h2 className="text-sm font-semibold text-slate-100">{t('home.firstTimeGuide')}</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
              <li>{t('home.step1')}</li>
              <li>{t('home.step2')}</li>
              <li>{t('home.step3')}</li>
              <li>{t('home.step4')}</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
              <a className="underline underline-offset-2 hover:text-slate-200" href="/docs/error-codes.md" target="_blank" rel="noreferrer">
                {t('home.errorCodeGuide')}
              </a>
              <a className="underline underline-offset-2 hover:text-slate-200" href="/docs/userguide.md" target="_blank" rel="noreferrer">
                {t('home.userGuide')}
              </a>
            </div>
          </section>
        )}

        {loading && items.length === 0 && (
          <p className="text-sm text-slate-400">{t('home.loading')}</p>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
            <p className="text-slate-300">{t('home.noPdf')}</p>
            <p className="mt-1 text-sm text-slate-500">{t('home.clickUpload')}</p>
          </div>
        )}

        {items.length > 0 && (
          <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <label className="flex flex-col gap-2 text-sm text-slate-300 sm:max-w-xs">
              {t('home.showCategory')}
              <select
                value={categoryFilter}
                onChange={(ev) => updateCategoryFilter(ev.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-slate-500"
              >
                <option value="__all__">{t('home.allCategories')}</option>
                <option value="__recent__">{RECENT_CATEGORY}</option>
                {allCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
          </section>
        )}

        {items.length > 0 && categoryGroups.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
            <p className="text-slate-300">{t('home.noSlidesInCategory')}</p>
          </div>
        )}

        {categoryGroups.length > 0 && (
          <div className="space-y-8">
            {categoryGroups.map((group) => (
              <section key={group.category} aria-labelledby={`category-${group.category}`}>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <h2 id={`category-${group.category}`} className="text-lg font-semibold text-slate-100">
                    {group.category}
                  </h2>
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                    {t('home.slideCount').replace('{count}', String(group.items.length))}
                  </span>
                  {group.category !== DEFAULT_CATEGORY && group.category !== RECENT_CATEGORY && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteCategory(group.category)}
                      className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10"
                    >
                      {t('home.deleteCategory')}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                  {group.items.map((pdf) => (
                    <PdfCard
                      key={pdf.id}
                      pdf={pdf}
                      categories={allCategories}
                      onDelete={handleDelete}
                      onDuplicate={handleDuplicate}
                      onCategoryChange={handleCategoryChange}
                      onClick={handleCardClick}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-slate-100 shadow-lg ring-1 ring-slate-700">
          {toast}
        </div>
      )}

      {promptTarget && (
        <PromptModal
          pdfTitle={promptTarget.title}
          initialValue={promptTarget.initialValue}
          ttsProvider={promptTarget.ttsProvider}
          showSplitConfirmation={promptTarget.hasSourceText}
          onSubmit={handlePromptSubmit}
          onClose={handlePromptClose}
        />
      )}
    </div>
  );
}

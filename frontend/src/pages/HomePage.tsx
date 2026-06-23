import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  confirmScript,
  deleteCategory,
  deletePdf,
  duplicatePdf,
  fetchPdfs,
  getAuthStatus,
  importPdfZip,
  isAlreadyProcessingConflict,
  logoutAuth,
  retryFailedPdf,
  startProcessing,
  updatePdfCategory,
  updatePdfTags,
  startBatchExport,
  pollBatchExport,
  batchExportDownloadUrl,
  type AuthStatus,
} from '../lib/api';
import type { PdfListItem, UploadResponse } from '../types';
import PdfCard from '../components/PdfCard';
import PromptModal from '../components/PromptModal';
import UploadButton from '../components/UploadButton';
import GlobalSearchBox from '../components/GlobalSearchBox';
import { useI18n } from '../i18n';
import { useBudgetWarning } from '../hooks/useBudgetWarning';

const POLL_INTERVAL_ACTIVE_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 30000;
const DEFAULT_PROMPT_TTS_PROVIDER = 'gemini' as const;
const DEFAULT_CATEGORY = 'general';
const ADD_CATEGORY_OPTION_VALUE = '__add_category__';
const CATEGORY_FILTER_STORAGE_KEY = 'makeslide.home.categoryFilter';
const CUSTOM_CATEGORIES_STORAGE_KEY = 'makeslide.home.customCategories';
const TITLE_FILTER_STORAGE_KEY = 'makeslide.home.titleFilter';
const SORT_MODE_STORAGE_KEY = 'makeslide.home.sortMode';
const FAVORITES_STORAGE_KEY = 'makeslide.favorites';
const RECENT_SEARCHES_STORAGE_KEY = 'makeslide.recentSearches';
const MAX_RECENT_SEARCHES = 5;
const VIEW_MODE_STORAGE_KEY = 'makeslide.home.viewMode';

type ViewMode = 'grid' | 'list';

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '剛剛';
    if (mins < 60) return `${mins} 分鐘前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小時前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} 個月前`;
    return `${Math.floor(months / 12)} 年前`;
  } catch {
    return iso;
  }
}

type SortMode = 'title_asc' | 'created_desc' | 'updated_desc' | 'page_count_desc' | 'audio_desc' | 'audio_asc' | 'last_played_desc';

const SORT_MODES: SortMode[] = ['title_asc', 'created_desc', 'updated_desc', 'page_count_desc', 'audio_desc', 'audio_asc', 'last_played_desc'];

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

const compareByUpdatedAtDesc = (a: PdfListItem, b: PdfListItem) => {
  const timeA = Date.parse(a.updated_at);
  const timeB = Date.parse(b.updated_at);
  return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
};

const compareByPageCountDesc = (a: PdfListItem, b: PdfListItem) => {
  const countA = a.page_count ?? 0;
  const countB = b.page_count ?? 0;
  return countB - countA;
};

const compareByAudioDurationDesc = (a: PdfListItem, b: PdfListItem) => {
  const durA = a.total_audio_duration_seconds ?? -1;
  const durB = b.total_audio_duration_seconds ?? -1;
  return durB - durA;
};

const compareByAudioDurationAsc = (a: PdfListItem, b: PdfListItem) => {
  const durA = a.total_audio_duration_seconds ?? Infinity;
  const durB = b.total_audio_duration_seconds ?? Infinity;
  return durA - durB;
};

const compareByLastPlayedAtDesc = (a: PdfListItem, b: PdfListItem) => {
  const timeA = a.last_played_at ? Date.parse(a.last_played_at) : 0;
  const timeB = b.last_played_at ? Date.parse(b.last_played_at) : 0;
  return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
};

const RECENT_DAYS = 14;
const isRecentlyPlayed = (pdf: PdfListItem): boolean => {
  if (!pdf.last_played_at) return false;
  const t = Date.parse(pdf.last_played_at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= RECENT_DAYS * 24 * 60 * 60 * 1000;
};

const getComparatorForSortMode = (sortMode: SortMode) => {
  switch (sortMode) {
    case 'created_desc':
      return compareByCreatedAtDesc;
    case 'updated_desc':
      return compareByUpdatedAtDesc;
    case 'page_count_desc':
      return compareByPageCountDesc;
    case 'audio_desc':
      return compareByAudioDurationDesc;
    case 'audio_asc':
      return compareByAudioDurationAsc;
    case 'last_played_desc':
      return compareByLastPlayedAtDesc;
    case 'title_asc':
    default:
      return compareByTitle;
  }
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

const readStoredCustomCategories = () => {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const raw = window.localStorage.getItem(CUSTOM_CATEGORIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => Boolean(value));
  } catch {
    return [];
  }
};

const readStoredTitleFilter = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TITLE_FILTER_STORAGE_KEY) || '';
};

const readRecentSearches = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]).filter((s) => typeof s === 'string').slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
};

const saveRecentSearch = (term: string): string[] => {
  const trimmed = term.trim();
  if (!trimmed) return readRecentSearches();
  const existing = readRecentSearches().filter((s) => s !== trimmed);
  const next = [trimmed, ...existing].slice(0, MAX_RECENT_SEARCHES);
  window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
  return next;
};

const readStoredSortMode = (): SortMode | null => {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(SORT_MODE_STORAGE_KEY);
  return SORT_MODES.includes(stored as SortMode) ? (stored as SortMode) : null;
};

export const getDefaultSortModeForCategory = (categoryFilter: string): SortMode =>
  categoryFilter === '__recent__' ? 'created_desc' : 'title_asc';

export default function HomePage() {
  const { t } = useI18n();
  const budgetWarning = useBudgetWarning();
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
  const [customCategories, setCustomCategories] = useState<string[]>(readStoredCustomCategories);
  const [titleFilter, setTitleFilter] = useState<string>(readStoredTitleFilter);
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches);
  const [searchFocused, setSearchFocused] = useState(false);
  const [explicitSortMode, setExplicitSortMode] = useState<SortMode | null>(readStoredSortMode);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  );
  const updateViewMode = (mode: ViewMode) => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    setViewMode(mode);
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchMoving, setBatchMoving] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchTagging, setBatchTagging] = useState(false);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);
  const [continuingPdfId, setContinuingPdfId] = useState<string | null>(null);
  const [isImportingZip, setIsImportingZip] = useState(false);
  const [zipImportProgress, setZipImportProgress] = useState(0);
  const zipImportInputRef = useRef<HTMLInputElement | null>(null);
  const [batchExportJobId, setBatchExportJobId] = useState<string | null>(null);
  const [batchExportProgress, setBatchExportProgress] = useState(0);
  const [batchExportTotal, setBatchExportTotal] = useState(0);
  const batchExportPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);

  const itemCategories = items.reduce<string[]>((categories, pdf) => {
    const category = pdf.category?.trim() || DEFAULT_CATEGORY;
    if (!categories.includes(category)) categories.push(category);
    return categories;
  }, []).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
  const allCategories = Array.from(new Set([...itemCategories, ...customCategories]))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
  const categoryFilteredItems = categoryFilter === '__all__'
    ? items
    : categoryFilter === '__recent__'
      ? items.filter(isRecentlyPlayed)
      : items.filter((pdf) => (pdf.category?.trim() || DEFAULT_CATEGORY) === categoryFilter);
  const allTags = Array.from(new Set(
    items.flatMap((pdf) => (pdf.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean))
  )).sort((a, b) => a.localeCompare(b, 'zh-Hant', { sensitivity: 'base' }));

  const normalizedTitleFilter = titleFilter.trim().toLocaleLowerCase();
  const tagFilteredItems = tagFilter
    ? categoryFilteredItems.filter((pdf) =>
        (pdf.tags ?? '').split(',').map((tag) => tag.trim()).includes(tagFilter)
      )
    : categoryFilteredItems;
  const favFilteredItems = favoritesOnly
    ? tagFilteredItems.filter((pdf) => favorites.has(pdf.id))
    : tagFilteredItems;
  const filteredItems = normalizedTitleFilter
    ? favFilteredItems.filter((pdf) => {
      const title = (pdf.title?.trim() || '').toLocaleLowerCase();
      const tags = (pdf.tags ?? '').toLocaleLowerCase();
      return title.includes(normalizedTitleFilter) || tags.includes(normalizedTitleFilter);
    })
    : favFilteredItems;
  const visibleSummary = t('home.resultSummary')
    .replace('{shown}', String(filteredItems.length))
    .replace('{total}', String(categoryFilteredItems.length));
  const sortMode = explicitSortMode ?? getDefaultSortModeForCategory(categoryFilter);
  const sortItems = useCallback((list: PdfListItem[]) => [...list].sort((a, b) => {
    const primary = getComparatorForSortMode(sortMode)(a, b);
    return primary === 0 ? compareByTitle(a, b) : primary;
  }), [sortMode]);
  const categoryGroups = categoryFilter === '__recent__'
    ? [{ category: RECENT_CATEGORY, items: [...filteredItems].sort(compareByLastPlayedAtDesc) }]
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
      .map((group) => ({ ...group, items: sortItems(group.items) }))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hant', { numeric: true, sensitivity: 'base' }));

  const usageBarMaxValues = useMemo(() => {
    let maxPlay = 1, maxPages = 1, maxAudio = 1;
    for (const group of categoryGroups) {
      for (const pdf of group.items) {
        if ((pdf.play_count ?? 0) > maxPlay) maxPlay = pdf.play_count ?? 0;
        if ((pdf.page_count ?? 0) > maxPages) maxPages = pdf.page_count ?? 0;
        if ((pdf.total_audio_duration_seconds ?? 0) > maxAudio) maxAudio = pdf.total_audio_duration_seconds ?? 0;
      }
    }
    return { maxPlay, maxPages, maxAudio };
  }, [categoryGroups]);

  const homeStats = useMemo(() => {
    const totalPdfs = items.length;
    const totalPages = items.reduce((s, p) => s + (p.page_count ?? 0), 0);
    const totalPlays = items.reduce((s, p) => s + (p.play_count ?? 0), 0);
    const totalAudioMin = Math.round(items.reduce((s, p) => s + (p.total_audio_duration_seconds ?? 0), 0) / 60);
    return { totalPdfs, totalPages, totalPlays, totalAudioMin };
  }, [items]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current != null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0 || batchDeleting) return;
    setBatchDeleting(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        await deletePdf(id);
        setItems((prev) => prev.filter((p) => p.id !== id));
      } catch { failed++; }
    }
    setSelectedIds(new Set());
    setBatchDeleting(false);
    if (failed > 0) {
      showToast(t('home.batchDeletePartial').replace('{failed}', String(failed)));
    } else {
      showToast(t('home.batchDeleteDone').replace('{count}', String(ids.length)));
    }
  }, [selectedIds, batchDeleting, showToast, t]);

  const handleBatchMoveCategory = useCallback(async (targetCategory: string) => {
    if (selectedIds.size === 0 || batchMoving) return;
    setBatchMoving(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      try {
        await updatePdfCategory(id, targetCategory);
        setItems((prev) => prev.map((p) => p.id === id ? { ...p, category: targetCategory } : p));
      } catch { failed++; }
    }
    setSelectedIds(new Set());
    setBatchMoving(false);
    if (failed > 0) {
      showToast(t('home.batchMoveFailed').replace('{failed}', String(failed)));
    } else {
      showToast(t('home.batchMoveDone').replace('{count}', String(ids.length)).replace('{category}', targetCategory));
    }
  }, [selectedIds, batchMoving, showToast, t]);

  const handleBatchSetTags = useCallback(async (newTag: string) => {
    const tag = newTag.trim();
    if (!tag || selectedIds.size === 0 || batchTagging) return;
    setBatchTagging(true);
    const ids = [...selectedIds];
    let failed = 0;
    for (const id of ids) {
      const current = items.find((p) => p.id === id);
      const existingTags = current?.tags ?? '';
      const tagList = existingTags.split(',').map((s) => s.trim()).filter(Boolean);
      if (!tagList.includes(tag)) tagList.push(tag);
      const next = tagList.join(',');
      try {
        await updatePdfTags(id, next);
        setItems((prev) => prev.map((p) => p.id === id ? { ...p, tags: next } : p));
      } catch { failed++; }
    }
    setBatchTagging(false);
    setBatchTagInput('');
    if (failed > 0) {
      showToast(t('home.batchSetTagsFailed').replace('{failed}', String(failed)));
    } else {
      showToast(t('home.batchSetTagsDone').replace('{count}', String(ids.length)).replace('{tag}', tag));
    }
  }, [selectedIds, batchTagging, items, setItems, showToast, t]);

  const updateCategoryFilter = useCallback((nextFilter: string) => {
    setCategoryFilter(nextFilter);
    window.localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, nextFilter);
  }, []);

  const updateTitleFilter = useCallback((nextFilter: string) => {
    setTitleFilter(nextFilter);
    window.localStorage.setItem(TITLE_FILTER_STORAGE_KEY, nextFilter);
  }, []);

  const commitSearchTerm = useCallback((term: string) => {
    if (term.trim()) {
      setRecentSearches(saveRecentSearch(term));
    }
  }, []);

  const updateSortMode = useCallback((nextSortMode: SortMode) => {
    setExplicitSortMode(nextSortMode);
    window.localStorage.setItem(SORT_MODE_STORAGE_KEY, nextSortMode);
  }, []);

  const persistCustomCategories = useCallback((next: string[]) => {
    setCustomCategories(next);
    window.localStorage.setItem(CUSTOM_CATEGORIES_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const handleCategoryFilterSelect = useCallback((value: string) => {
    if (value !== ADD_CATEGORY_OPTION_VALUE) {
      updateCategoryFilter(value);
      return;
    }

    const input = window.prompt(t('home.newCategoryPlaceholder'));
    const category = input?.trim() || '';
    if (!category) return;

    if (allCategories.includes(category)) {
      showToast(t('home.categoryAlreadyExists').replace('{category}', category));
      updateCategoryFilter(category);
      return;
    }

    const next = [...customCategories, category]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
    persistCustomCategories(next);
    updateCategoryFilter(category);
    showToast(t('home.categoryAdded').replace('{category}', category));
  }, [allCategories, customCategories, persistCustomCategories, showToast, t, updateCategoryFilter]);

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

  const handleExport = useCallback(
    async (id: string) => {
      try {
        const a = document.createElement('a');
        a.href = `api/pdfs/${encodeURIComponent(id)}/export.zip`;
        a.download = `${id}.zip`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t('home.exported'));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.exportFailed');
        showToast(`${t('home.exportFailed')}：${msg}`);
      }
    },
    [showToast, t],
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

  const handleTagsEdit = useCallback(
    async (id: string, tags: string) => {
      const result = await updatePdfTags(id, tags);
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, tags: result.tags } : p)));
    },
    [],
  );

  const handleToggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleImportZipClick = useCallback(() => {
    zipImportInputRef.current?.click();
  }, []);

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

  const handleImportZipChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setIsImportingZip(true);
      setZipImportProgress(0);
      try {
        const imported = await importPdfZip(file, {
          onProgress: (loaded, total) => {
            if (total > 0) setZipImportProgress(Math.round((loaded / total) * 100));
          },
        });
        setItems((prev) => [imported, ...prev]);
        openPromptFor(imported);
        showToast(t('home.imported'));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.importFailed');
        showToast(`${t('home.importFailed')}：${msg}`);
      } finally {
        setIsImportingZip(false);
        setZipImportProgress(0);
      }
    },
    [openPromptFor, showToast, t],
  );

  const handleBatchExportAll = useCallback(async () => {
    if (batchExportJobId) return;
    try {
      const { jobId } = await startBatchExport();
      setBatchExportJobId(jobId);
      setBatchExportProgress(0);
      setBatchExportTotal(0);
      batchExportPollRef.current = setInterval(() => {
        void pollBatchExport(jobId).then((res) => {
          setBatchExportProgress(res.progress);
          setBatchExportTotal(res.total);
          if (res.status === 'done') {
            if (batchExportPollRef.current != null) {
              clearInterval(batchExportPollRef.current);
              batchExportPollRef.current = null;
            }
            setBatchExportJobId(null);
            const a = document.createElement('a');
            a.href = batchExportDownloadUrl(jobId);
            a.download = 'batch-export.zip';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            showToast(t('home.batchExportDone'));
          } else if (res.status === 'failed') {
            if (batchExportPollRef.current != null) {
              clearInterval(batchExportPollRef.current);
              batchExportPollRef.current = null;
            }
            setBatchExportJobId(null);
            showToast(t('home.batchExportFailed'));
          }
        }).catch(() => {
          if (batchExportPollRef.current != null) {
            clearInterval(batchExportPollRef.current);
            batchExportPollRef.current = null;
          }
          setBatchExportJobId(null);
          showToast(t('home.batchExportFailed'));
        });
      }, 2000);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('home.batchExportFailed');
      showToast(`${t('home.batchExportFailed')}：${msg}`);
    }
  }, [batchExportJobId, showToast, t]);

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

  const handleRenameCategory = useCallback(
    async (category: string) => {
      if (category === DEFAULT_CATEGORY || category === RECENT_CATEGORY) return;
      const input = window.prompt(t('home.renameCategoryPrompt').replace('{category}', category), category);
      const nextCategory = input?.trim() || '';
      if (!nextCategory || nextCategory === category) return;
      if (allCategories.includes(nextCategory)) {
        showToast(t('home.categoryAlreadyExists').replace('{category}', nextCategory));
        return;
      }

      const affectedItems = items.filter((pdf) => (pdf.category?.trim() || DEFAULT_CATEGORY) === category);
      setRenamingCategory(category);
      try {
        const nextCustomCategories = Array.from(
          new Set([
            ...customCategories.map((value) => (value === category ? nextCategory : value)),
            nextCategory,
          ]),
        ).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true, sensitivity: 'base' }));
        persistCustomCategories(nextCustomCategories);

        const results = await Promise.allSettled(
          affectedItems.map((pdf) => updatePdfCategory(pdf.id, nextCategory)),
        );
        const updatedItems = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        const failedCount = results.filter((result) => result.status === 'rejected').length;

        setItems((prev) => prev.map((pdf) => {
          const updated = updatedItems.find((item) => item.id === pdf.id);
          if (updated) return { ...pdf, category: updated.category };
          return pdf;
        }));
        setCategoryFilter((prev) => {
          if (prev !== category) return prev;
          window.localStorage.setItem(CATEGORY_FILTER_STORAGE_KEY, nextCategory);
          return nextCategory;
        });

        if (failedCount > 0) {
          showToast(
            t('home.categoryRenamePartialFailed')
              .replace('{category}', nextCategory)
              .replace('{failed}', String(failedCount)),
          );
          await load({ silent: true });
          return;
        }

        showToast(
          t('home.categoryRenamed')
            .replace('{from}', category)
            .replace('{to}', nextCategory)
            .replace('{count}', String(affectedItems.length)),
        );
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.renameCategoryFailed');
        showToast(`${t('home.renameCategoryFailed')}：${msg}`);
        await load({ silent: true });
      } finally {
        setRenamingCategory(null);
      }
    },
    [RECENT_CATEGORY, allCategories, customCategories, items, load, persistCustomCategories, showToast, t],
  );

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
      void load({ silent: true });
      // If a specific category is active, assign the new PDF to it automatically.
      // Special filter values (__all__, __recent__, etc.) are not real categories.
      if (!categoryFilter.startsWith('__')) {
        void updatePdfCategory(resp.id, categoryFilter).then(() => {
          void load({ silent: true });
        });
      }
      openPromptFor(resp);
    },
    [load, openPromptFor, categoryFilter],
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
      try {
        await startProcessing(promptTarget.id, prompt, requireScriptConfirmation, opts);
        showToast(prompt ? t('home.promptSubmitted') : t('home.defaultStyleStarted'));
      } catch (err) {
        // A slow/dropped first request can leave the client retrying after the backend
        // already moved the PDF past 'uploaded' (e.g. into 'processing' or 'ready'); the
        // resubmit then hits this 409 even though the original request already succeeded.
        // Treat it as a benign no-op instead of a failure so the user isn't stuck retrying
        // a prompt that was already applied.
        if (isAlreadyProcessingConflict(err)) {
          setPromptTarget(null);
          showToast(t('home.alreadyProcessing'));
          void load({ silent: true });
          return;
        }
        throw err;
      }
      setPromptTarget(null);
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
      const readOnlyShared = pdf.visibility === 'public';
      if (pdf.status === 'awaiting_prompt') {
        if (readOnlyShared) {
          navigate(`/play/${pdf.id}`);
          return;
        }
        openPromptFor(pdf);
        return;
      }
      if (
        pdf.status === 'uploaded' ||
        pdf.status === 'processing' ||
        pdf.status === 'awaiting_script_confirmation'
      ) {
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

  const handleContinueGeneration = useCallback(
    async (pdf: PdfListItem) => {
      if (pdf.status !== 'awaiting_script_confirmation') return;
      setContinuingPdfId(pdf.id);
      try {
        await confirmScript(pdf.id);
        showToast(t('home.continueQueued'));
        await load({ silent: true });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : t('home.continueFailed');
        showToast(`${t('home.continueFailed')}：${msg}`);
      } finally {
        setContinuingPdfId(null);
      }
    },
    [load, showToast, t],
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold tracking-tight">makeslide</h1>
          <GlobalSearchBox />
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
            <input
              ref={zipImportInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => void handleImportZipChange(event)}
            />
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
            <button
              type="button"
              onClick={handleImportZipClick}
              disabled={isImportingZip}
              className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
            >
              {t('home.importZip')}
            </button>
            <button
              type="button"
              onClick={() => void handleBatchExportAll()}
              disabled={batchExportJobId !== null}
              className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              {batchExportJobId !== null
                ? t('home.batchExporting').replace('{progress}', String(batchExportProgress)).replace('{total}', String(batchExportTotal))
                : t('home.batchExportAll')}
            </button>
            <UploadButton onUploaded={handleUploaded} />
            </div>
            {isImportingZip && (
              <div className="w-full max-w-sm rounded-lg border border-indigo-400/40 bg-indigo-500/10 p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-indigo-100">
                  <span>{t('home.importingZip')}</span>
                  <span>{zipImportProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-indigo-400 transition-all duration-200"
                    style={{ width: `${zipImportProgress}%` }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={zipImportProgress}
                    aria-label={t('home.importZipProgressAriaLabel')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {budgetWarning?.exceeded ? (
          <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
            {t('budget.exceeded')
              .replace('${cost}', String(Math.round(budgetWarning.costUsd * 100) / 100))
              .replace('${limit}', String(budgetWarning.limitUsd))}
          </div>
        ) : null}
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-col gap-2 text-sm text-slate-300 sm:max-w-xs">
                {t('home.showCategory')}
                <select
                  value={categoryFilter}
                  onChange={(ev) => handleCategoryFilterSelect(ev.target.value)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-slate-500"
                >
                  <option value="__all__">{t('home.allCategories')}</option>
                  <option value="__recent__">{RECENT_CATEGORY}</option>
                  <option value={ADD_CATEGORY_OPTION_VALUE}>{t('home.addCategory')}…</option>
                  {allCategories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-300 sm:w-80">
                {t('home.filterByTitle')}
                <div className="relative">
                  <input
                    type="text"
                    value={titleFilter}
                    onChange={(ev) => updateTitleFilter(ev.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => { commitSearchTerm(titleFilter); setSearchFocused(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { commitSearchTerm(titleFilter); (e.target as HTMLInputElement).blur(); } }}
                    placeholder={t('home.filterByTitlePlaceholder')}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 pr-16 text-sm text-slate-100 outline-none transition hover:border-slate-500 focus:border-indigo-400"
                  />
                  {titleFilter.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateTitleFilter('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      aria-label={t('home.clearTitleFilter')}
                    >
                      {t('home.clearTitleFilter')}
                    </button>
                  )}
                  {searchFocused && recentSearches.length > 0 && titleFilter.length === 0 && (
                    <ul className="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg">
                      <li className="flex items-center justify-between px-3 py-1 text-xs text-slate-500">
                        <span>{t('home.search.recent')}</span>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); window.localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY); setRecentSearches([]); }}
                          className="text-slate-500 hover:text-slate-300"
                        >
                          {t('home.search.clearRecent')}
                        </button>
                      </li>
                      {recentSearches.map((term) => (
                        <li key={term}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); updateTitleFilter(term); setSearchFocused(false); }}
                            className="w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            {term}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-300 sm:w-64">
                {t('home.sortBy')}
                <select
                  value={sortMode}
                  onChange={(ev) => updateSortMode(ev.target.value as SortMode)}
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-slate-500 focus:border-indigo-400"
                >
                  <option value="title_asc">{t('home.sort.titleAsc')}</option>
                  <option value="created_desc">{t('home.sort.createdDesc')}</option>
                  <option value="updated_desc">{t('home.sort.updatedDesc')}</option>
                  <option value="page_count_desc">{t('home.sort.pageCountDesc')}</option>
                  <option value="audio_desc">{t('home.sort.audioDurationDesc')}</option>
                  <option value="audio_asc">{t('home.sort.audioDurationAsc')}</option>
                  <option value="last_played_desc">{t('home.sort.lastPlayedDesc')}</option>
                </select>
              </label>
              <div className="flex items-end gap-1">
                <button
                  type="button"
                  onClick={() => updateViewMode('grid')}
                  className={`rounded p-2 text-sm transition ${viewMode === 'grid' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                  title={t('home.viewGrid')}
                  aria-label={t('home.viewGrid')}
                >
                  ⊞
                </button>
                <button
                  type="button"
                  onClick={() => updateViewMode('list')}
                  className={`rounded p-2 text-sm transition ${viewMode === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                  title={t('home.viewList')}
                  aria-label={t('home.viewList')}
                >
                  ☰
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400" aria-live="polite">
              {visibleSummary}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
              <span>{t('home.stats.totalPdfs').replace('{n}', String(homeStats.totalPdfs))}</span>
              <span>·</span>
              <span>{t('home.stats.totalPages').replace('{n}', String(homeStats.totalPages))}</span>
              <span>·</span>
              <span>{t('home.stats.totalPlays').replace('{n}', String(homeStats.totalPlays))}</span>
              {homeStats.totalAudioMin > 0 && (
                <>
                  <span>·</span>
                  <span>{t('home.stats.totalAudio').replace('{n}', String(homeStats.totalAudioMin))}</span>
                </>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFavoritesOnly((v) => !v)}
                className={`rounded-full border px-3 py-0.5 text-xs transition ${favoritesOnly ? 'border-amber-400 bg-amber-500/20 text-amber-200' : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
              >
                {favoritesOnly ? '★' : '☆'} {t('home.filter.favoritesOnly')}
              </button>
              {selectedIds.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleBatchDelete()}
                    disabled={batchDeleting}
                    className="rounded-full border border-rose-500/60 bg-rose-500/15 px-3 py-0.5 text-xs text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-50"
                  >
                    {batchDeleting ? '…' : t('home.batchDeleteBtn').replace('{count}', String(selectedIds.size))}
                  </button>
                  <select
                    value=""
                    disabled={batchMoving}
                    onChange={(e) => { if (e.target.value) void handleBatchMoveCategory(e.target.value); }}
                    className="rounded-full border border-sky-500/60 bg-sky-500/15 px-2 py-0.5 text-xs text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-50"
                  >
                    <option value="">{batchMoving ? '…' : t('home.batchMoveToCategory')}</option>
                    {allCategories.filter((c: string) => c !== '__recent__').map((c: string) => (
                      <option key={c} value={c}>{c || t('home.listUncategorized')}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={batchTagInput}
                    onChange={(e) => setBatchTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && batchTagInput.trim()) void handleBatchSetTags(batchTagInput); }}
                    disabled={batchTagging}
                    placeholder={batchTagging ? '…' : t('home.batchSetTags')}
                    className="w-28 rounded-full border border-emerald-500/60 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 placeholder-emerald-600 transition focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
                  />
                </>
              )}
            </div>
            {allTags.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTagFilter('')}
                  className={`rounded-full border px-3 py-0.5 text-xs transition ${tagFilter === '' ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200' : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
                >
                  {t('home.tagAll')}
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                    className={`rounded-full border px-3 py-0.5 text-xs transition ${tagFilter === tag ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200' : 'border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500'}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {/* custom category management UI removed; category creation is only via dropdown option */}
          </section>
        )}

        {items.length > 0 && categoryGroups.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center">
            <p className="text-slate-300">{t('home.noSlidesInCategory')}</p>
            {categoryFilter !== '__all__' &&
              categoryFilter !== '__recent__' &&
              categoryFilter !== DEFAULT_CATEGORY && (
                <button
                  type="button"
                  onClick={() => void handleDeleteCategory(categoryFilter)}
                  className="mt-4 rounded-md border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/10"
                >
                  {t('home.deleteCategory')}
                </button>
              )}
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
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRenameCategory(group.category)}
                        disabled={renamingCategory === group.category}
                        className="rounded-md border border-indigo-500/40 px-2 py-1 text-xs text-indigo-200 transition hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {renamingCategory === group.category ? t('home.renamingCategory') : t('home.renameCategory')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCategory(group.category)}
                        className="rounded-md border border-rose-500/40 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10"
                      >
                        {t('home.deleteCategory')}
                      </button>
                    </>
                  )}
                </div>
                {viewMode === 'list' ? (
                  <div className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800">
                    {group.items.map((pdf) => (
                      <div
                        key={pdf.id}
                        className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-800/50"
                        onClick={() => handleCardClick(pdf)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(pdf.id)}
                          onChange={(e) => { e.stopPropagation(); toggleSelected(pdf.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-100">{pdf.title ?? pdf.id}</p>
                          <p className="text-xs text-slate-400">
                            {t('home.listPages').replace('{count}', String(pdf.page_count))} · {pdf.category ?? t('home.listUncategorized')}
                            {pdf.last_played_at && (
                              <span className="ml-2 text-slate-500">
                                {t('home.listLastPlayed').replace('{time}', formatRelativeTime(pdf.last_played_at))}
                              </span>
                            )}
                            {pdf.description?.trim() && (
                              <span className="ml-2 truncate text-slate-500" title={pdf.description}>— {pdf.description}</span>
                            )}
                          </p>
                          {(pdf.tags ?? '').trim() && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(pdf.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                                <span key={tag} className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] text-indigo-300">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Mini usage bar chart */}
                        <div className="hidden shrink-0 flex-col gap-0.5 sm:flex" style={{ width: 80 }}>
                          {[
                            { value: pdf.play_count ?? 0, max: usageBarMaxValues.maxPlay, color: 'bg-sky-500', label: `▶ ${pdf.play_count ?? 0}` },
                            { value: pdf.page_count ?? 0, max: usageBarMaxValues.maxPages, color: 'bg-emerald-500', label: `📄 ${pdf.page_count ?? 0}` },
                            { value: pdf.total_audio_duration_seconds ?? 0, max: usageBarMaxValues.maxAudio, color: 'bg-amber-500', label: `🎵 ${Math.round((pdf.total_audio_duration_seconds ?? 0) / 60)}m` },
                          ].map(({ value, max, color, label }) => (
                            <div key={label} className="group/bar relative h-1.5 w-full rounded-full bg-slate-700" title={label}>
                              <div
                                className={`h-full rounded-full ${color} opacity-70`}
                                style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }}
                              />
                              <span className="pointer-events-none absolute -top-5 left-0 hidden whitespace-nowrap rounded bg-slate-900 px-1 py-0.5 text-[10px] text-slate-200 shadow group-hover/bar:block">
                                {label}
                              </span>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className={`shrink-0 rounded p-1 transition ${favorites.has(pdf.id) ? 'text-amber-400 hover:text-amber-300' : 'text-slate-500 hover:bg-slate-700 hover:text-amber-400'}`}
                          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(pdf.id); }}
                          aria-label={favorites.has(pdf.id) ? t('card.unfavorite') : t('card.favorite')}
                        >
                          {favorites.has(pdf.id) ? '★' : '☆'}
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-700 hover:text-rose-400"
                          onClick={(e) => { e.stopPropagation(); void handleDelete(pdf.id); }}
                          aria-label={t('card.delete')}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {group.items.map((pdf) => (
                      <div key={pdf.id} className="group/sel relative">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(pdf.id)}
                          onChange={() => toggleSelected(pdf.id)}
                          className="absolute left-2 top-2 z-10 h-4 w-4 cursor-pointer accent-indigo-500 opacity-0 transition group-hover/sel:opacity-100 data-[checked=true]:opacity-100"
                          data-checked={selectedIds.has(pdf.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <PdfCard
                          pdf={pdf}
                          categories={allCategories}
                          onDelete={handleDelete}
                          onDuplicate={handleDuplicate}
                          onExport={handleExport}
                          onCategoryChange={handleCategoryChange}
                          onTagsEdit={authStatus?.user?.sub === pdf.owner_sub ? handleTagsEdit : undefined}
                          onContinue={handleContinueGeneration}
                          continuing={continuingPdfId === pdf.id}
                          onClick={handleCardClick}
                          currentUserSub={authStatus?.user?.sub ?? null}
                          isFavorited={favorites.has(pdf.id)}
                          onToggleFavorite={handleToggleFavorite}
                        />
                      </div>
                    ))}
                  </div>
                )}
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
          pageCount={promptTarget.pageCount}
          onSubmit={handlePromptSubmit}
          onClose={handlePromptClose}
        />
      )}
    </div>
  );
}

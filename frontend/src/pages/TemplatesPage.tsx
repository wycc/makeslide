import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { listTemplates, deleteTemplate, applyTemplate, type Template } from '../lib/api/templates';
import { getAuthStatus, type AuthStatus } from '../lib/api';
import { templateCategories, filterAndSortTemplates } from '../lib/templateFilter';

function TemplateCard({
  template,
  currentUserSub,
  onApply,
  onDelete,
}: {
  template: Template;
  currentUserSub: string | null;
  onApply: (t: Template) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const isOwner = currentUserSub && template.author === currentUserSub;

  async function handleDelete() {
    if (!window.confirm(t('templates.deleteConfirm'))) return;
    setDeleting(true);
    try {
      await deleteTemplate(template.id);
      onDelete(template.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-700/60 bg-slate-900/70 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-100">{template.name}</h3>
        {template.category !== 'general' && (
          <span className="shrink-0 rounded-full bg-indigo-800/50 px-2 py-0.5 text-[10px] text-indigo-300">
            {template.category}
          </span>
        )}
      </div>
      {template.description && (
        <p className="text-xs text-slate-400 leading-relaxed">{template.description}</p>
      )}
      <div className="mt-1 rounded-md bg-slate-800/60 p-2 font-mono text-[11px] text-slate-300 line-clamp-3">
        {template.skill_data.prompt}
      </div>
      {template.apply_count > 0 && (
        <span className="text-[10px] text-slate-500">
          {t('templates.applyCount').replace('{n}', String(template.apply_count))}
        </span>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(template)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          {t('templates.apply')}
        </button>
        {isOwner && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="rounded-md border border-rose-700/60 px-3 py-1.5 text-xs text-rose-400 hover:bg-rose-900/30 disabled:opacity-50"
          >
            {deleting ? '…' : t('templates.delete')}
          </button>
        )}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [sortMode, setSortMode] = useState<'newest' | 'popular'>('newest');

  useEffect(() => {
    void listTemplates()
      .then(setTemplates)
      .finally(() => setLoading(false));
    void getAuthStatus().then(setAuthStatus).catch(() => {});
  }, []);

  const categories = useMemo(() => templateCategories(templates), [templates]);

  const filtered = useMemo(
    () => filterAndSortTemplates(templates, { category: activeCategory, query: searchQuery, sortMode }),
    [templates, activeCategory, searchQuery, sortMode],
  );

  function handleApply(template: Template) {
    const { prompt, applyTo, imageStylePrompt, quizPrompt, ttsProvider, ttsVoice } = template.skill_data;
    const params = new URLSearchParams();
    params.set('templatePrompt', prompt);
    params.set('templateApplyTo', applyTo);
    if (imageStylePrompt) params.set('templateImageStyle', imageStylePrompt);
    if (quizPrompt) params.set('templateQuizPrompt', quizPrompt);
    if (ttsProvider) params.set('templateTtsProvider', ttsProvider);
    if (ttsVoice) params.set('templateTtsVoice', ttsVoice);
    setAppliedId(template.id);
    setTimeout(() => setAppliedId(null), 2000);
    void applyTemplate(template.id);
    setTemplates((prev) =>
      prev.map((tmpl) =>
        tmpl.id === template.id ? { ...tmpl, apply_count: tmpl.apply_count + 1 } : tmpl,
      ),
    );
    navigate(`/?${params.toString()}`);
  }

  function handleDelete(id: string) {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  const currentUserSub = authStatus?.user?.sub ?? null;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-200">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            ←
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-100">{t('templates.title')}</h1>
            <p className="mt-0.5 text-xs text-slate-400">{t('templates.subtitle')}</p>
          </div>
        </div>

        {!loading && templates.length > 0 && (
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('templates.searchPlaceholder')}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-700">
                {(['newest', 'popular'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSortMode(mode)}
                    className={`px-3 py-2 text-xs font-medium transition-colors ${
                      sortMode === mode ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode === 'newest' ? t('templates.sortNewest') : t('templates.sortPopular')}
                  </button>
                ))}
              </div>
            </div>
            {categories.length > 2 && (
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activeCategory === cat
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-700 text-slate-400 hover:border-indigo-500/60 hover:text-indigo-300'
                    }`}
                  >
                    {cat === 'all' ? t('templates.categoryAll') : cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">
            {templates.length === 0 ? t('templates.empty') : t('templates.noFilterResults')}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                currentUserSub={currentUserSub}
                onApply={handleApply}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {appliedId && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-4 py-2 text-sm text-white shadow-lg">
            {t('templates.applied')}
          </div>
        )}
      </div>
    </div>
  );
}

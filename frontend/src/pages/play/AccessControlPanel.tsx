import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  listPdfPermissions,
  upsertPdfPermission,
  removePdfPermission,
  searchAccounts,
  updatePdfVisibility,
  type PdfPermissionEntry,
  type PdfPermissionAccess,
  type PdfVisibilityMode,
  type AccountSearchResult,
} from '../../lib/api/pdfs';

interface AccessControlPanelProps {
  pdfId: string;
  initialVisibility: PdfVisibilityMode;
}

/**
 * Identity-based sharing: pick a default permission (the presentation's visibility) applied to
 * everyone not listed, then grant specific users read-only or read-write access. Users are found
 * via the account search (email / display name).
 */
export function AccessControlPanel({ pdfId, initialVisibility }: AccessControlPanelProps) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<PdfVisibilityMode>(initialVisibility);
  const [entries, setEntries] = useState<PdfPermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [addAccess, setAddAccess] = useState<PdfPermissionAccess>('read_only');

  async function refresh() {
    const data = await listPdfPermissions(pdfId);
    setEntries(data.permissions);
    setVisibility(data.default_visibility);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPdfPermissions(pdfId)
      .then((data) => {
        if (cancelled) return;
        setEntries(data.permissions);
        setVisibility(data.default_visibility);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError(t('play.access.loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pdfId]);

  // Debounced account search (email / display name); free-typed emails are also allowed.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchAccounts(q)
        .then((r) => { if (!cancelled) setResults(r); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  async function handleVisibilityChange(next: PdfVisibilityMode) {
    setVisibility(next);
    setBusy(true);
    try {
      await updatePdfVisibility(pdfId, next);
      setError(null);
    } catch {
      setError(t('play.access.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailToAdd = (selectedEmail || query).trim().toLowerCase();
  const canAdd = EMAIL_RE.test(emailToAdd) && !busy;

  async function handleAdd() {
    if (!canAdd) return;
    setBusy(true);
    try {
      await upsertPdfPermission(pdfId, emailToAdd, addAccess);
      setQuery('');
      setSelectedEmail('');
      setResults([]);
      await refresh();
      setError(null);
    } catch {
      setError(t('play.access.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeAccess(email: string, access: PdfPermissionAccess) {
    setBusy(true);
    try {
      await upsertPdfPermission(pdfId, email, access);
      await refresh();
      setError(null);
    } catch {
      setError(t('play.access.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(email: string) {
    setBusy(true);
    try {
      await removePdfPermission(pdfId, email);
      await refresh();
      setError(null);
    } catch {
      setError(t('play.access.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const VISIBILITY_OPTIONS: Array<{ value: PdfVisibilityMode; label: string }> = [
    { value: 'private', label: t('play.access.defaultPrivate') },
    { value: 'public', label: t('play.access.defaultReadOnly') },
    { value: 'public_editable', label: t('play.access.defaultReadWrite') },
  ];

  return (
    <div className="mt-3">
      <p className="text-sm text-slate-300">{t('play.access.description')}</p>

      {/* Default permission (= visibility) */}
      <div className="mt-3">
        <label className="text-xs text-slate-400">{t('play.access.defaultLabel')}</label>
        <select
          value={visibility}
          disabled={busy}
          onChange={(e) => void handleVisibilityChange(e.currentTarget.value as PdfVisibilityMode)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Add a user */}
      <div className="mt-4">
        <label className="text-xs text-slate-400">{t('play.access.addLabel')}</label>
        <div className="mt-1 flex gap-2">
          <div className="relative flex-1">
            <input
              value={selectedEmail || query}
              onChange={(e) => { setSelectedEmail(''); setQuery(e.currentTarget.value); }}
              placeholder={t('play.access.searchPlaceholder')}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-500"
            />
            {results.length > 0 && !selectedEmail ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-slate-700 bg-slate-900 shadow-xl">
                {results.map((r) => (
                  <li key={r.email}>
                    <button
                      type="button"
                      onClick={() => { setSelectedEmail(r.email); setQuery(r.email); setResults([]); }}
                      className="block w-full px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      <span className="text-slate-100">{r.display_name}</span>
                      {r.display_name !== r.email ? <span className="ml-2 text-xs text-slate-400">{r.email}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <select
            value={addAccess}
            onChange={(e) => setAddAccess(e.currentTarget.value as PdfPermissionAccess)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="read_only">{t('play.access.readOnly')}</option>
            <option value="read_write">{t('play.access.readWrite')}</option>
          </select>
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void handleAdd()}
            className="rounded border border-violet-500/50 bg-violet-500/15 px-3 py-1.5 text-sm text-violet-200 enabled:hover:bg-violet-500/25 disabled:opacity-40"
          >
            {t('play.access.add')}
          </button>
        </div>
      </div>

      {/* Current list */}
      <div className="mt-4">
        {loading ? (
          <p className="text-xs text-slate-400">{t('play.access.loading')}</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-slate-500">{t('play.access.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded border border-slate-800">
            {entries.map((e) => (
              <li key={e.email} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{e.display_name || e.email}</div>
                  {e.display_name && e.display_name !== e.email ? (
                    <div className="truncate text-xs text-slate-400">{e.email}</div>
                  ) : null}
                </div>
                <select
                  value={e.access}
                  disabled={busy}
                  onChange={(ev) => void handleChangeAccess(e.email, ev.currentTarget.value as PdfPermissionAccess)}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                >
                  <option value="read_only">{t('play.access.readOnly')}</option>
                  <option value="read_write">{t('play.access.readWrite')}</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(e.email)}
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {t('play.access.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}

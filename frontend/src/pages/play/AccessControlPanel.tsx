import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  listPdfPermissions,
  upsertPdfPermission,
  upsertPdfGroupPermission,
  removePdfPermission,
  removePdfGroupPermission,
  searchAccounts,
  updatePdfVisibility,
  listGroups,
  createGroup,
  type PdfPermissionEntry,
  type PdfPermissionAccess,
  type PdfVisibilityMode,
  type AccountSearchResult,
  type GroupSummary,
} from '../../lib/api/pdfs';

interface AccessControlPanelProps {
  pdfId: string;
  initialVisibility: PdfVisibilityMode;
}

type PickTarget =
  | { type: 'user'; email: string; label: string }
  | { type: 'group'; groupId: string; label: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Identity-based sharing: pick a default permission (the presentation's visibility) applied to
 * everyone not listed, then grant specific users OR groups read-only / read-write access. Targets
 * are found via account search (email / display name) and group name; a free-typed email works too.
 */
export function AccessControlPanel({ pdfId, initialVisibility }: AccessControlPanelProps) {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<PdfVisibilityMode>(initialVisibility);
  const [entries, setEntries] = useState<PdfPermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [accountResults, setAccountResults] = useState<AccountSearchResult[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [picked, setPicked] = useState<PickTarget | null>(null);
  const [addAccess, setAddAccess] = useState<PdfPermissionAccess>('read_only');

  const [savingGroup, setSavingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  async function refresh() {
    const data = await listPdfPermissions(pdfId);
    setEntries(data.permissions);
    setVisibility(data.default_visibility);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listPdfPermissions(pdfId), listGroups().catch(() => [])])
      .then(([data, gs]) => {
        if (cancelled) return;
        setEntries(data.permissions);
        setVisibility(data.default_visibility);
        setGroups(gs);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError(t('play.access.loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pdfId]);

  // Debounced account search; groups are filtered client-side from the already-loaded list.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setAccountResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchAccounts(q).then((r) => { if (!cancelled) setAccountResults(r); }).catch(() => { if (!cancelled) setAccountResults([]); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const q = query.trim().toLowerCase();
  const groupMatches = q.length >= 1 && !picked ? groups.filter((g) => g.name.toLowerCase().includes(q)) : [];
  const showDropdown = !picked && (accountResults.length > 0 || groupMatches.length > 0);

  async function handleVisibilityChange(next: PdfVisibilityMode) {
    setVisibility(next);
    setBusy(true);
    try { await updatePdfVisibility(pdfId, next); setError(null); }
    catch { setError(t('play.access.saveFailed')); }
    finally { setBusy(false); }
  }

  const freeEmail = query.trim().toLowerCase();
  const canAdd = !busy && (picked !== null || EMAIL_RE.test(freeEmail));

  async function handleAdd() {
    if (!canAdd) return;
    setBusy(true);
    try {
      if (picked?.type === 'group') {
        await upsertPdfGroupPermission(pdfId, picked.groupId, addAccess);
      } else {
        const email = picked?.type === 'user' ? picked.email : freeEmail;
        await upsertPdfPermission(pdfId, email, addAccess);
      }
      setQuery(''); setPicked(null); setAccountResults([]);
      await refresh();
      setError(null);
    } catch { setError(t('play.access.saveFailed')); }
    finally { setBusy(false); }
  }

  async function handleChangeAccess(entry: PdfPermissionEntry, access: PdfPermissionAccess) {
    setBusy(true);
    try {
      if (entry.principal_type === 'group' && entry.group_id) await upsertPdfGroupPermission(pdfId, entry.group_id, access);
      else if (entry.email) await upsertPdfPermission(pdfId, entry.email, access);
      await refresh();
      setError(null);
    } catch { setError(t('play.access.saveFailed')); }
    finally { setBusy(false); }
  }

  async function handleRemove(entry: PdfPermissionEntry) {
    setBusy(true);
    try {
      if (entry.principal_type === 'group' && entry.group_id) await removePdfGroupPermission(pdfId, entry.group_id);
      else if (entry.email) await removePdfPermission(pdfId, entry.email);
      await refresh();
      setError(null);
    } catch { setError(t('play.access.saveFailed')); }
    finally { setBusy(false); }
  }

  const listedEmails = entries.filter((e) => e.principal_type === 'user' && e.email).map((e) => e.email as string);

  async function handleSaveAsGroup() {
    const name = groupName.trim();
    if (!name || listedEmails.length === 0) return;
    setBusy(true);
    try {
      const g = await createGroup(name, listedEmails);
      setGroups((prev) => [...prev, { id: g.id, name: g.name, member_count: g.members.length, created_at: g.created_at, updated_at: g.updated_at }]);
      setSavingGroup(false); setGroupName('');
      setError(null);
    } catch { setError(t('play.access.saveFailed')); }
    finally { setBusy(false); }
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
          {VISIBILITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Add a user or group */}
      <div className="mt-4">
        <label className="text-xs text-slate-400">{t('play.access.addLabel')}</label>
        <div className="mt-1 flex gap-2">
          <div className="relative flex-1">
            <input
              value={picked ? picked.label : query}
              onChange={(e) => { setPicked(null); setQuery(e.currentTarget.value); }}
              placeholder={t('play.access.searchPlaceholder')}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-500"
            />
            {showDropdown ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded border border-slate-700 bg-slate-900 shadow-xl">
                {groupMatches.map((g) => (
                  <li key={`g-${g.id}`}>
                    <button
                      type="button"
                      onClick={() => { setPicked({ type: 'group', groupId: g.id, label: g.name }); setAccountResults([]); }}
                      className="block w-full px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      <span className="mr-1">👥</span>
                      <span className="text-slate-100">{g.name}</span>
                      <span className="ml-2 text-xs text-slate-400">{t('play.access.membersCount').replace('{n}', String(g.member_count))}</span>
                    </button>
                  </li>
                ))}
                {accountResults.map((r) => (
                  <li key={`u-${r.email}`}>
                    <button
                      type="button"
                      onClick={() => { setPicked({ type: 'user', email: r.email, label: r.email }); setAccountResults([]); }}
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
              <li key={e.principal_type === 'group' ? `g-${e.group_id}` : `u-${e.email}`} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">
                    {e.principal_type === 'group' ? <span className="mr-1">👥</span> : null}
                    {e.display_name || e.email || e.group_id}
                    {e.principal_type === 'group' ? (
                      <span className="ml-2 text-xs text-slate-400">{t('play.access.membersCount').replace('{n}', String(e.member_count ?? 0))}</span>
                    ) : null}
                  </div>
                  {e.principal_type === 'user' && e.display_name && e.display_name !== e.email ? (
                    <div className="truncate text-xs text-slate-400">{e.email}</div>
                  ) : null}
                </div>
                <select
                  value={e.access}
                  disabled={busy}
                  onChange={(ev) => void handleChangeAccess(e, ev.currentTarget.value as PdfPermissionAccess)}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                >
                  <option value="read_only">{t('play.access.readOnly')}</option>
                  <option value="read_write">{t('play.access.readWrite')}</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(e)}
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {t('play.access.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Save the current user list as a reusable group */}
      {listedEmails.length > 0 ? (
        <div className="mt-3">
          {savingGroup ? (
            <div className="flex gap-2">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.currentTarget.value)}
                placeholder={t('play.access.groupNamePlaceholder')}
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 outline-none"
              />
              <button
                type="button"
                disabled={busy || groupName.trim().length === 0}
                onClick={() => void handleSaveAsGroup()}
                className="rounded border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-200 disabled:opacity-40"
              >
                {t('play.access.saveGroupConfirm')}
              </button>
              <button type="button" onClick={() => { setSavingGroup(false); setGroupName(''); }} className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
                {t('play.access.cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSavingGroup(true)}
              className="text-xs text-violet-300 hover:text-violet-200"
            >
              {t('play.access.saveAsGroup')}
            </button>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import {
  listGroups,
  createGroup,
  getGroup,
  renameGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  searchAccounts,
  type GroupSummary,
  type GroupDetail,
  type AccountSearchResult,
} from '../lib/api/pdfs';
import { isValidEmail } from '../lib/isValidEmail';

/**
 * Manage the current user's reusable groups (named sets of member emails) used by identity-based
 * sharing. Create / rename / delete groups and add / remove members (via account search or a
 * free-typed email).
 */
export function GroupsManager() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selected, setSelected] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountSearchResult[]>([]);
  const [selectedEmail, setSelectedEmail] = useState('');

  async function refreshList(selectId?: string) {
    const list = await listGroups();
    setGroups(list);
    if (selectId) {
      const detail = await getGroup(selectId).catch(() => null);
      setSelected(detail);
    }
  }

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch(() => setError(t('settings.groups.loadFailed')));
  }, []);

  // Debounced account search for adding members.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchAccounts(q).then((r) => { if (!cancelled) setResults(r); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); setError(null); }
    catch { setError(t('settings.groups.saveFailed')); }
    finally { setBusy(false); }
  }

  const emailToAdd = (selectedEmail || query).trim().toLowerCase();
  const canAddMember = Boolean(selected) && isValidEmail(emailToAdd) && !busy;

  async function handleSelect(id: string) {
    setBusy(true);
    try { setSelected(await getGroup(id)); setError(null); }
    catch { setError(t('settings.groups.loadFailed')); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Group list + create */}
      <div className="rounded-xl border border-border bg-surface/40 p-3">
        <div className="mb-2 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            placeholder={t('settings.groups.newPlaceholder')}
            className="min-w-0 flex-1 rounded border border-border bg-bg/60 px-2 py-1.5 text-sm text-text outline-none"
          />
          <button
            type="button"
            disabled={busy || newName.trim().length === 0}
            onClick={() => void withBusy(async () => {
              const created = await createGroup(newName.trim());
              setNewName('');
              await refreshList(created.id);
            })}
            className="rounded border border-indigo-400/60 bg-indigo-500/15 px-3 py-1.5 text-sm text-text disabled:opacity-40"
          >
            {t('settings.groups.create')}
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted">{t('settings.groups.empty')}</p>
        ) : (
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => void handleSelect(g.id)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${selected?.id === g.id ? 'border border-indigo-400/60 bg-indigo-500/15 text-text' : 'text-text hover:bg-border/50'}`}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted">{g.member_count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Selected group detail */}
      <div className="rounded-xl border border-border bg-surface/40 p-3">
        {!selected ? (
          <p className="text-sm text-muted">{t('settings.groups.selectHint')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={selected.name}
                onChange={(e) => setSelected({ ...selected, name: e.currentTarget.value })}
                onBlur={() => void withBusy(async () => { await renameGroup(selected.id, selected.name.trim() || selected.name); await refreshList(selected.id); })}
                className="min-w-0 flex-1 rounded border border-border bg-bg/60 px-2 py-1.5 text-sm font-medium text-text outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void withBusy(async () => { await deleteGroup(selected.id); setSelected(null); await refreshList(); })}
                className="rounded border border-rose-500/40 px-2 py-1.5 text-sm text-danger hover:bg-rose-500/10"
              >
                {t('settings.groups.delete')}
              </button>
            </div>

            {/* Add member */}
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <input
                  value={selectedEmail || query}
                  onChange={(e) => { setSelectedEmail(''); setQuery(e.currentTarget.value); }}
                  placeholder={t('settings.groups.addMemberPlaceholder')}
                  className="w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-sm text-text outline-none"
                />
                {results.length > 0 && !selectedEmail ? (
                  <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-border bg-surface shadow-xl">
                    {results.map((r) => (
                      <li key={r.email}>
                        <button
                          type="button"
                          onClick={() => { setSelectedEmail(r.email); setQuery(r.email); setResults([]); }}
                          className="block w-full px-2 py-1.5 text-left text-sm text-text hover:bg-border/50"
                        >
                          <span>{r.display_name}</span>
                          {r.display_name !== r.email ? <span className="ml-2 text-xs text-muted">{r.email}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                disabled={!canAddMember}
                onClick={() => void withBusy(async () => {
                  const members = await addGroupMember(selected.id, emailToAdd);
                  setSelected({ ...selected, members });
                  setQuery(''); setSelectedEmail(''); setResults([]);
                  await refreshList(selected.id);
                })}
                className="rounded border border-indigo-400/60 bg-indigo-500/15 px-3 py-1.5 text-sm text-text disabled:opacity-40"
              >
                {t('settings.groups.addMember')}
              </button>
            </div>

            {/* Members */}
            <div className="mt-3">
              {selected.members.length === 0 ? (
                <p className="text-xs text-muted">{t('settings.groups.noMembers')}</p>
              ) : (
                <ul className="divide-y divide-border rounded border border-border">
                  {selected.members.map((email) => (
                    <li key={email} className="flex items-center justify-between px-3 py-2">
                      <span className="truncate text-sm text-text">{email}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void withBusy(async () => {
                          const members = await removeGroupMember(selected.id, email);
                          setSelected({ ...selected, members });
                          await refreshList(selected.id);
                        })}
                        className="rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/50"
                      >
                        {t('settings.groups.removeMember')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {error ? <p className="text-xs text-danger md:col-span-2">{error}</p> : null}
    </div>
  );
}

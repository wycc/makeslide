import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, getOpenAIKeyStatus, setOpenAIApiKey } from '../lib/api';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getOpenAIKeyStatus();
      if (s.has_key) setMsg('目前已設定 API Key。若要更新，請重新輸入並儲存。');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '讀取設定狀態失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onSave = useCallback(async () => {
    setErr(null);
    setMsg(null);
    const next = apiKey.trim();
    if (!next) {
      setErr('請輸入 API Key');
      return;
    }
    setSaving(true);
    try {
      await setOpenAIApiKey(next);
      setMsg('API Key 已儲存');
      setApiKey('');
      window.setTimeout(() => navigate('/'), 300);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }, [apiKey, navigate]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold">OpenAI API Key 設定</h1>
          <Link className="text-sm text-slate-300 hover:text-white" to="/">
            返回首頁
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {loading ? <p className="text-sm text-slate-400">載入中…</p> : null}
        {err ? (
          <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {err}
          </div>
        ) : null}
        {msg ? (
          <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {msg}
          </div>
        ) : null}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <label className="mb-2 block text-sm text-slate-300">OPENAI_API_KEY</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="sk-..."
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

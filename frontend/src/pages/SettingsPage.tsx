import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  getSystemAiSettings,
  updateSystemAiSettings,
  type SystemAiSettings,
} from '../lib/api';

export default function SettingsPage() { 
  const navigate = useNavigate();
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [llmProvider, setLlmProvider] = useState<'openai' | 'gemini'>('openai');
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'gemini'>('openai');
  const [openaiLlmModel, setOpenaiLlmModel] = useState('gpt-4o-mini');
  const [geminiLlmModel, setGeminiLlmModel] = useState('gemini-2.0-flash');
  const [openaiTtsModel, setOpenaiTtsModel] = useState('gpt-4o-mini-tts');
  const [geminiTtsModel, setGeminiTtsModel] = useState('gemini-2.5-flash-preview-tts');
  const [geminiTtsSpeaker1, setGeminiTtsSpeaker1] = useState('');
  const [geminiTtsSpeaker2, setGeminiTtsSpeaker2] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s: SystemAiSettings = await getSystemAiSettings();
      setOpenaiApiKey(s.openai_api_key ?? '');
      setGeminiApiKey(s.gemini_api_key ?? '');
      setLlmProvider(s.llm_provider);
      setTtsProvider(s.tts_provider);
      setOpenaiLlmModel(s.openai_llm_model);
      setGeminiLlmModel(s.gemini_llm_model);
      setOpenaiTtsModel(s.openai_tts_model);
      setGeminiTtsModel(s.gemini_tts_model);
      setGeminiTtsSpeaker1(s.gemini_tts_speaker1 ?? '');
      setGeminiTtsSpeaker2(s.gemini_tts_speaker2 ?? '');
      if (s.has_openai_key || s.has_gemini_key) {
        setMsg('已載入目前 AI 設定。若要更新 API Key，請輸入後儲存。');
      }
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
    if (llmProvider === 'openai' && !openaiApiKey.trim()) {
      setErr('目前 LLM 使用 OpenAI，請至少填入 OPENAI_API_KEY');
      return;
    }
    if (llmProvider === 'gemini' && !geminiApiKey.trim()) {
      setErr('目前 LLM 使用 Gemini，請至少填入 GEMINI_API_KEY');
      return;
    }
    if (ttsProvider === 'openai' && !openaiApiKey.trim()) {
      setErr('目前 TTS 使用 OpenAI，請至少填入 OPENAI_API_KEY');
      return;
    }
    if (ttsProvider === 'gemini' && !geminiApiKey.trim()) {
      setErr('目前 TTS 使用 Gemini，請至少填入 GEMINI_API_KEY');
      return;
    }
    setSaving(true);
    try {
      await updateSystemAiSettings({
        openai_api_key: openaiApiKey.trim() || undefined,
        gemini_api_key: geminiApiKey.trim() || undefined,
        llm_provider: llmProvider,
        tts_provider: ttsProvider,
        openai_llm_model: openaiLlmModel.trim(),
        gemini_llm_model: geminiLlmModel.trim(),
        openai_tts_model: openaiTtsModel.trim(),
        gemini_tts_model: geminiTtsModel.trim(),
        gemini_tts_speaker1: geminiTtsSpeaker1.trim(),
        gemini_tts_speaker2: geminiTtsSpeaker2.trim(),
      });
      setMsg('AI 設定已儲存');
      setOpenaiApiKey('');
      setGeminiApiKey('');
      window.setTimeout(() => navigate('/'), 300);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }, [
    geminiApiKey,
    geminiLlmModel,
    geminiTtsModel,
    geminiTtsSpeaker1,
    geminiTtsSpeaker2,
    llmProvider,
    navigate,
    openaiApiKey,
    openaiLlmModel,
    openaiTtsModel,
    ttsProvider,
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold">AI 設定（OpenAI / Gemini）</h1>
          <div className="flex items-center gap-3 text-sm">
            <Link className="text-slate-300 hover:text-white" to="/system">
              系統儀表
            </Link>
            <Link className="text-slate-300 hover:text-white" to="/">
              返回首頁
            </Link>
          </div>
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
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              LLM 供應商
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value as 'openai' | 'gemini')}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              TTS 供應商
              <select
                value={ttsProvider}
                onChange={(e) => setTtsProvider(e.target.value as 'openai' | 'gemini')}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
          </div>

          <label className="mb-2 block text-sm text-slate-300">OPENAI_API_KEY</label>
          <input
            type="password"
            value={openaiApiKey}
            onChange={(e) => setOpenaiApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="sk-..."
          />

          <label className="mb-2 block text-sm text-slate-300">GEMINI_API_KEY</label>
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-0 focus:border-slate-500"
            placeholder="AIza..."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-300">
              OpenAI LLM Model
              <input value={openaiLlmModel} onChange={(e) => setOpenaiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini LLM Model
              <input value={geminiLlmModel} onChange={(e) => setGeminiLlmModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              OpenAI TTS Model
              <input value={openaiTtsModel} onChange={(e) => setOpenaiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini TTS Model
              <input value={geminiTtsModel} onChange={(e) => setGeminiTtsModel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini Speaker 1 人設（選填）
              <input value={geminiTtsSpeaker1} onChange={(e) => setGeminiTtsSpeaker1(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="例如：沉穩、專業、男聲主持" />
            </label>
            <label className="block text-sm text-slate-300">
              Gemini Speaker 2 人設（選填）
              <input value={geminiTtsSpeaker2} onChange={(e) => setGeminiTtsSpeaker2(e.target.value)} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="例如：活潑、親切、女聲來賓" />
            </label>
          </div>

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

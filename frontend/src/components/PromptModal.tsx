import { useEffect, useRef, useState } from 'react';
import { TTS_VOICES } from '../lib/ttsVoices';
import { getImagePromptTemplates, type ImagePromptTemplate } from '../lib/api';

export interface PromptPreset {
  label: string;
  prompt: string;
}

/**
 * Built-in style presets — click to fill the textarea. Pure hints; the
 * actual LLM is free to interpret them.
 */
const PRESETS: PromptPreset[] = [
  {
    label: '課堂老師（親切、有例子）',
    prompt:
      '請以大學授課老師的親切口吻講解，偶爾穿插生活化的例子、打比方讓聽眾更容易理解；避免太多專有名詞堆砌，遇到術語請稍微解釋。',
  },
  {
    label: '企業簡報（正式、專業）',
    prompt:
      '請用正式、專業、有邏輯層次的語氣向企業決策者說明，強調重點、結論與行動建議；避免口語贅詞，不要使用感嘆語氣。',
  },
  {
    label: 'Podcast 科普主持（輕鬆、故事感）',
    prompt:
      '以 Podcast 主持人的輕鬆語氣說故事，像在跟朋友聊天；保留專業內容，但加入轉折、反問、驚嘆等口語元素，讓人聽得下去。',
  },
  {
    label: '技術分享會（工程師向工程師）',
    prompt:
      '聽眾是資深工程師，請用精確、務實、技術導向的語氣講解，可直接使用專有名詞並強調設計取捨、邊界條件與實作細節，不需過度簡化。',
  },
];

const MAX_PROMPT_CHARS = 2000;

interface PromptModalProps {
  /** Display title for the modal header (usually the PDF filename). */
  pdfTitle: string | null;
  /** Initial prompt text (e.g. a previously submitted prompt). */
  initialValue?: string;
  /** Called when user clicks submit. Should throw on failure to show error. */
  onSubmit: (
    prompt: string,
    requireScriptConfirmation: boolean,
    opts: {
      ttsVoice: string;
      ttsSpeed: number;
      scriptMaxCharsPerPage: number;
      imageStylePrompt?: string;
    },
  ) => Promise<void>;
  /** Called when the user cancels / dismisses the modal. */
  onClose: () => void;
}

export default function PromptModal({
  pdfTitle,
  initialValue = '',
  onSubmit,
  onClose,
}: PromptModalProps) {
  const [value, setValue] = useState<string>(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [requireScriptConfirmation, setRequireScriptConfirmation] = useState(false);
  const [ttsVoice, setTtsVoice] = useState<string>(TTS_VOICES[0]);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [scriptMaxCharsPerPage, setScriptMaxCharsPerPage] = useState(150);
  const [imageTemplates, setImageTemplates] = useState<ImagePromptTemplate[]>([]);
  const [selectedImageTemplateKey, setSelectedImageTemplateKey] = useState<string>('');
  const [imageStylePrompt, setImageStylePrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus the textarea on open.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resp = await getImagePromptTemplates();
        if (!active) return;
        setImageTemplates(resp.templates);
        const key = resp.default_template_key ?? resp.templates[0]?.key ?? '';
        setSelectedImageTemplateKey(key);
        const hit = resp.templates.find((t) => t.key === key) ?? resp.templates[0];
        setImageStylePrompt(hit?.prompt_en ?? '');
      } catch {
        // non-fatal: keep modal usable even if template endpoint fails
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Esc closes (only when not submitting).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const handleSubmit = async (prompt: string) => {
    if (submitting) return;
    if (prompt.length > MAX_PROMPT_CHARS) {
      setError(`提示詞不可超過 ${MAX_PROMPT_CHARS} 字`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const normalizedTtsSpeed = Number.isFinite(ttsSpeed)
      ? Math.min(4, Math.max(0.25, ttsSpeed))
      : 1;
    try {
      await onSubmit(prompt, requireScriptConfirmation, {
        ttsVoice,
        ttsSpeed: normalizedTtsSpeed,
        scriptMaxCharsPerPage,
        imageStylePrompt: imageStylePrompt.trim() || undefined,
      });
      // Parent is responsible for closing the modal on success.
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : '提交失敗';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = () => {
    void handleSubmit(value.trim());
  };

  const handleSkip = () => {
    void handleSubmit('');
  };

  const applyPreset = (p: PromptPreset) => {
    setValue(p.prompt);
    textareaRef.current?.focus();
  };

  const onSelectImageTemplate = (key: string) => {
    setSelectedImageTemplateKey(key);
    const hit = imageTemplates.find((t) => t.key === key);
    if (hit) setImageStylePrompt(hit.prompt_en);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="輸入生成風格提示詞"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="border-b border-slate-800 bg-slate-900/80 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-100">設定生成風格</h2>
          <p className="mt-1 text-xs text-slate-400">
            {pdfTitle ? `《${pdfTitle}》` : '這份 PDF'}
            {' '}上傳完成。請告訴 AI 你想要的語氣、聽眾、風格或任何自訂指示，再開始產生逐字稿與語音。
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <label
            htmlFor="prompt-textarea"
            className="mb-1 block text-xs font-medium text-slate-300"
          >
            你的提示詞（選填）
          </label>
          <textarea
            id="prompt-textarea"
            ref={textareaRef}
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
            disabled={submitting}
            rows={6}
            maxLength={MAX_PROMPT_CHARS + 50}
            placeholder="例如：請用大學授課老師的親切語氣，對初學者講解，遇到術語請稍作解釋…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>留白或跳過代表使用預設（中性、專業、自然）。</span>
            <span
              className={
                value.length > MAX_PROMPT_CHARS ? 'text-rose-400' : undefined
              }
            >
              {value.length} / {MAX_PROMPT_CHARS}
            </span>
          </div>

          <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requireScriptConfirmation}
              onChange={(ev) => setRequireScriptConfirmation(ev.target.checked)}
              disabled={submitting}
            />
            <span>逐字稿產生後先讓我確認，再開始生成語音檔</span>
          </label>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-300">
              語音人物
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={ttsVoice}
                onChange={(ev) => setTtsVoice(ev.target.value)}
                disabled={submitting}
              >
                {TTS_VOICES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-slate-300">
              語速（0.25–4）
              <input
                type="number"
                min={0.25}
                max={4}
                step={0.05}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={ttsSpeed}
                onChange={(ev) => setTtsSpeed(Number(ev.target.value) || 1)}
                disabled={submitting}
              />
            </label>

            <label className="text-xs text-slate-300">
              每頁最大長度
              <input
                type="number"
                min={80}
                max={2000}
                step={10}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={scriptMaxCharsPerPage}
                onChange={(ev) => setScriptMaxCharsPerPage(Number(ev.target.value) || 150)}
                disabled={submitting}
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 px-3 py-3">
            <p className="mb-2 text-xs font-medium text-slate-300">圖片風格模板（生圖專用）</p>
            <label className="text-xs text-slate-300">
              模板
              <select
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={selectedImageTemplateKey}
                onChange={(ev) => onSelectImageTemplate(ev.target.value)}
                disabled={submitting || imageTemplates.length === 0}
              >
                {imageTemplates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="mt-2 block text-xs text-slate-300">
              模板內容（可自行修改）
              <textarea
                rows={3}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={imageStylePrompt}
                onChange={(ev) => setImageStylePrompt(ev.target.value)}
                disabled={submitting}
              />
            </label>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-slate-300">常用範本（點擊套用）</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={submitting}
                  className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 transition hover:border-indigo-400 hover:text-indigo-200 disabled:opacity-60"
                  title={p.prompt}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-900/80 px-5 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
          >
            稍後再設定
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-60"
          >
            直接使用預設
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '送出中…' : '開始生成'}
          </button>
        </div>
      </div>
    </div>
  );
}

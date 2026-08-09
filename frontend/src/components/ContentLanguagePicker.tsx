import { LANGUAGE_OPTIONS, useI18n, type AppLanguage } from '../i18n';

/**
 * 「這一份簡報要用哪一種語言產生」的選擇器。
 *
 * 產生語言原本只有設定頁那一個全域開關，於是想做一份英文簡報就得先去改設定、做完再改回來。
 * 每一個建立簡報的入口（PDF 上傳對話框、YouTube 匯入、貼上文字、產生前的提示詞對話框）
 * 都放上這個選擇器，預設帶入當下的系統設定，使用者可以只為這一份改掉。
 *
 * 語言名稱一律用該語言自己的寫法（繁體中文／English），與語言切換鈕同一個理由：
 * 看不懂目前介面語言的人也要找得到自己要的那一個（見 i18n.ts 的 UI_LANGUAGE_LABELS）。
 */

interface ContentLanguagePickerProps {
  value: AppLanguage;
  onChange: (language: AppLanguage) => void;
  disabled?: boolean;
  /**
   * 'cards' 是帶說明的大按鈕，給版面寬鬆的對話框；'inline' 是一列小按鈕，
   * 排在主持模式那類設定旁邊。
   */
  variant?: 'cards' | 'inline';
  /** inline 版是否自己畫「產生語言」這個標籤；外層已經有標題時關掉，免得寫兩次。 */
  showLabel?: boolean;
}

export default function ContentLanguagePicker({
  value,
  onChange,
  disabled = false,
  variant = 'inline',
  showLabel = true,
}: ContentLanguagePickerProps): JSX.Element {
  const { t } = useI18n();

  if (variant === 'cards') {
    return (
      <fieldset>
        <legend className="text-sm font-medium">{t('upload.contentLanguageLabel')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              disabled={disabled}
              aria-pressed={value === option.value}
              className={`rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                value === option.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-bg hover:border-primary/50'
              }`}
            >
              <span className="block text-sm font-medium">{option.nativeLabel}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t('upload.contentLanguageHint')}</p>
      </fieldset>
    );
  }

  return (
    <div className="flex w-full items-center gap-2">
      {showLabel ? (
        <span className="whitespace-nowrap text-xs text-slate-400">{t('upload.contentLanguageLabel')}</span>
      ) : null}
      <div className="flex overflow-hidden rounded-md border border-slate-600">
        {LANGUAGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            disabled={disabled}
            aria-pressed={value === option.value}
            className={`px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60 ${
              value === option.value
                ? 'bg-cyan-500/25 font-medium text-cyan-100'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {option.nativeLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

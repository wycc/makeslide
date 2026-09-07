import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UI_LANGUAGE_LABELS, otherUiLanguage, useI18n } from '../i18n';
import { applyLanguageChoice } from '../lib/languageChoice';
import {
  API_KEY_REQUIRED_EVENT,
  type ApiKeyRequiredEventDetail,
} from '../lib/api';

const ONBOARDING_STORAGE_KEY = 'makeslide.api_key_onboarding_dismissed';

export function resetApiKeyOnboardingPromptForTest(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

interface ApiKeyRequiredDialogProps {
  onboardingOpen?: boolean;
  onOnboardingClose?: () => void;
}

export default function ApiKeyRequiredDialog({ onboardingOpen = false, onOnboardingClose }: ApiKeyRequiredDialogProps) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [requiredDetail, setRequiredDetail] = useState<ApiKeyRequiredEventDetail | null>(null);

  useEffect(() => {
    const onRequired = (event: Event) => {
      const customEvent = event as CustomEvent<ApiKeyRequiredEventDetail>;
      setRequiredDetail(customEvent.detail);
    };
    window.addEventListener(API_KEY_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(API_KEY_REQUIRED_EVENT, onRequired);
  }, []);

  const open = onboardingOpen || requiredDetail !== null;
  if (!open) return null;

  const title = requiredDetail ? t('apiKeyRequired.title') : t('apiKeyRequired.onboardingTitle');
  const description = requiredDetail ? t('apiKeyRequired.description') : t('apiKeyRequired.onboardingDescription');

  const close = () => {
    setRequiredDetail(null);
    onOnboardingClose?.();
  };

  const rememberAndClose = () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    close();
  };

  const goToSettings = () => {
    close();
    navigate('/settings?category=ai');
  };

  return (
    // overflow-y-auto + my-auto：手機橫拿時（例如 640x360）這個對話框比視窗高，
    // 沒有捲動容器的話上下會被切掉，連「暫時不設定」都按不到。flex 置中單獨用會
    // 從上方溢出而捲不回去，所以外層負責捲動、內層用 my-auto 保持置中。
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-key-required-title"
        className="my-auto w-full max-w-lg rounded-xl border border-sky-400/40 bg-slate-900 p-5 text-slate-100 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-xl text-sky-200">
            🔑
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="api-key-required-title" className="text-lg font-semibold text-sky-100">
              {title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
          </div>
          {/*
            這個對話框常常是新使用者看到的第一個畫面，所以語言切換就放在這裡，
            不必先摸到設定頁（而設定頁本身也是中文的）。在這裡選語言等於「我用這個語言工作」：
            介面語言與生成內容語言一起切，並寫回帳號設定——設定頁載入時以伺服器的值為準，
            只改本機的話一進設定頁就會被蓋回去。見 lib/languageChoice.ts。
          */}
          <button
            type="button"
            onClick={() => void applyLanguageChoice(otherUiLanguage(language))}
            className="shrink-0 rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
            lang={otherUiLanguage(language)}
          >
            {UI_LANGUAGE_LABELS[otherUiLanguage(language)]}
          </button>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-200">
          <p className="font-medium text-slate-100">{t('apiKeyRequired.impactTitle')}</p>
          <ul className="list-disc space-y-1 pl-5 text-slate-300">
            <li>{t('apiKeyRequired.impactGenerate')}</li>
            <li>{t('apiKeyRequired.impactRewrite')}</li>
            <li>{t('apiKeyRequired.impactTts')}</li>
          </ul>
          <p className="text-slate-400">{t('apiKeyRequired.privacyNote')}</p>
        </div>

        {requiredDetail ? (
          <p className="mt-3 text-xs text-slate-500">
            {t('apiKeyRequired.errorCode').replaceAll('{code}', requiredDetail.code).replaceAll('{status}', String(requiredDetail.status))}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={goToSettings}
            className="rounded-md bg-sky-300 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-200"
          >
            {t('apiKeyRequired.goToSettings')}
          </button>
          {requiredDetail ? (
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              {t('apiKeyRequired.gotIt')}
            </button>
          ) : (
            <button
              type="button"
              onClick={rememberAndClose}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              {t('apiKeyRequired.skipForNow')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function shouldShowApiKeyOnboardingPrompt(hasSelectedLlmKey: boolean): boolean {
  if (typeof window === 'undefined') return false;
  return !hasSelectedLlmKey && window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1';
}

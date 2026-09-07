import { type AppLanguage, storeLanguageSettings } from '../i18n';
import { updateSystemAiSettings } from './api';

interface LanguageChoiceDeps {
  store: (uiLanguage: AppLanguage, contentLanguage: AppLanguage) => void;
  persist: (payload: { ui_language: AppLanguage; content_language: AppLanguage }) => Promise<unknown>;
}

const defaultDeps: LanguageChoiceDeps = {
  store: storeLanguageSettings,
  persist: (payload) => updateSystemAiSettings(payload),
};

/**
 * Apply a one-click language choice — the toggle on the first screen a new account sees.
 *
 * Picking a language there means "I work in this language": both the UI language and the
 * generated-content (script / TTS) language follow it, and the choice is written to the account
 * settings, not just this browser. The last part matters because the settings page treats the
 * server value as authoritative and copies it back into localStorage on load — a local-only
 * switch to English silently flipped back to Chinese the moment the user opened settings.
 *
 * The local switch is applied first so the UI responds immediately; the server write runs in
 * the background. Resolves to false when the server write failed (the UI stays switched — the
 * user can still confirm the languages on the settings page).
 */
export async function applyLanguageChoice(language: AppLanguage, deps: LanguageChoiceDeps = defaultDeps): Promise<boolean> {
  deps.store(language, language);
  try {
    await deps.persist({ ui_language: language, content_language: language });
    return true;
  } catch {
    return false;
  }
}

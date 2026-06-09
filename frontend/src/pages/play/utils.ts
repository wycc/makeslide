import { getAuthStatus, getSystemAiSettings } from '../../lib/api';

const LOCAL_USER_CODE_KEY = 'makeslide.user_code';

/** 取得當前使用者的識別碼：優先從後端 settings 取，其次讀 localStorage。 */
export async function resolveConfiguredUserCode(): Promise<string> {
  const localCode = window.localStorage.getItem(LOCAL_USER_CODE_KEY)?.trim() || '';
  try {
    const auth = await getAuthStatus();
    if (!auth.authenticated) return localCode;
    const settings = await getSystemAiSettings();
    return settings.user_code?.trim() || localCode;
  } catch {
    return localCode;
  }
}

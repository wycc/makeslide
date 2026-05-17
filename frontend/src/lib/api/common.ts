import type { ApiErrorBody } from '../../types';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

export interface HumanReadableApiError {
  title: string;
  message: string;
  nextStep: string;
}

export const CREDIT_EXHAUSTED_ERROR_CODES = new Set([
  'CREDIT_EXHAUSTED',
  'CREDITS_EXHAUSTED',
  'INSUFFICIENT_CREDIT',
  'INSUFFICIENT_CREDITS',
  'ACCOUNT_CREDIT_EXHAUSTED',
  'BILLING_CREDIT_EXHAUSTED',
  'MODEL_QUOTA_EXCEEDED',
]);

export const CREDIT_EXHAUSTED_EVENT = 'makeslide:credit-exhausted';

export interface CreditExhaustedEventDetail {
  title: string;
  message: string;
  nextStep: string;
  code: string;
  status: number;
}

export function isCreditExhaustedError(err: unknown): err is ApiError {
  return err instanceof ApiError && CREDIT_EXHAUSTED_ERROR_CODES.has(err.code);
}

export function notifyCreditExhausted(err: ApiError): void {
  if (typeof window === 'undefined' || !isCreditExhaustedError(err)) return;
  const human = mapApiErrorToHumanMessage(err);
  window.dispatchEvent(new CustomEvent<CreditExhaustedEventDetail>(CREDIT_EXHAUSTED_EVENT, {
    detail: {
      ...human,
      code: err.code,
      status: err.status,
    },
  }));
}

const ERROR_HINTS: Record<string, HumanReadableApiError> = {
  INVALID_UPLOAD_TYPE: { title: '檔案格式不支援', message: '目前僅支援 PDF 或純文字檔。', nextStep: '請改上傳 .pdf 或 .txt，並確認檔案未損毀。' },
  FILE_REQUIRED: { title: '缺少檔案', message: '請先選擇要上傳的檔案。', nextStep: '重新選檔後再送出。' },
  FILE_TOO_LARGE: { title: '檔案太大', message: '檔案超過系統允許大小。', nextStep: '請壓縮檔案、拆分內容或降低頁數後重試。' },
  INVALID_URL: { title: '連結格式錯誤', message: '無法解析提供的 URL。', nextStep: '請貼上完整且可公開存取的 YouTube 連結。' },
  API_KEY_MISSING: { title: '金鑰尚未設定', message: '系統缺少必要 API 金鑰。', nextStep: '請先到設定頁補上 API key 再重試。' },
  CREDIT_EXHAUSTED: { title: '帳號 credit 已用完', message: '目前帳號的可用 credit 已用盡，暫時無法繼續使用需要扣款或消耗額度的 AI 功能。', nextStep: '請前往充值或更新付款方式，完成後再重試。' },
  CREDITS_EXHAUSTED: { title: '帳號 credit 已用完', message: '目前帳號的可用 credit 已用盡，暫時無法繼續使用需要扣款或消耗額度的 AI 功能。', nextStep: '請前往充值或更新付款方式，完成後再重試。' },
  INSUFFICIENT_CREDIT: { title: '帳號 credit 不足', message: '目前帳號 credit 不足，無法完成這次操作。', nextStep: '請先充值或調整帳務設定後再重試。' },
  INSUFFICIENT_CREDITS: { title: '帳號 credit 不足', message: '目前帳號 credit 不足，無法完成這次操作。', nextStep: '請先充值或調整帳務設定後再重試。' },
  ACCOUNT_CREDIT_EXHAUSTED: { title: '帳號 credit 已用完', message: '目前帳號的可用 credit 已用盡，暫時無法繼續使用需要扣款或消耗額度的 AI 功能。', nextStep: '請前往充值或更新付款方式，完成後再重試。' },
  BILLING_CREDIT_EXHAUSTED: { title: '帳務 credit 已用完', message: '帳務方案或預付 credit 已用盡，AI 生成功能暫時不可用。', nextStep: '請前往充值或更新付款方式，完成後再重試。' },
  MODEL_QUOTA_EXCEEDED: { title: '模型配額或 credit 不足', message: '模型配額已用盡、被限制，或帳號 credit 不足。', nextStep: '請前往充值/檢查帳務，或切換到其他可用模型。' },
  MODEL_UNAVAILABLE: { title: '模型暫時不可用', message: '目前模型服務不可用。', nextStep: '稍後重試，或改用其他模型與供應商。' },
  DEPENDENCY_MISSING: { title: '系統依賴缺失', message: '執行環境缺少必要工具（例如 poppler）。', nextStep: '請依文件安裝缺失依賴後再重試。' },
  POPPLER_NOT_FOUND: { title: 'PDF 解析工具缺失', message: '系統找不到 poppler（pdftoppm / pdftotext）。', nextStep: '請先安裝 poppler，並確認可在系統 PATH 中使用。' },
  PDF_NOT_FOUND: { title: '找不到簡報資料', message: '此簡報可能已被刪除或不存在。', nextStep: '請回首頁重新整理清單，再重新操作。' },
  PAGE_NOT_FOUND: { title: '找不到頁面', message: '指定頁面不存在。', nextStep: '請重新整理頁面並確認頁碼。' },
  RESOURCE_NOT_FOUND: { title: '資源尚未產生', message: '目前請求的檔案資源不存在。', nextStep: '等待流程完成後再試，或先確認流程是否失敗。' },
  INVALID_STATE: { title: '目前狀態不可執行', message: '當前任務狀態不允許此操作。', nextStep: '請依照流程先完成前一步，或重新整理後再嘗試。' },
  JOB_CONFLICT: { title: '任務狀態衝突', message: '已有任務進行中或不可取消。', nextStep: '請等待目前任務結束，或稍後再發送同類操作。' },
  INTERNAL_ERROR: { title: '系統內部錯誤', message: '伺服器處理時發生例外。', nextStep: '請稍後重試；若持續發生請提供錯誤碼回報。' },
};

export function mapApiErrorToHumanMessage(err: unknown): HumanReadableApiError {
  if (err instanceof ApiError) {
    const found = ERROR_HINTS[err.code];
    if (found) return found;
    return { title: '請求失敗', message: err.message, nextStep: '請稍後再試，或檢查輸入內容後重送。' };
  }
  if (err instanceof Error) {
    return { title: '請求失敗', message: err.message, nextStep: '請確認網路連線後再重試。' };
  }
  return { title: '未知錯誤', message: '發生未知錯誤。', nextStep: '請重新操作，必要時回報操作步驟。' };
}

export async function parseErrorBody(resp: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    // ignore
  }
  if (isApiErrorBody(body)) {
    const err = new ApiError(body.error.message, body.error.code, resp.status);
    notifyCreditExhausted(err);
    return err;
  }
  const err = new ApiError(`HTTP ${resp.status}`, 'HTTP_ERROR', resp.status);
  notifyCreditExhausted(err);
  return err;
}

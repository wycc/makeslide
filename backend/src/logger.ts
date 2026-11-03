import pino from 'pino';
import { config } from './config';

/**
 * 測驗相關的請求把 User-Agent 一起記進請求日誌（使用者要求，2026-11-03）。
 * 查「學生為什麼無法完成」時，後端日誌只有 method／url／remoteAddress，沒有任何裝置線索；
 * 問答題拍照、同步加入、進度回報這幾條路徑的失敗多半和瀏覽器（LINE 內建瀏覽器、iOS 版本）有關。
 * 只對這些路徑記，其他請求維持原樣，不讓日誌暴增。
 */
const QUIZ_RELATED_URL = /\/quizzes(\/|\?|$)|\/sync\/(quiz|join|share-join)|\/essay-answers/;

interface LoggedRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number } | null;
}

/** 與 Fastify 預設的 req 序列化器相同的欄位，測驗相關路徑多一個 userAgent。 */
export function serializeRequestForLog(req: LoggedRequest): Record<string, unknown> {
  const url = req.url ?? '';
  const out: Record<string, unknown> = {
    method: req.method,
    url,
    version: req.headers?.['accept-version'],
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket ? req.socket.remotePort : undefined,
  };
  if (QUIZ_RELATED_URL.test(url)) {
    const ua = req.headers?.['user-agent'];
    out.userAgent = Array.isArray(ua) ? ua.join(' ') : ua;
  }
  return out;
}

export const logger = pino({
  level: config.logLevel,
  serializers: { req: serializeRequestForLog },
  transport: process.env.NODE_ENV === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});

export type Logger = typeof logger;

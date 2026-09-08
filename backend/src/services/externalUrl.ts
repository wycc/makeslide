/**
 * 這個後端「從外面看起來」的網址。
 *
 * 後端綁定的位址不見得等於使用者與外部服務連進來時用的網址——中間通常隔著反向代理或路由器
 * 的 port 轉發。凡是要交到外面去的絕對網址（OAuth 探索文件裡的端點、設定頁顯示給使用者複製
 * 的 MCP 連線網址）都必須用這裡算出來的值：寫成後端自己的內部位址，對方照著連就會連不上。
 *
 * 優先採用明確設定的 MAKESLIDE_PUBLIC_URL，其次才從代理轉發的 header 推——推測會錯（代理沒
 * 轉發那些 header 時就會推出內部位址），所以設定值一定要能蓋過推測。
 */
import type { FastifyRequest } from 'fastify';

export function externalBaseUrl(request: FastifyRequest): string {
  const configured = process.env.MAKESLIDE_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const forwardedHost = String(request.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
  const proto = forwardedProto || request.protocol;
  const host = forwardedHost || request.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** 遠端 MCP 端點的完整網址——ChatGPT 的 connector 設定欄位要填的就是這個。 */
export function mcpResourceUrl(request: FastifyRequest): string {
  return `${externalBaseUrl(request)}/mcp`;
}

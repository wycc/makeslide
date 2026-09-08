/**
 * 遠端 MCP 端點（Streamable HTTP），主要對象是 ChatGPT。
 *
 * 既有的 `mcp-server.ts` 走 stdio：MCP client 在本機把它當子行程啟動。ChatGPT 沒有這條路
 * ——它只會對一個公開的 HTTPS 網址發 HTTP 請求，所以同一組工具需要第二種傳輸。這個檔案
 * 就是那層傳輸，工具定義與實作完全沿用 `mcp-server.ts` 的 `TOOLS`／`callTool`，一份程式碼
 * 兩種接法，不會有「stdio 有這個工具、HTTP 卻沒有」的漂移。
 *
 * 刻意做成無狀態：不發 `Mcp-Session-Id`，每個請求各自帶身分自成一次完整往返。MCP 規範允許
 * 這樣，而它換來的好處是後端可以多開幾個 process 或重啟而不會弄斷 ChatGPT 那端的連線。
 *
 * 工具呼叫怎麼回到 makeslide：`callTool` 是打 HTTP 到後端 REST API 的，這裡不繞過它直接
 * 呼叫內部函式——REST 那條路上有權限檢查、帳號情境、狀態機守門，繞過去就等於把它們全部
 * 關掉。所以這裡讓它打回本機自己，只是把「用誰的身分」換成這次請求的 OAuth token。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config';
import { logger } from '../logger';
import { callTool, runWithMcpContext, TOOLS } from '../mcp-server';
import { findAccountIdByOAuthAccessToken } from '../services/mcpOAuth';
import { mcpResourceUrl } from '../services/externalUrl';

/**
 * 我們支援的協議版本，新到舊。client 報哪個版本我們就回哪個（有支援的話），
 * 認不得的版本則回最新的一個，讓對方自己決定要不要降級。
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: 'makeslide', version: '1.0.0' };

/**
 * 工具呼叫要打回哪個位址。
 *
 * 預設打本機迴圈，不繞出去經過反向代理——少一段網路、也不受外網是否連得回來影響。
 * 後端若自己終結 TLS 且用的是自簽憑證，迴圈請求會因為憑證驗不過而失敗，這時要用
 * `MAKESLIDE_MCP_LOOPBACK_URL` 指定一個連得上的位址（例如同時開著的 HTTP 埠）。
 */
function loopbackBaseUrl(request: FastifyRequest): string {
  const configured = process.env.MAKESLIDE_MCP_LOOPBACK_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const httpsEnabled = Boolean(config.httpsKeyPath && config.httpsCertPath);
  const port = request.socket.localPort ?? config.port;
  return `${httpsEnabled ? 'https' : 'http'}://127.0.0.1:${port}`;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
}

/**
 * 沒帶或帶了無效 token 時的回應。
 *
 * `WWW-Authenticate` 裡的 `resource_metadata` 不是裝飾：MCP client 就是靠這個 header 才知道
 * 該去哪裡讀 OAuth metadata、進而發起授權。少了它，ChatGPT 只會看到一個 401 而不會提示
 * 使用者登入，connector 就卡在「連不上」而沒有任何下一步。
 */
function unauthorized(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: { header: string; message: string },
) {
  const metadataUrl = `${new URL(mcpResourceUrl(request)).origin}/.well-known/oauth-protected-resource`;
  return reply
    .code(401)
    .header(
      'WWW-Authenticate',
      // header 的值只能是 ASCII——放中文進去 Node 會直接以 ERR_INVALID_CHAR 拒發，
      // 整個回應變成 500，client 就再也看不到那個指路用的 resource_metadata。
      // 所以這裡固定用英文，中文訊息留在 body 裡給人看。
      `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="${reason.header}"`,
    )
    .send({
      jsonrpc: '2.0',
      error: { code: -32001, message: reason.message },
      id: null,
    });
}

export async function mcpHttpRoutes(app: FastifyInstance) {
  /**
   * 規範允許伺服器用 GET 開一條 SSE 通道主動推訊息給 client。makeslide 沒有任何要主動推的
   * 東西（工具呼叫都是一問一答），所以明確回 405 告訴 client 別等——比晾著一條永遠不會有
   * 資料的連線好。
   */
  app.get('/mcp', async (_request, reply) => {
    return reply.code(405).header('Allow', 'POST').send({
      jsonrpc: '2.0',
      error: { code: -32000, message: '這個端點不提供伺服器主動推送，請用 POST 送 JSON-RPC 請求。' },
      id: null,
    });
  });

  // 無狀態代表沒有 session 可以終止，但 client 會照規範送 DELETE 收尾，回 204 讓它安心結束。
  app.delete('/mcp', async (_request, reply) => reply.code(204).send());

  app.post('/mcp', async (request, reply) => {
    const authHeader = request.headers.authorization ?? '';
    const bearer = /^Bearer\s+(.+)$/.exec(authHeader)?.[1]?.trim() ?? '';
    if (!bearer) {
      return unauthorized(request, reply, {
        header: 'missing access token',
        message: '缺少 access token。',
      });
    }

    const accountId = findAccountIdByOAuthAccessToken(bearer);
    if (!accountId) {
      return unauthorized(request, reply, {
        header: 'invalid or expired access token',
        message: 'access token 無效或已過期。',
      });
    }

    const body = request.body as JsonRpcRequest | JsonRpcRequest[] | undefined;
    if (!body) {
      return reply.code(400).send({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error：請求沒有 JSON body。' },
        id: null,
      });
    }

    // 批次請求（陣列）在 MCP 裡是合法的。ChatGPT 目前只送單一訊息，但照規範處理才不會在
    // 對方哪天改用批次時整個壞掉。
    const messages = Array.isArray(body) ? body : [body];
    const responses: Array<Record<string, unknown>> = [];

    for (const message of messages) {
      const result = await handleMessage(message, {
        baseUrl: loopbackBaseUrl(request),
        authToken: bearer,
        accountId,
      });
      if (result) responses.push(result);
    }

    // 全部都是通知（沒有 id）時沒有東西可回，依規範回 202 而不是空的 200——client 靠這個
    // 分辨「收到了、本來就沒有回應」與「回應掉了」。
    if (responses.length === 0) return reply.code(202).send();

    return reply.type('application/json').send(Array.isArray(body) ? responses : responses[0]);
  });
}

interface CallEnvironment {
  baseUrl: string;
  authToken: string;
  accountId: string;
}

async function handleMessage(
  message: JsonRpcRequest,
  env: CallEnvironment,
): Promise<Record<string, unknown> | null> {
  const { id, method, params } = message;
  // 通知沒有 id，依 JSON-RPC 規範一律不回應（連錯誤都不回）。
  const isNotification = id === undefined || id === null;

  const ok = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const fail = (code: number, msg: string) =>
    isNotification ? null : { jsonrpc: '2.0', id, error: { code, message: msg } };

  switch (method) {
    case 'initialize': {
      const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
      const protocolVersion =
        requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
      return ok({
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case 'notifications/initialized':
    case 'initialized':
      return null;

    case 'ping':
      return ok({});

    case 'tools/list':
      return ok({ tools: TOOLS });

    case 'tools/call': {
      const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const toolName = p?.name ?? '';
      const toolArgs = p?.arguments ?? {};
      try {
        const text = await runWithMcpContext(
          { baseUrl: env.baseUrl, authToken: env.authToken },
          () => callTool(toolName, toolArgs),
        );
        return ok({ content: [{ type: 'text', text }] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, tool: toolName, accountId: env.accountId }, 'Remote MCP tool call failed');
        // 工具執行失敗回的是「成功的 JSON-RPC 回應，內容標記為錯誤」而不是 JSON-RPC error
        // ——MCP 就是這樣區分「協議層壞了」與「工具跑了但沒成功」的，後者模型看得到訊息、
        // 可以據此換個做法再試，前者只會讓對話直接中斷。
        return ok({ content: [{ type: 'text', text: `錯誤：${msg}` }], isError: true });
      }
    }

    default:
      return fail(-32601, `Method not found: ${method ?? '(未指定)'}`);
  }
}

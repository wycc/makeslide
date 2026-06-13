import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { config } from '../../config';
import { logger } from '../../logger';
import { db } from '../../db';
import { pageAnimationSpecPath, pageImagePath, safeJoinPdfPath } from '../../services/storage';
import {
  ConversationMessageSchema,
  MAX_CUSTOM_SCRIPT_CODE_LENGTH,
  MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
  MAX_HINT_LENGTH,
  defaultAnimationSpec,
  parseStoredAnimationSpec,
  renderTypeForSpec,
  validateAnimationSpec,
} from '../../services/pageAnimation';
import type { AnimationSpec } from '../../services/pageAnimation';
import { generateAiFocusEffects } from '../../services/animationAutoFocus';
import {
  findCustomScriptContractIssue,
  findUnsafeScriptPattern,
  generateCustomScriptCodeStream,
  generateCustomScriptPlanStream,
} from '../../services/animationCustomScript';
import type { SlideRenderType } from '../../types';
import { PageParamSchema, errorResponse, nowIso } from './shared';

const SaveAnimationBodySchema = z.object({
  spec: z.unknown(),
});

const AutoFocusAiBodySchema = z.object({
  sentences: z.array(z.string().min(1).max(1000)).max(60),
  hints: z.record(z.string().regex(/^\d+$/), z.string().max(MAX_HINT_LENGTH)).optional(),
});

const CustomScriptAiBodySchema = z.object({
  prompt: z.string().min(1).max(MAX_CUSTOM_SCRIPT_PROMPT_LENGTH),
  previousCode: z.string().max(MAX_CUSTOM_SCRIPT_CODE_LENGTH).optional(),
  history: z.array(ConversationMessageSchema).max(MAX_CUSTOM_SCRIPT_CONVERSATION_MESSAGES).optional(),
});

interface AnimationPageRow {
  page_uid: string;
  render_type: SlideRenderType | null;
  animation_spec_path: string | null;
  text_path: string | null;
  image_path: string | null;
}

function getAnimationPageRow(id: string, n: number): AnimationPageRow | undefined {
  return db
    .prepare(`SELECT page_uid, render_type, animation_spec_path, text_path, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(id, n) as AnimationPageRow | undefined;
}

/**
 * Loads the page's rendered image, downsized to `openaiScriptImageMaxWidth`,
 * as a `data:image/jpeg;base64,...` URL for vision input. Returns `null`
 * (and logs a warning) if the image is missing or fails to decode, so the
 * caller can fall back to text-only reasoning.
 */
async function loadAnimationPageImageDataUrl(id: string, row: AnimationPageRow): Promise<string | null> {
  const absPath = row.image_path ? safeJoinPdfPath(id, row.image_path) : pageImagePath(id, row.page_uid);
  try {
    const buf = await sharp(absPath)
      .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn(
      { pdfId: id, pageUid: row.page_uid, imagePath: absPath, error: err instanceof Error ? err.message : String(err) },
      'animation/auto-focus-ai: failed to load page image, falling back to text-only',
    );
    return null;
  }
}

function readStoredSpec(id: string, pageUid: string): AnimationSpec {
  const absPath = pageAnimationSpecPath(id, pageUid);
  if (!fs.existsSync(absPath)) {
    return defaultAnimationSpec();
  }
  try {
    return parseStoredAnimationSpec(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return defaultAnimationSpec();
  }
}

export async function registerPageAnimationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/pdfs/:id/pages/:n/animation', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getAnimationPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const spec = readStoredSpec(id, row.page_uid);
    return reply.code(200).send({
      page_number: n,
      render_type: row.render_type === 'gsap-image' ? 'gsap-image' : 'static-image',
      spec,
    });
  });

  app.put('/api/pdfs/:id/pages/:n/animation', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = SaveAnimationBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getAnimationPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const validated = validateAnimationSpec(parsedBody.data.spec);
    if (!validated.ok) {
      return reply.code(400).send(errorResponse('INVALID_ANIMATION_SPEC', validated.message));
    }
    const spec = validated.spec;
    const renderType = renderTypeForSpec(spec);
    const relSpecPath = `pages/${row.page_uid}.animation.json`;
    await fs.promises.writeFile(pageAnimationSpecPath(id, row.page_uid), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
    const now = nowIso();
    db.prepare(
      `UPDATE pages SET render_type = ?, animation_spec_path = ?, updated_at = ? WHERE pdf_id = ? AND page_number = ?`,
    ).run(renderType, relSpecPath, now, id, n);
    return reply.code(200).send({
      page_number: n,
      render_type: renderType,
      animation_spec_url: `api/pdfs/${id}/pages/${n}/animation/spec`,
      updated_at: now,
    });
  });

  app.get('/api/pdfs/:id/pages/:n/animation/spec', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const { id, n } = parsed.data;
    const row = getAnimationPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const spec = readStoredSpec(id, row.page_uid);
    // no-store so the renderer never plays a stale spec right after the editor saves
    return reply.header('Cache-Control', 'no-store').code(200).send(spec);
  });

  // AI 自動產生逐字稿焦點動畫：依目前逐字稿句子與頁面文字，由 LLM 決定每句是否顯示焦點方框、
  // 位置/大小與消失時間。不會寫入儲存的 spec，僅回傳效果供前端合併進編輯中的 draft。
  app.post('/api/pdfs/:id/pages/:n/animation/auto-focus-ai', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = AutoFocusAiBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getAnimationPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    if (parsedBody.data.sentences.length === 0) {
      return reply.code(200).send({ effects: [] });
    }
    const pageText = row.text_path
      ? await fs.promises.readFile(safeJoinPdfPath(id, row.text_path), 'utf8').catch(() => '')
      : '';
    const imageDataUrl = await loadAnimationPageImageDataUrl(id, row);
    try {
      const effects = await generateAiFocusEffects({
        pageText,
        sentences: parsedBody.data.sentences,
        hints: parsedBody.data.hints,
        imageDataUrl,
        label: `animation-auto-focus-ai page/${id}/${n}`,
      });
      return reply.code(200).send({ effects });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to generate AI focus effects');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to generate AI focus effects'));
    }
  });

  // Diagnostic helper for users who paste the URL into a browser. The actual
  // generator endpoint is POST-only because it requires a JSON body containing
  // the prompt and optional previousCode/history.
  app.get('/api/pdfs/:id/pages/:n/animation/custom-script', async (_request, reply) => {
    return reply
      .header('Allow', 'POST')
      .code(405)
      .send(errorResponse('METHOD_NOT_ALLOWED', 'Use POST with a JSON body: { prompt, previousCode?, history? }'));
  });

  // AI 自訂腳本動畫：分兩階段由 LLM 處理使用者提示詞（與選填的目前程式碼/對話歷史）：
  // 1. 先將提示詞轉換成一份條列實作步驟（plan），供使用者於對話框中確認。
  // 2. 再依此步驟清單產生一段在 sandboxed iframe 中執行的 JavaScript（供「custom-script」
  //    效果使用），並在程式碼中以註解標示每個步驟，方便使用者手動調整。
  // 不會寫入儲存的 spec，僅回傳步驟與程式碼供前端合併進編輯中的 draft 效果。
  //
  // 回應格式為 SSE（text/event-stream），讓前端可在產生過程中即時顯示輸出：
  // - event: plan-delta — { text: string }，每次收到一段新產生的步驟清單片段
  // - event: plan-done  — { plan: string }，步驟清單產生完成（顯示於對話框）
  // - event: delta — { text: string }，每次收到一段新產生的程式碼片段
  // - event: done  — { code: string }，產生完成且通過安全/契約檢查後的最終程式碼
  // - event: error — { code: string, message: string }，發生錯誤時送出，串流隨即結束
  app.post('/api/pdfs/:id/pages/:n/animation/custom-script', async (request, reply) => {
    const parsed = PageParamSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', 'Invalid id or page number'));
    }
    const parsedBody = CustomScriptAiBodySchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply.code(400).send(errorResponse('INVALID_REQUEST', parsedBody.error.issues[0]?.message ?? 'Invalid body'));
    }
    const { id, n } = parsed.data;
    const row = getAnimationPageRow(id, n);
    if (!row) {
      return reply.code(404).send(errorResponse('PAGE_NOT_FOUND', 'Page not found'));
    }
    const pageText = row.text_path
      ? await fs.promises.readFile(safeJoinPdfPath(id, row.text_path), 'utf8').catch(() => '')
      : '';

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sendEvent = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const planResult = await generateCustomScriptPlanStream(
        {
          prompt: parsedBody.data.prompt,
          previousCode: parsedBody.data.previousCode,
          history: parsedBody.data.history,
          pageText,
          label: `animation-custom-script-plan-ai page/${id}/${n}`,
        },
        (delta) => sendEvent('plan-delta', { text: delta }),
      );
      const plan = planResult.plan;
      sendEvent('plan-done', { plan });

      const result = await generateCustomScriptCodeStream(
        {
          prompt: parsedBody.data.prompt,
          previousCode: parsedBody.data.previousCode,
          history: parsedBody.data.history,
          plan,
          pageText,
          label: `animation-custom-script-ai page/${id}/${n}`,
        },
        (delta) => sendEvent('delta', { text: delta }),
      );
      const code = result.code;
      if (!code) {
        sendEvent('error', errorResponse('INTERNAL_ERROR', 'Generated code is empty; please try again').error);
      } else if (code.length > MAX_CUSTOM_SCRIPT_CODE_LENGTH) {
        sendEvent(
          'error',
          errorResponse('SCRIPT_TOO_LONG', `Generated code exceeds ${MAX_CUSTOM_SCRIPT_CODE_LENGTH} characters; please try a simpler prompt`).error,
        );
      } else {
        const unsafe = findUnsafeScriptPattern(code);
        if (unsafe) {
          sendEvent(
            'error',
            errorResponse('UNSAFE_SCRIPT', `Generated code uses a disallowed API (${unsafe}); please try a different prompt`).error,
          );
        } else {
          const contractIssue = findCustomScriptContractIssue(code);
          if (contractIssue) {
            sendEvent('error', errorResponse('INVALID_SCRIPT_CONTRACT', `${contractIssue}; please try a different prompt`).error);
          } else {
            sendEvent('done', { code });
          }
        }
      }
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to generate custom-script animation code');
      sendEvent('error', errorResponse('INTERNAL_ERROR', 'Failed to generate custom-script animation code').error);
    } finally {
      reply.raw.end();
    }
  });
}

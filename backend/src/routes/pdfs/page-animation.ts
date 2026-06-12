import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db';
import { pageAnimationSpecPath, safeJoinPdfPath } from '../../services/storage';
import {
  MAX_HINT_LENGTH,
  defaultAnimationSpec,
  parseStoredAnimationSpec,
  renderTypeForSpec,
  validateAnimationSpec,
} from '../../services/pageAnimation';
import type { AnimationSpec } from '../../services/pageAnimation';
import { generateAiFocusEffects } from '../../services/animationAutoFocus';
import type { SlideRenderType } from '../../types';
import { PageParamSchema, errorResponse, nowIso } from './shared';

const SaveAnimationBodySchema = z.object({
  spec: z.unknown(),
});

const AutoFocusAiBodySchema = z.object({
  sentences: z.array(z.string().min(1).max(1000)).max(60),
  hints: z.record(z.string().regex(/^\d+$/), z.string().max(MAX_HINT_LENGTH)).optional(),
});

interface AnimationPageRow {
  page_uid: string;
  render_type: SlideRenderType | null;
  animation_spec_path: string | null;
  text_path: string | null;
}

function getAnimationPageRow(id: string, n: number): AnimationPageRow | undefined {
  return db
    .prepare(`SELECT page_uid, render_type, animation_spec_path, text_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(id, n) as AnimationPageRow | undefined;
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
    try {
      const effects = await generateAiFocusEffects({
        pageText,
        sentences: parsedBody.data.sentences,
        hints: parsedBody.data.hints,
        label: `animation-auto-focus-ai page/${id}/${n}`,
      });
      return reply.code(200).send({ effects });
    } catch (err) {
      request.log.error({ err, pdfId: id, pageNumber: n }, 'Failed to generate AI focus effects');
      return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Failed to generate AI focus effects'));
    }
  });
}

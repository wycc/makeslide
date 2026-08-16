import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { logger } from '../logger';
import path from 'node:path';
import sharp from 'sharp';
import { toFile } from 'openai/uploads';
import { currentAccountId } from './accountContext';
import { pageImagePath } from './storage';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from './imagePromptTemplates';
import { buildFigureReferenceNotes, getFigureReferencesForPage, loadFigureReferenceFiles, loadFigureSelection } from './pdfFigures';
import { withImageProviderFailover, imageEditTimeoutMs } from '../routes/pdfs/page-operations';
import { loadPromptTemplate, renderPromptTemplate } from './promptTemplates';
import { db } from '../db';
import { config } from '../config';
import { callChatJSON } from './openai';
import { getRuntimeAiSettings } from './aiSettings';
import { safeJoinPdfPath } from './storage';
import { getPdfHostMode } from '../worker/steps/generateScript';
import {
  RewriteScriptResponseSchema,
  buildRewriteScriptSystemPrompt,
  buildRewriteScriptUserPrompt,
  loadPageImageAsDataUrl,
} from './scriptRewritePrompt';

/**
 * Producing an edit the user has not agreed to yet — see docs/tutor-edit-tools.md.
 *
 * These are the halves of "rewrite this script" and "modify this image" that decide *what* the new
 * version would be, with the part that overwrites the page left out. The tutor's tools call them so
 * it can offer a change; the page's own buttons keep their existing routes, which do the same work
 * and then write.
 */

export interface ScriptProposal {
  original: string;
  proposed: string;
}

interface PdfRowForRewrite {
  page_count: number | null;
  user_prompt: string | null;
  script_max_chars_per_page: number | null;
}

/**
 * Rewrite a page's script to an instruction, and return it **without writing it**.
 *
 * Same prompts and length rules as the rewrite-script route, so what the tutor offers is the same
 * kind of thing the "rewrite" button produces — not a second, subtly different rewriter.
 */
export async function proposeScriptEdit(
  pdfId: string,
  pageNumber: number,
  instruction: string,
): Promise<ScriptProposal> {
  const pdfRow = db
    .prepare(`SELECT page_count, user_prompt, script_max_chars_per_page FROM pdfs WHERE id = ?`)
    .get(pdfId) as PdfRowForRewrite | undefined;
  if (!pdfRow) throw new Error('PDF_NOT_FOUND');
  const pageRow = db
    .prepare(`SELECT script_path, image_path FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(pdfId, pageNumber) as { script_path: string | null; image_path: string | null } | undefined;
  if (!pageRow?.script_path) throw new Error('PAGE_NOT_FOUND');

  const original = await fs.promises
    .readFile(safeJoinPdfPath(pdfId, pageRow.script_path), 'utf8')
    .catch(() => '');
  const targetChars = pdfRow.script_max_chars_per_page ?? config.openaiScriptTargetChars;
  // The slide itself is context: an instruction like "mention what the chart shows" cannot be
  // followed from the text alone.
  const imageDataUrl = pageRow.image_path
    ? await loadPageImageAsDataUrl(safeJoinPdfPath(pdfId, pageRow.image_path)).catch(() => null)
    : null;

  const userText = buildRewriteScriptUserPrompt({
    pageNumber,
    pageCount: pdfRow.page_count ?? 1,
    targetChars,
    contentLanguage: getRuntimeAiSettings().contentLanguage,
    editPrompt: instruction,
    currentScript: original,
    // No neighbouring pages or chat history here: the tutor already has the whole deck in its own
    // context, and passing an empty history keeps this call to exactly what it needs.
    previousScript: '',
    nextScript: '',
    history: [],
  });

  const result = await callChatJSON({
    label: `propose-script-edit page/${pdfId}/${pageNumber}`,
    schema: RewriteScriptResponseSchema,
    maxTokens: 2400,
    temperature: 0.5,
    messages: [
      {
        role: 'system',
        content: buildRewriteScriptSystemPrompt({
          userPrompt: pdfRow.user_prompt,
          targetChars,
          hostMode: getPdfHostMode(pdfId),
        }),
      },
      {
        role: 'user',
        content: imageDataUrl
          ? [
              { type: 'image_url' as const, image_url: { url: imageDataUrl, detail: 'high' as const } },
              { type: 'text' as const, text: userText },
            ]
          : userText,
      },
    ],
  });

  return { original, proposed: result.data.script.trim() };
}

const EDIT_SLIDE_IMAGE_PROMPT_FALLBACK = [
  'You are editing an existing presentation slide image provided as the input image.',
  'Use the uploaded image as the strict visual source of truth.',
  'Preserve the original slide layout, composition, colors, typography style, relative object positions, diagrams, icons, and readable text unless the user explicitly asks to change those specific elements.',
  'Only make the minimal edits required by the user adjustment prompt. Do not redesign the slide, do not invent unrelated visual elements, and do not change the overall style beyond the requested modification.',
  'If the request is ambiguous, prefer conservative local edits and keep the original image as unchanged as possible.',
  '',
  '{{base_prompt}}',
].join('\n');

export interface ImageProposal {
  candidateId: string;
  /** Relative URL the UI loads the candidate from; the same one the modify-image button uses. */
  imageUrl: string;
}

/**
 * Produce a candidate image for a page from an instruction, **without replacing the page's own**.
 *
 * This is the body of the regenerate-image route with the response left off, so the tutor's tool
 * and the button beside it generate candidates the same way — including the figure references and
 * the deck's style prompt, which an independent implementation would quietly omit.
 */
export async function proposePageImageEdit(
  pdfId: string,
  pageNumber: number,
  instruction: string,
  historyPrompt = '',
): Promise<ImageProposal> {
  const id = pdfId;
  const n = pageNumber;
  const prompt = instruction;
  const pdfRow = db
    .prepare(`SELECT page_count, user_prompt, image_style_prompt FROM pdfs WHERE id = ?`)
    .get(id) as { page_count: number | null; user_prompt: string | null; image_style_prompt: string | null } | undefined;
  if (!pdfRow) throw new Error('PDF_NOT_FOUND');
  const pageRow = db
    .prepare(`SELECT image_path, text_path, script_path, page_uid FROM pages WHERE pdf_id = ? AND page_number = ?`)
    .get(id, n) as { image_path: string | null; text_path: string | null; script_path: string | null; page_uid: string } | undefined;
  if (!pageRow) throw new Error('PAGE_NOT_FOUND');

  const accountId = currentAccountId();
  let pageText = '';
  let pageScript = '';
  if (pageRow.text_path) {
    try {
      pageText = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.text_path), 'utf8');
    } catch {
      pageText = '';
    }
  }
  if (pageRow.script_path) {
    try {
      pageScript = await fs.promises.readFile(safeJoinPdfPath(id, pageRow.script_path), 'utf8');
    } catch {
      pageScript = '';
    }
  }

  // The base image is the slide's existing render used as the edit source. It can be
  // legitimately missing — e.g. a half-failed add-pages insert leaves the page row with
  // image_path set but no file on disk. Rather than failing with ENOENT, fall back to
  // generating the image from scratch (edit conditioned on figure references when any
  // exist, otherwise a pure text->image generation).
  const currentImagePath = pageRow.image_path
    ? safeJoinPdfPath(id, pageRow.image_path)
    : pageImagePath(id, pageRow.page_uid);
  let currentImageForEdit: Awaited<ReturnType<typeof toFile>> | null = null;
  try {
    const currentImageBuffer = await fs.promises.readFile(currentImagePath);
    currentImageForEdit = await toFile(currentImageBuffer, `page-${n}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    logger.warn(
      { pdfId: id, pageNumber: n, imagePath: currentImagePath },
      'regenerate-image: base image missing, generating from scratch instead of editing',
    );
  }

  const figureExcludeIds = new Set(loadFigureSelection(id, pageRow.page_uid).excluded);
  const rawFigureRefs = getFigureReferencesForPage(id, n, undefined, figureExcludeIds);
  const { figures: figureRefs, files: figureRefFiles } = await loadFigureReferenceFiles(id, rawFigureRefs);
  const editInputs: Array<Awaited<ReturnType<typeof toFile>>> = [];
  if (currentImageForEdit) editInputs.push(currentImageForEdit);
  editInputs.push(...figureRefFiles);

  const basePrompt = buildImagePrompt({
    stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
    contentLanguage: getRuntimeAiSettings().contentLanguage,
    pageText,
    pageScript,
    figureNotes: buildFigureReferenceNotes(figureRefs),
    userAdjustmentPrompt: [
      historyPrompt ? `Conversation history for iterative image editing:\n${historyPrompt}` : '',
      `Current user adjustment request:\n${prompt}`,
    ].filter(Boolean).join('\n\n'),
  });

  const editPrompt = renderPromptTemplate(
    loadPromptTemplate('backend/prompts/edit-slide-image.md', EDIT_SLIDE_IMAGE_PROMPT_FALLBACK),
    { base_prompt: basePrompt },
  );

  const edited = await withImageProviderFailover(accountId, ({ client, model: imageModel }) =>
    editInputs.length > 0
      ? client.images.edit(
          {
            model: imageModel,
            image: editInputs.length === 1 ? editInputs[0]! : editInputs,
            // With a real base image use the "edit this slide" template; with only figure
            // references (no base) that base-oriented template doesn't apply.
            prompt: currentImageForEdit ? editPrompt : basePrompt,
            size: '1536x1024',
          },
          { timeout: imageEditTimeoutMs() },
        )
      : client.images.generate(
          {
            model: imageModel,
            prompt: basePrompt,
            size: '1536x1024',
          } as never,
          { timeout: imageEditTimeoutMs() },
        ));
  const b64 = edited.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image edit returned empty result');
  const newBuf = Buffer.from(b64, 'base64');
  const candidateId = nanoid(10);
  const candidateRelPath = path.posix.join('pages', `${String(n).padStart((pdfRow.page_count ?? 0) > 999 ? 4 : 3, '0')}.candidate.${candidateId}.jpg`);
  const candidatePath = safeJoinPdfPath(id, candidateRelPath);
  await sharp(newBuf).resize(1920, 1080, { fit: 'contain', background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(candidatePath);

  return {
    candidateId,
    imageUrl: `api/pdfs/${id}/pages/${n}/image-candidates/${candidateId}`,
  };
}

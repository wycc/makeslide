import fs from 'node:fs';
import { coverImagePath, pageImagePath, pageTextPath, pagesDir } from '../../services/storage';
import { getOpenAIClient } from '../../services/openai';
import { logger } from '../../logger';
import { config } from '../../config';
import { buildImagePrompt, IMAGE_PROMPT_TEMPLATES } from '../../services/imagePromptTemplates';

export interface RenderTextPagesWithLlmOptions {
  pdfId: string;
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string }>;
  onPage?: (pageNumber: number, imagePath: string) => void;
}

export interface RenderTextPagesWithLlmResult {
  pageCount: number;
  pagePaths: string[];
}

export async function renderTextPagesWithLlm(
  opts: RenderTextPagesWithLlmOptions,
): Promise<RenderTextPagesWithLlmResult> {
  const client = getOpenAIClient();
  const pageCount = opts.pages.length;
  const pagePaths: string[] = [];
  await fs.promises.mkdir(pagesDir(opts.pdfId), { recursive: true });

  for (const p of opts.pages) {
    const startedAt = Date.now();
    const imagePath = pageImagePath(opts.pdfId, p.pageNumber, pageCount);
    const textPath = pageTextPath(opts.pdfId, p.pageNumber, pageCount);

    // Idempotency: if image already exists and non-empty, keep it and skip
    // re-generation. Still sync text file so downstream steps read latest text.
    try {
      const st = await fs.promises.stat(imagePath);
      if (st.isFile() && st.size > 0) {
        await fs.promises.writeFile(textPath, p.content, 'utf8');
        pagePaths.push(imagePath);
        logger.info(
          {
            pdfId: opts.pdfId,
            pageNumber: p.pageNumber,
            pageCount,
            bytes: st.size,
          },
          'Text image generation: reuse existing image (idempotent skip)',
        );
        opts.onPage?.(p.pageNumber, imagePath);
        continue;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // proceed to generate
    }

    logger.info(
      {
        pdfId: opts.pdfId,
        pageNumber: p.pageNumber,
        pageCount,
        strategy: 'text-slide-marker-direct-image-gen',
        slideLabel: p.slideLabel ?? null,
      },
      'Text image generation: page start',
    );

    const prompt = buildImagePrompt({
      stylePrompt: IMAGE_PROMPT_TEMPLATES[0]?.prompt_en,
      slideLabel: p.slideLabel ?? null,
      textBody: [
        '目標是「視覺化摘要」而不是全文轉貼。請把重點轉成圖像與結構，不要做文字牆。',
        '版型要求：1 個主標題 + 3~5 個關鍵短句（每句 ≤ 14 字）+ 1 個大型視覺主體（流程圖/關係圖/圖示群/概念圖）。',
        '文字規範：繁體中文、精簡短句、可讀性高；避免長段落、密集條列、過小字。',
        '視覺規範：扁平化圖示、卡片分區、柔和對比、資訊圖表感；可用抽象圖形輔助理解。',
        '禁止項目：整頁密集文字、逐字抄錄、黑底白字純文本頁、學術論文式排版。',
        p.content,
      ].join('\n\n'),
    });

    let image;
    try {
      image = await client.images.generate({
        model: config.openaiImageModel,
        prompt,
        size: '1536x1024',
      });
    } catch (err) {
      logger.error(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        },
        'Text image generation: page failed',
      );
      throw err;
    }

    const first = image.data?.[0];
    const b64 = first?.b64_json;
    if (!b64) throw new Error(`LLM image generation failed at page ${p.pageNumber}`);

    await fs.promises.writeFile(imagePath, Buffer.from(b64, 'base64'));
    await fs.promises.writeFile(textPath, p.content, 'utf8');
    pagePaths.push(imagePath);
    logger.info(
        {
          pdfId: opts.pdfId,
          pageNumber: p.pageNumber,
          pageCount,
          latencyMs: Date.now() - startedAt,
          model: config.openaiImageModel,
        },
        'Text image generation: page done',
      );
    opts.onPage?.(p.pageNumber, imagePath);
  }

  if (pagePaths[0]) {
    await fs.promises.copyFile(pagePaths[0], coverImagePath(opts.pdfId));
  }

  return { pageCount, pagePaths };
}

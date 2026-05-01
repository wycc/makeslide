import fs from 'node:fs';
import { coverImagePath, pageImagePath, pageTextPath, pagesDir } from '../../services/storage';
import { getOpenAIClient } from '../../services/openai';
import { logger } from '../../logger';

export interface RenderTextPagesWithLlmOptions {
  pdfId: string;
  pages: Array<{ pageNumber: number; content: string; slideLabel?: string }>;
  onPage?: (pageNumber: number) => void;
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

    const prompt = [
      '請產生一張 16:9 的簡報頁圖片，風格專業、清楚、可閱讀。',
      '請依照下列內容設計版面，必須包含重點標題與條列重點。',
      p.slideLabel ? `這是 ${p.slideLabel}。請以該頁內容為主。` : '請以這一頁內容為主。',
      '語言：繁體中文。',
      '',
      p.content,
    ].join('\n');

    let image;
    try {
      image = await client.images.generate({
        model: 'gpt-image-1',
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

    const imagePath = pageImagePath(opts.pdfId, p.pageNumber, pageCount);
    const textPath = pageTextPath(opts.pdfId, p.pageNumber, pageCount);
    await fs.promises.writeFile(imagePath, Buffer.from(b64, 'base64'));
    await fs.promises.writeFile(textPath, p.content, 'utf8');
    pagePaths.push(imagePath);
    logger.info(
      {
        pdfId: opts.pdfId,
        pageNumber: p.pageNumber,
        pageCount,
        latencyMs: Date.now() - startedAt,
      },
      'Text image generation: page done',
    );
    opts.onPage?.(p.pageNumber);
  }

  if (pagePaths[0]) {
    await fs.promises.copyFile(pagePaths[0], coverImagePath(opts.pdfId));
  }

  return { pageCount, pagePaths };
}

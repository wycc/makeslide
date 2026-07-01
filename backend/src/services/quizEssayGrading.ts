import { z } from 'zod';
import sharp from 'sharp';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';
import { sanitizeQuizRecordingSegment } from './quizRecording';

/** Builds a safe filename for one essay answer photo. Segments are client-supplied, so sanitized. */
export function essayPhotoFilename(quizId: number, sessionId: string, clientId: string, questionId: string, index: number): string {
  const s = sanitizeQuizRecordingSegment(sessionId);
  const c = sanitizeQuizRecordingSegment(clientId);
  const q = sanitizeQuizRecordingSegment(questionId);
  return `${quizId}_${s}_${c}_${q}_${index}.jpg`;
}

/** Clamps an AI/teacher score into [0, maxScore] and rounds to one decimal; non-finite → 0. */
export function clampEssayScore(raw: unknown, maxScore: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  const clamped = Math.min(Math.max(n, 0), Math.max(0, maxScore));
  return Math.round(clamped * 10) / 10;
}

export function buildEssaySystemPrompt(): string {
  return [
    '你是一位公正、細心的閱卷老師。學生把手寫在紙上的作答拍照上傳，你要辨識照片中的文字並依題目與參考答案評分。',
    '請只依作答內容評分，忽略字跡美觀與無關塗鴉。若照片模糊或看不清楚，就依可辨識的部分保守給分，並在回饋中說明。',
    '務必只輸出符合 schema 的 JSON：score 為 0 到滿分之間的數字，feedback 為給學生的簡短中文評語（說明得分理由與可改進處）。',
  ].join('\n');
}

export function buildEssayUserText(params: { question: string; referenceAnswer: string; maxScore: number }): string {
  const lines = [
    `題目：${params.question}`,
    `本題滿分：${params.maxScore}`,
  ];
  if (params.referenceAnswer.trim()) {
    lines.push(`參考答案／評分重點：${params.referenceAnswer.trim()}`);
  } else {
    lines.push('（本題未提供參考答案，請依題意與學科常識合理評分。）');
  }
  lines.push('以下附上學生手寫作答的照片，請辨識後評分。');
  return lines.join('\n');
}

const EssayGradeSchema = z.object({
  score: z.number(),
  feedback: z.string().max(2000).default(''),
});

/**
 * Normalizes an uploaded photo (possibly HEIC/large/rotated) into a downsized JPEG suitable both
 * for on-disk storage and as a base64 data URL for the vision model. Returns null on decode failure.
 */
export async function processEssayPhoto(buffer: Buffer): Promise<{ jpeg: Buffer; dataUrl: string } | null> {
  try {
    const jpeg = await sharp(buffer)
      .rotate() // respect EXIF orientation from phone cameras
      .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { jpeg, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'quiz-essay: failed to decode answer photo');
    return null;
  }
}

/**
 * Grades a photographed essay answer with the vision LLM. Best-effort: returns null when there is
 * no usable image or the model call fails, so the caller can store the answer ungraded for manual review.
 */
export async function gradeEssayAnswer(params: {
  question: string;
  referenceAnswer: string;
  maxScore: number;
  imageDataUrls: string[];
  label?: string;
}): Promise<{ score: number; feedback: string } | null> {
  const images = params.imageDataUrls.filter(Boolean);
  if (images.length === 0) return null;
  const userContent: ChatCompletionContentPart[] = [
    ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } } as ChatCompletionContentPart)),
    { type: 'text', text: buildEssayUserText({ question: params.question, referenceAnswer: params.referenceAnswer, maxScore: params.maxScore }) },
  ];
  try {
    const result = await callChatJSON({
      label: params.label ?? 'quiz-essay-grade',
      schema: EssayGradeSchema,
      maxTokens: 1200,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildEssaySystemPrompt() },
        { role: 'user', content: userContent },
      ],
    });
    return { score: clampEssayScore(result.data.score, params.maxScore), feedback: result.data.feedback ?? '' };
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'quiz-essay: AI grading failed');
    return null;
  }
}

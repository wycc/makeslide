import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';
import type { AnimationEffect, AnimationEffectType } from './pageAnimation';
import {
  ANIMATION_SHAPE_KINDS,
  MAX_STEP_LIST_ITEMS,
  MAX_STEP_LIST_ITEM_LENGTH,
  MAX_TEXT_CALLOUT_LENGTH,
} from './pageAnimation';

/**
 * Effect types this generator may choose: `FOCUS_EFFECT_TYPES` on the frontend
 * (`highlight-box`/`spotlight`) plus `text-callout` for short AI-written captions,
 * `shape` for a simple SVG marker, and `step-list` for a short bullet list.
 */
const AUTO_FOCUS_AI_EFFECT_TYPES = ['highlight-box', 'spotlight', 'text-callout', 'shape', 'step-list'] as const;

/** Fade-in/out duration applied to every AI-generated effect, matching `generateFocusEffectsFromTranscript`. */
const AUTO_FOCUS_AI_DURATION_SECONDS = 1.2;

/** Max sentences considered, matching `MAX_SLIDE_ANIMATION_EFFECTS`. */
const MAX_SENTENCES_FOR_AI = 20;

const MAX_EXIT_DURATION_SECONDS = 30;

const AutoFocusItemSchema = z.object({
  line: z.number().int().min(0).max(998),
  show: z.boolean(),
  type: z.enum(AUTO_FOCUS_AI_EFFECT_TYPES).optional(),
  /** Caption text, only meaningful when `type === 'text-callout'`. */
  text: z.string().min(1).max(MAX_TEXT_CALLOUT_LENGTH).optional(),
  /** SVG primitive to draw, only meaningful when `type === 'shape'`. */
  shape: z.enum(ANIMATION_SHAPE_KINDS).optional(),
  /** Bullet items to display, only meaningful when `type === 'step-list'`. */
  items: z.array(z.string().min(1).max(MAX_STEP_LIST_ITEM_LENGTH)).max(MAX_STEP_LIST_ITEMS).optional(),
  xPct: z.number().min(0).max(100).optional(),
  yPct: z.number().min(0).max(100).optional(),
  widthPct: z.number().min(1).max(100).optional(),
  heightPct: z.number().min(1).max(100).optional(),
  exitDuration: z.number().min(0).max(MAX_EXIT_DURATION_SECONDS).optional(),
});

export const AutoFocusAiResponseSchema = z.object({
  effects: z.array(AutoFocusItemSchema).max(MAX_SENTENCES_FOR_AI),
});

export type AutoFocusAiResponse = z.infer<typeof AutoFocusAiResponseSchema>;
type AutoFocusAiItem = z.infer<typeof AutoFocusItemSchema>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildAutoFocusSystemPrompt(): string {
  return [
    '你是一位簡報動畫設計助理，負責替投影片的逐字稿規劃「焦點動畫」。',
    '焦點動畫會在播放到指定句子時，於投影片上淡入一個方框、圖形、條列清單或一段文字說明，引導觀眾注意畫面中的特定區域或重點摘要，並可在停留一段時間後自動淡出。',
    '',
    '你的任務：針對使用者提供的每一句逐字稿（依索引 0 到 N-1），判斷：',
    '1. show：是否需要在播放到這句時顯示效果。只有當這句明確提到畫面中的具體位置、物件、數據、圖表或重點文字時才顯示；單純的開場、總結、銜接句通常不需要，請避免每句都顯示。',
    '2. type：highlight-box（醒目方框，框出重點）、spotlight（聚光燈，方框外區域變暗）、text-callout（淡入一段精簡文字摘要）、shape（淡入一個簡單的 SVG 圖形，用於標示位置）或 step-list（淡入一個條列步驟/要點清單方框）。沒有特別理由時優先選 highlight-box；若這句的重點適合用一句精簡摘要（例如關鍵數據、結論）強化，可選 text-callout；若這句在描述多個步驟、流程或要點，可選 step-list；若需要用箭頭、圓形等圖形標示位置，可選 shape。',
    '3. xPct / yPct / widthPct / heightPct：方框（或文字框、圖形、清單方框）左上角座標與寬高，皆為投影片寬高的百分比（0-100）。請依該句描述的內容，盡量對應到畫面中合理的位置與大小，避免每句都用同一個位置；text-callout、step-list 建議放在畫面空白處（例如下方角落），避免遮住重點內容。',
    '4. text（僅當 type 為 text-callout 時提供，其他 type 請省略此欄位）：要顯示的文字內容，務必精簡扼要（不超過 80 字），並使用與逐字稿相同的語言。',
    '5. shape（僅當 type 為 shape 時提供，其他 type 請省略此欄位）：圖形種類，從 circle（圓形）、rect（方框）、ellipse（橢圓）、arrow（箭頭）中選擇，依該句描述的內容選擇最合適的圖形。',
    '6. items（僅當 type 為 step-list 時提供，其他 type 請省略此欄位）：條列項目的文字陣列，每項務必精簡（不超過 60 字），最多 6 項，並使用與逐字稿相同的語言。',
    '7. exitDuration（選填，秒）：效果淡入完成後要停留多久才自動淡出。如果這句只是短暫提示某個重點，可設定 1-3 秒；如果整句都在說明這個重點，可以設定一個比較長的時間。',
    '',
    '若使用者訊息附帶投影片頁面圖片，請參考圖片中的實際版面（文字、圖表、圖片等元素的位置與大小），讓 xPct/yPct/widthPct/heightPct 盡量對應到畫面中真實的區域；若沒有附帶圖片，則依文字描述合理推估。',
    '座標系統：投影片左上角為原點 (0,0)，x 向右增加、y 向下增加，皆為 0-100 的百分比。',
    'show 為 false 時，其他欄位可省略。',
    '',
    '請只輸出 JSON，格式為：{"effects":[{"line":0,"show":true,"type":"highlight-box","xPct":10,"yPct":20,"widthPct":30,"heightPct":25,"exitDuration":2}, {"line":1,"show":true,"type":"text-callout","text":"營收成長 35%","xPct":8,"yPct":78,"widthPct":40,"heightPct":14,"exitDuration":3}, {"line":2,"show":true,"type":"shape","shape":"arrow","xPct":40,"yPct":35,"widthPct":15,"heightPct":15,"exitDuration":2}, {"line":3,"show":true,"type":"step-list","items":["第一步：開啟設定","第二步：選擇選項","第三步：儲存"],"xPct":55,"yPct":55,"widthPct":35,"heightPct":30,"exitDuration":4}, {"line":4,"show":false}, ...]}',
    'effects 陣列必須包含使用者提供的每一個句子索引，且順序與索引需一致。',
  ].join('\n');
}

function buildAutoFocusUserPrompt(params: { pageText: string; sentences: string[]; hints?: Record<string, string> }): string {
  const limit = Math.min(params.sentences.length, MAX_SENTENCES_FOR_AI);
  const sentenceLines = params.sentences
    .slice(0, limit)
    .map((sentence, idx) => `${idx}. ${sentence}`)
    .join('\n');
  const hintEntries = Object.entries(params.hints ?? {}).filter(([line]) => {
    const idx = Number(line);
    return Number.isInteger(idx) && idx >= 0 && idx < limit;
  });
  const hintLines = hintEntries.length > 0 ? hintEntries.map(([line, text]) => `${line}: ${text}`).join('\n') : '（無）';

  return [
    '【頁面文字（OCR 擷取，可能含版面雜訊，僅供參考整體版面內容）】',
    params.pageText.trim() || '（無）',
    '',
    `【逐字稿句子（共 ${limit} 句，索引從 0 開始）】`,
    sentenceLines,
    '',
    '【每句動畫提示（使用者填寫，若有請優先參考）】',
    hintLines,
    '',
    `請針對以上 ${limit} 句逐字稿（索引 0 到 ${limit - 1}），逐一決定是否顯示焦點方框及其位置、大小與消失時間。`,
  ].join('\n');
}

/**
 * Maps the AI's per-sentence focus decisions into `AnimationEffect[]`, keeping
 * only entries with `show: true`, clamping positions/sizes/exitDuration to
 * sane ranges, and capping the result at `sentenceLimit` (already <= MAX_EFFECTS).
 * Duplicate `line` entries keep the first occurrence; results are sorted by line.
 * `type: 'text-callout'` items carry `text` (truncated to `MAX_TEXT_CALLOUT_LENGTH`);
 * if the AI picked `text-callout` without supplying `text`, the item falls back
 * to `highlight-box` since an empty caption box is not useful.
 * `type: 'shape'` items carry `shape` when provided (otherwise the frontend
 * defaults to `'circle'`). `type: 'step-list'` items carry `items` (trimmed,
 * each truncated to `MAX_STEP_LIST_ITEM_LENGTH`, capped at `MAX_STEP_LIST_ITEMS`);
 * if no usable items remain, the item falls back to `highlight-box` since an
 * empty list box is not useful.
 */
export function mapAutoFocusResponseToEffects(response: AutoFocusAiResponse, sentenceLimit: number): AnimationEffect[] {
  const byLine = new Map<number, AutoFocusAiItem>();
  for (const item of response.effects) {
    if (item.line < 0 || item.line >= sentenceLimit) continue;
    if (!byLine.has(item.line)) byLine.set(item.line, item);
  }
  const lines = Array.from(byLine.keys()).sort((a, b) => a - b);
  const effects: AnimationEffect[] = [];
  for (const line of lines) {
    const item = byLine.get(line);
    if (!item || !item.show) continue;
    let type: AnimationEffectType = item.type ?? 'highlight-box';
    let text: string | undefined;
    let shape: AnimationEffect['shape'];
    let items: string[] | undefined;
    if (type === 'text-callout') {
      const trimmed = item.text?.trim();
      if (trimmed) {
        text = trimmed.slice(0, MAX_TEXT_CALLOUT_LENGTH);
      } else {
        // text-callout 沒有文字內容就沒有意義，退回 highlight-box。
        type = 'highlight-box';
      }
    } else if (type === 'shape') {
      shape = item.shape;
    } else if (type === 'step-list') {
      const trimmedItems = (item.items ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, MAX_STEP_LIST_ITEMS)
        .map((entry) => entry.slice(0, MAX_STEP_LIST_ITEM_LENGTH));
      if (trimmedItems.length > 0) {
        items = trimmedItems;
      } else {
        // step-list 沒有任何項目就沒有意義，退回 highlight-box。
        type = 'highlight-box';
      }
    }
    const effect: AnimationEffect = {
      id: `ai-focus-${line}-${crypto.randomUUID()}`,
      target: 'slide',
      type,
      start: 0,
      duration: AUTO_FOCUS_AI_DURATION_SECONDS,
      ease: 'power1.out',
      startTrigger: { type: 'transcript-line', line },
      params: {
        xPct: clamp(item.xPct ?? 30, 0, 95),
        yPct: clamp(item.yPct ?? 30, 0, 95),
        widthPct: clamp(item.widthPct ?? 40, 5, 100),
        heightPct: clamp(item.heightPct ?? 40, 5, 100),
      },
    };
    if (text !== undefined) {
      effect.text = text;
    }
    if (shape !== undefined) {
      effect.shape = shape;
    }
    if (items !== undefined) {
      effect.items = items;
    }
    if (item.exitDuration !== undefined) {
      effect.exitDuration = clamp(item.exitDuration, 0, MAX_EXIT_DURATION_SECONDS);
    }
    effects.push(effect);
  }
  return effects;
}

/**
 * Asks the configured LLM to decide, per transcript sentence, whether to show
 * a focus effect and where/how long, then maps the response to
 * `AnimationEffect[]`. Returns `[]` without calling the LLM if `sentences` is empty.
 *
 * When `imageDataUrl` is provided (a `data:image/...` URL of the rendered page),
 * it is attached to the user message so vision-capable models can determine
 * more accurate positions/sizes. Falls back to text-only when omitted (also
 * note: the Gemini provider currently strips non-text content parts, so the
 * image is only actually used when `LLM_PROVIDER=openai`).
 */
export async function generateAiFocusEffects(params: {
  pageText: string;
  sentences: string[];
  hints?: Record<string, string>;
  imageDataUrl?: string | null;
  label: string;
}): Promise<AnimationEffect[]> {
  const limit = Math.min(params.sentences.length, MAX_SENTENCES_FOR_AI);
  if (limit === 0) return [];
  const userText = buildAutoFocusUserPrompt({ pageText: params.pageText, sentences: params.sentences, hints: params.hints });
  const userContent: string | ChatCompletionContentPart[] = params.imageDataUrl
    ? [
        { type: 'image_url', image_url: { url: params.imageDataUrl, detail: 'high' } },
        { type: 'text', text: userText },
      ]
    : userText;
  const result = await callChatJSON({
    label: params.label,
    schema: AutoFocusAiResponseSchema,
    maxTokens: 2000,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildAutoFocusSystemPrompt() },
      { role: 'user', content: userContent },
    ],
  });
  return mapAutoFocusResponseToEffects(result.data, limit);
}

/**
 * Loads an image file, downsized to `openaiScriptImageMaxWidth`, as a
 * `data:image/jpeg;base64,...` URL for the `imageDataUrl` vision input of
 * `generateAiFocusEffects`. Returns `null` (and logs a warning) if the image
 * is missing or fails to decode, so the caller can fall back to text-only.
 */
export async function loadFocusAiPageImageDataUrl(
  absImagePath: string,
  logContext: Record<string, unknown>,
): Promise<string | null> {
  try {
    const buf = await sharp(absImagePath)
      .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn(
      { ...logContext, imagePath: absImagePath, error: err instanceof Error ? err.message : String(err) },
      'animationAutoFocus: failed to load page image, falling back to text-only',
    );
    return null;
  }
}

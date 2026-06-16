import crypto from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { config } from '../config';
import { logger } from '../logger';
import { callChatJSON } from './openai';
import { findCustomScriptContractIssue, findUnsafeScriptPattern, generateCustomScriptCodeStream } from './animationCustomScript';
import type { AnimationEffect, AnimationEffectType } from './pageAnimation';
import {
  ANIMATION_SHAPE_KINDS,
  MAX_CUSTOM_SCRIPT_CODE_LENGTH,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
  MAX_FORMULA_LENGTH,
  MAX_SHAPE_COLOR_LENGTH,
  MAX_STEP_LIST_ITEMS,
  MAX_STEP_LIST_ITEM_LENGTH,
  MAX_TEXT_CALLOUT_LENGTH,
} from './pageAnimation';

/**
 * Effect types this generator may choose: `FOCUS_EFFECT_TYPES` on the frontend
 * (`highlight-box`/`spotlight`) plus `text-callout` for short AI-written captions,
 * `shape` for a simple SVG marker, `step-list` for a short bullet list, and
 * `custom-script` for a short AI-generated data visualization (see
 * `fillCustomScriptEffectsCode`).
 */
const AUTO_FOCUS_AI_EFFECT_TYPES = ['highlight-box', 'spotlight', 'text-callout', 'shape', 'step-list', 'pointer', 'custom-script', 'formula'] as const;

/** Fade-in/out duration applied to every AI-generated effect, matching `generateFocusEffectsFromTranscript`. */
const AUTO_FOCUS_AI_DURATION_SECONDS = 1.2;

/**
 * Default/bounds (seconds) for one full playthrough of an AI-generated
 * `custom-script` effect — longer than `AUTO_FOCUS_AI_DURATION_SECONDS` since a
 * custom visualization needs time to play through its animation.
 */
const CUSTOM_SCRIPT_AI_DURATION_SECONDS = { default: 6, min: 2, max: 20 } as const;

/** Max number of `custom-script` effects this generator may produce per page, to bound the extra code-generation LLM calls. */
const MAX_CUSTOM_SCRIPT_EFFECTS_PER_PAGE_AI = 1;

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
  /** Background color for the step-list box (CSS hex), only meaningful when `type === 'step-list'`. */
  stepListBgColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  /** Text color for the step-list box (CSS hex), only meaningful when `type === 'step-list'`. */
  stepListTextColor: z.string().max(MAX_SHAPE_COLOR_LENGTH).regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  /**
   * LaTeX source of a formula to display, only meaningful when
   * `type === 'formula'`; rendered by KaTeX in the overlay.
   */
  formulaLatex: z.string().min(1).max(MAX_FORMULA_LENGTH).optional(),
  /**
   * Natural-language description of a custom visualization, only meaningful
   * when `type === 'custom-script'`; passed to the custom-script code
   * generator by `fillCustomScriptEffectsCode`.
   */
  scriptPrompt: z.string().min(1).max(MAX_CUSTOM_SCRIPT_PROMPT_LENGTH).optional(),
  /**
   * Seconds for one full playthrough of a `custom-script` visualization, only
   * meaningful when `type === 'custom-script'`.
   */
  scriptDurationSeconds: z
    .number()
    .min(CUSTOM_SCRIPT_AI_DURATION_SECONDS.min)
    .max(CUSTOM_SCRIPT_AI_DURATION_SECONDS.max)
    .optional(),
  /**
   * Rotation angle in degrees for `pointer` effects (0=points down-right,
   * 90=down-left, 180=up-right, 270=up-left). Only meaningful for pointer.
   */
  angle: z.number().int().min(0).max(359).optional(),
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
    '2. type：highlight-box（醒目方框，框出重點）、spotlight（聚光燈，方框外區域變暗）、text-callout（淡入一段精簡文字摘要）、shape（淡入一個簡單的 SVG 圖形，用於標示位置）、step-list（淡入一個條列步驟/要點清單方框）、pointer（淡入一個指標箭頭，精確指向畫面中一個點）、formula（淡入一個以 LaTeX 渲染的數學公式）或 custom-script（淡入一段自訂的資料視覺化動畫）。沒有特別理由時優先選 highlight-box；若這句的重點適合用一句精簡摘要（例如關鍵數據、結論）強化，可選 text-callout；若這句在描述多個步驟、流程或要點，可選 step-list；若需要用箭頭、圓形等圖形標示位置，可選 shape；若這句強調的是一個精確的點（例如「這個數字」、「這個按鈕」），需要用箭頭直接指向該點，可選 pointer——pointer 與 shape 的差別在於：pointer 指向一個點，shape 框出一個區域；若這句明確提到一個數學公式、統計公式或科學方程式（包括以文字描述的，例如「E 等於 mc 平方」、「常態分布公式」、「費馬最後定理」），且整個公式可用 LaTeX 完整表示，可選 formula——注意：單純的百分比數字（例如「成長 35%」）、日期或簡單計數不算公式，應選 text-callout；若這句描述的內容（例如數值隨時間變化、流程示意、座標關係）適合用一段簡短的動態視覺化呈現，且前述類型都無法表達，可選 custom-script——但這類效果產生成本較高，整頁最多只能有一個，且僅在確實必要時才選用，多數情況下請優先使用其他類型。',
    '3. xPct / yPct / widthPct / heightPct：方框（或文字框、圖形、清單方框、自訂視覺化）左上角座標與寬高，皆為投影片寬高的百分比（0-100）。請依該句描述的內容，盡量對應到畫面中合理的位置與大小，避免每句都用同一個位置；text-callout、step-list、custom-script 建議放在畫面空白處（例如下方角落），避免遮住重點內容。注意：若 type 為 pointer，只需提供 xPct 和 yPct（指標指向的點座標），不需要 widthPct 和 heightPct；另可選擇提供 angle（0-359 整數度數），使箭頭從畫面外側指向目標——0=指向右下（箭頭從左上方向右下刺）、90=指向左下、180=指向右上、270=指向左上，請依目標點在畫面中的位置選擇讓箭頭「從外側指入」的角度，例如目標在畫面右半部通常應選 270（從右上往右下指），目標在畫面左半部通常選 90；不確定時可省略（預設 0）。',
    '4. text（僅當 type 為 text-callout 時提供，其他 type 請省略此欄位）：要顯示的文字內容，務必精簡扼要（不超過 80 字），並使用與逐字稿相同的語言。',
    '5. shape（僅當 type 為 shape 時提供，其他 type 請省略此欄位）：圖形種類，從 circle（圓形）、rect（方框）、ellipse（橢圓）、arrow（箭頭）中選擇，依該句描述的內容選擇最合適的圖形。',
    '6. items（僅當 type 為 step-list 時提供，其他 type 請省略此欄位）：條列項目的文字陣列，每項務必精簡（不超過 60 字），最多 6 項，並使用與逐字稿相同的語言。',
    '6b. stepListBgColor / stepListTextColor（選填，僅當 type 為 step-list 時可提供）：若從投影片圖片可判斷投影片背景為淺色系（例如白色、淡灰、淡黃），請提供對比較好的顏色組合，例如 stepListBgColor: "#1e3a5f"（深藍）、stepListTextColor: "#f0f4ff"（近白）；若投影片背景為深色系，可省略（預設值已適合深色背景）。請使用 CSS hex 格式（如 "#3b82f6"），僅在有明確視覺判斷依據時才提供，無法判斷時一律省略。',
    '7. formulaLatex（僅當 type 為 formula 時提供，其他 type 請省略此欄位）：要顯示的 LaTeX 數學公式（不含 $ 或 $$ 分隔符），例如 E = mc^2 或 \\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}} 或 a^2 + b^2 = c^2，不超過 200 字元；若逐字稿以文字描述公式（例如「E 等於 mc 的平方」），請將其轉為對應的 LaTeX（E = mc^2）；缺少、空白或無法以標準 LaTeX 表示時，請改選 highlight-box 而非提供無效的 LaTeX。',
    '8. scriptPrompt（僅當 type 為 custom-script 時提供，其他 type 請省略此欄位）：用一兩句話描述要產生的視覺化內容（例如「畫一個座標平面，顯示一個點沿曲線從左下移動到右上，代表數值隨時間成長」），會交給程式碼產生器轉換成可執行的動畫，請使用與逐字稿相同的語言，不超過 300 字。',
    '9. scriptDurationSeconds（選填，僅當 type 為 custom-script 時提供，其他 type 請省略此欄位）：此視覺化完整播放一輪所需的秒數，建議在 3 到 10 秒之間，讓畫面有足夠時間呈現變化。',
    '10. exitDuration（選填，秒）：效果淡入完成後要停留多久才自動淡出。如果這句只是短暫提示某個重點，可設定 1-3 秒；如果整句都在說明這個重點，可以設定一個比較長的時間。',
    '',
    '若使用者訊息附帶投影片頁面圖片，請參考圖片中的實際版面（文字、圖表、圖片等元素的位置與大小），讓 xPct/yPct/widthPct/heightPct 盡量對應到畫面中真實的區域；若沒有附帶圖片，則依文字描述合理推估。',
    '座標系統：投影片左上角為原點 (0,0)，x 向右增加、y 向下增加，皆為 0-100 的百分比。',
    'show 為 false 時，其他欄位可省略。',
    '',
    '請只輸出 JSON，格式為：{"effects":[{"line":0,"show":true,"type":"highlight-box","xPct":10,"yPct":20,"widthPct":30,"heightPct":25,"exitDuration":2}, {"line":1,"show":true,"type":"text-callout","text":"營收成長 35%","xPct":8,"yPct":78,"widthPct":40,"heightPct":14,"exitDuration":3}, {"line":2,"show":true,"type":"shape","shape":"arrow","xPct":40,"yPct":35,"widthPct":15,"heightPct":15,"exitDuration":2}, {"line":3,"show":true,"type":"step-list","items":["第一步：開啟設定","第二步：選擇選項","第三步：儲存"],"xPct":55,"yPct":55,"widthPct":35,"heightPct":30,"exitDuration":4}, {"line":4,"show":true,"type":"pointer","xPct":62,"yPct":38,"angle":270,"exitDuration":2}, {"line":5,"show":true,"type":"formula","formulaLatex":"E = mc^2","xPct":30,"yPct":40,"widthPct":40,"heightPct":15,"exitDuration":3}, {"line":6,"show":true,"type":"custom-script","scriptPrompt":"畫一個座標平面，顯示一個點沿曲線從左下移動到右上，代表數值隨時間成長","scriptDurationSeconds":6,"xPct":50,"yPct":50,"widthPct":40,"heightPct":40,"exitDuration":2}, {"line":7,"show":false}, ...]}',
    'effects 陣列必須包含使用者提供的每一個句子索引，且順序與索引需一致。整份回應最多只能有一個 type 為 custom-script 的項目。',
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
 * `type: 'pointer'` items use only `xPct`/`yPct` (no `widthPct`/`heightPct`)
 * since a pointer points to a single coordinate rather than an area.
 * `type: 'formula'` items carry `formula` (the AI's `formulaLatex`, trimmed
 * and truncated to `MAX_FORMULA_LENGTH`); if the AI picked `formula` without
 * a usable `formulaLatex`, the item falls back to `highlight-box`.
 * `type: 'custom-script'` items carry `prompt` (the AI's `scriptPrompt`,
 * truncated to `MAX_CUSTOM_SCRIPT_PROMPT_LENGTH`) and use `scriptDurationSeconds`
 * (clamped to `CUSTOM_SCRIPT_AI_DURATION_SECONDS`) as their `duration`; the
 * actual `code` is filled in afterwards by `fillCustomScriptEffectsCode`. At
 * most `MAX_CUSTOM_SCRIPT_EFFECTS_PER_PAGE_AI` such items are kept per page;
 * if the AI picked `custom-script` without a usable `scriptPrompt`, or beyond
 * that cap, the item falls back to `highlight-box`.
 */
export function mapAutoFocusResponseToEffects(response: AutoFocusAiResponse, sentenceLimit: number): AnimationEffect[] {
  const byLine = new Map<number, AutoFocusAiItem>();
  for (const item of response.effects) {
    if (item.line < 0 || item.line >= sentenceLimit) continue;
    if (!byLine.has(item.line)) byLine.set(item.line, item);
  }
  const lines = Array.from(byLine.keys()).sort((a, b) => a - b);
  const effects: AnimationEffect[] = [];
  let customScriptCount = 0;
  for (const line of lines) {
    const item = byLine.get(line);
    if (!item || !item.show) continue;
    let type: AnimationEffectType = item.type ?? 'highlight-box';
    let text: string | undefined;
    let shape: AnimationEffect['shape'];
    let items: string[] | undefined;
    let stepListBgColor: string | undefined;
    let stepListTextColor: string | undefined;
    let formulaStr: string | undefined;
    let scriptPrompt: string | undefined;
    let duration = AUTO_FOCUS_AI_DURATION_SECONDS;
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
        if (item.stepListBgColor) stepListBgColor = item.stepListBgColor;
        if (item.stepListTextColor) stepListTextColor = item.stepListTextColor;
      } else {
        // step-list 沒有任何項目就沒有意義，退回 highlight-box。
        type = 'highlight-box';
      }
    } else if (type === 'pointer') {
      // pointer 只需要 xPct/yPct，不需要 widthPct/heightPct，不需要額外驗證。
    } else if (type === 'formula') {
      const trimmedLatex = item.formulaLatex?.trim();
      if (trimmedLatex) {
        formulaStr = trimmedLatex.slice(0, MAX_FORMULA_LENGTH);
      } else {
        // formula 沒有 LaTeX 內容就沒有意義，退回 highlight-box。
        type = 'highlight-box';
      }
    } else if (type === 'custom-script') {
      const trimmedPrompt = item.scriptPrompt?.trim();
      if (trimmedPrompt && customScriptCount < MAX_CUSTOM_SCRIPT_EFFECTS_PER_PAGE_AI) {
        scriptPrompt = trimmedPrompt.slice(0, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH);
        duration = clamp(
          item.scriptDurationSeconds ?? CUSTOM_SCRIPT_AI_DURATION_SECONDS.default,
          CUSTOM_SCRIPT_AI_DURATION_SECONDS.min,
          CUSTOM_SCRIPT_AI_DURATION_SECONDS.max,
        );
        customScriptCount += 1;
      } else {
        // custom-script 沒有 scriptPrompt，或已超過每頁上限，退回 highlight-box。
        type = 'highlight-box';
      }
    }
    const effect: AnimationEffect = {
      id: `ai-focus-${line}-${crypto.randomUUID()}`,
      target: 'slide',
      type,
      start: 0,
      duration,
      ease: 'power1.out',
      startTrigger: { type: 'transcript-line', line },
      params: type === 'pointer'
        ? {
            xPct: clamp(item.xPct ?? 50, 0, 100),
            yPct: clamp(item.yPct ?? 50, 0, 100),
          }
        : {
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
    if (stepListBgColor !== undefined) {
      effect.stepListBgColor = stepListBgColor;
    }
    if (stepListTextColor !== undefined) {
      effect.stepListTextColor = stepListTextColor;
    }
    if (formulaStr !== undefined) {
      effect.formula = formulaStr;
    }
    if (scriptPrompt !== undefined) {
      effect.prompt = scriptPrompt;
    }
    if (item.exitDuration !== undefined) {
      effect.exitDuration = clamp(item.exitDuration, 0, MAX_EXIT_DURATION_SECONDS);
    }
    if (type === 'pointer' && item.angle !== undefined) {
      effect.angle = item.angle;
    }
    effects.push(effect);
  }
  return effects;
}

/**
 * Reverts an AI-picked `custom-script` effect back to `highlight-box` when
 * code generation fails or produces unsafe/invalid code, mirroring the
 * `text-callout`/`step-list` fallbacks in `mapAutoFocusResponseToEffects`.
 */
function revertCustomScriptEffectToHighlightBox(effect: AnimationEffect, reason: string, logContext: Record<string, unknown>): void {
  logger.warn({ ...logContext, reason }, 'animationAutoFocus: custom-script generation failed, falling back to highlight-box');
  effect.type = 'highlight-box';
  delete effect.prompt;
  delete effect.code;
  effect.duration = AUTO_FOCUS_AI_DURATION_SECONDS;
}

/**
 * Fills in `code` for each `custom-script` effect produced by
 * `mapAutoFocusResponseToEffects` (those carrying a `prompt` but no `code`),
 * by calling the same `generateCustomScriptCodeStream` pipeline used by the
 * manual custom-script chat dialog. Effects whose generated code fails the
 * safety pattern check (`findUnsafeScriptPattern`) or contract check
 * (`findCustomScriptContractIssue`), or whose generation call throws, fall
 * back to `highlight-box` via `revertCustomScriptEffectToHighlightBox`.
 */
export async function fillCustomScriptEffectsCode(
  effects: AnimationEffect[],
  params: { pageText: string; label: string },
): Promise<AnimationEffect[]> {
  for (const effect of effects) {
    if (effect.type !== 'custom-script' || !effect.prompt) continue;
    try {
      const result = await generateCustomScriptCodeStream(
        { prompt: effect.prompt, pageText: params.pageText, label: `${params.label} custom-script` },
        () => {},
      );
      const code = result.code.trim();
      if (!code || code.length > MAX_CUSTOM_SCRIPT_CODE_LENGTH) {
        revertCustomScriptEffectToHighlightBox(effect, 'empty or oversized code', { label: params.label });
        continue;
      }
      const unsafeReason = findUnsafeScriptPattern(code);
      if (unsafeReason) {
        revertCustomScriptEffectToHighlightBox(effect, `unsafe pattern: ${unsafeReason}`, { label: params.label });
        continue;
      }
      const contractIssue = findCustomScriptContractIssue(code);
      if (contractIssue) {
        revertCustomScriptEffectToHighlightBox(effect, `contract issue: ${contractIssue}`, { label: params.label });
        continue;
      }
      effect.code = code;
    } catch (err) {
      revertCustomScriptEffectToHighlightBox(effect, err instanceof Error ? err.message : String(err), { label: params.label });
    }
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
 *
 * If the AI picked `type: 'custom-script'` for one sentence, this also makes
 * an extra LLM call via `fillCustomScriptEffectsCode` to generate that
 * effect's code, falling back to `highlight-box` if generation fails.
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
  const effects = mapAutoFocusResponseToEffects(result.data, limit);
  return fillCustomScriptEffectsCode(effects, { pageText: params.pageText, label: params.label });
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

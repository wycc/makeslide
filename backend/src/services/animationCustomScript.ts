import { streamChatText } from './openai';
import { MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH } from './pageAnimation';

/**
 * Patterns disallowed in generated `custom-script` code. The sandboxed
 * `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) already blocks
 * cross-origin access to the parent page, cookies and storage at the browser
 * level; this is a defense-in-depth check on the LLM output so obviously
 * unsafe code is rejected before it's ever stored or rendered.
 */
const UNSAFE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfetch\s*\(/i, label: 'fetch' },
  { pattern: /XMLHttpRequest/i, label: 'XMLHttpRequest' },
  { pattern: /WebSocket/i, label: 'WebSocket' },
  { pattern: /\bimport\s*\(/i, label: 'import' },
  { pattern: /\brequire\s*\(/i, label: 'require' },
  { pattern: /\beval\s*\(/i, label: 'eval' },
  { pattern: /new\s+Function\s*\(/i, label: 'new Function' },
  { pattern: /document\s*\.\s*cookie/i, label: 'document.cookie' },
  { pattern: /document\s*\[\s*['"]cookie['"]\s*\]/i, label: 'document.cookie' },
  { pattern: /localStorage/i, label: 'localStorage' },
  { pattern: /sessionStorage/i, label: 'sessionStorage' },
  { pattern: /indexedDB/i, label: 'indexedDB' },
  { pattern: /(?:window|globalThis|self)\s*\.\s*parent/i, label: 'window.parent' },
  { pattern: /(?:window|globalThis|self)\s*\[\s*['"]parent['"]\s*\]/i, label: 'window.parent' },
  { pattern: /(?:window|globalThis|self)\s*\.\s*top/i, label: 'window.top' },
  { pattern: /(?:window|globalThis|self)\s*\[\s*['"]top['"]\s*\]/i, label: 'window.top' },
  { pattern: /frameElement/i, label: 'frameElement' },
];

/**
 * Returns the label of the first disallowed API/keyword found in `code`, or
 * `null` if the code passes the defense-in-depth checks.
 */
export function findUnsafeScriptPattern(code: string): string | null {
  for (const { pattern, label } of UNSAFE_PATTERNS) {
    if (pattern.test(code)) return label;
  }
  return null;
}

/**
 * Validates the minimal runtime contract expected by the iframe wrapper. The
 * sandbox itself will fail gracefully when `renderAnimation` is missing, but
 * rejecting obviously incompatible LLM output gives users a clearer retry path.
 */
export function findCustomScriptContractIssue(code: string): string | null {
  if (!/window\s*\.\s*renderAnimation\s*=|window\s*\[\s*['"]renderAnimation['"]\s*\]\s*=/.test(code)) {
    return 'Generated code must define window.renderAnimation(root, api)';
  }
  if (!/api\s*\.\s*onFrame\s*\(/.test(code)) {
    return 'Generated code must call api.onFrame(callback) so playback can stay synchronized';
  }
  return null;
}

function buildCustomScriptSystemPrompt(): string {
  return [
    '你是一位前端動畫工程師，負責依使用者描述產生一段「自訂腳本動畫」的 JavaScript 原始碼，用於投影片播放時疊加顯示。',
    '',
    '執行環境（請務必遵守）：',
    '- 你產生的程式碼會被注入到一個沒有 allow-same-origin 的 sandboxed <iframe> 中執行，無法存取上層頁面、cookie、localStorage 或任何網路資源。',
    '- 程式碼必須定義一個全域函式 `window.renderAnimation(root, api)`：',
    '  - `root`：一個已設定好寬高的 <div>，請將你的視覺內容（canvas、svg 或其他 DOM 元素）加入這個元素。',
    '  - `api.duration`：這個動畫效果的總長度（秒，數字），由使用者在編輯器中設定，不是由你決定或假設。',
    '  - `api.onFrame(callback)`：註冊一個回呼函式，每次投影片播放時間更新時會被呼叫一次，參數為 `{ t, playing }`：',
    '    - `t`：自此動畫淡入起算的秒數（數字，>= 0）。',
    '    - `playing`：投影片目前是否在播放（布林值）。',
    '  - 請用 `Math.min(t / api.duration, 1)` 計算 0~1 的播放進度並更新畫面內容，讓動畫在 `t` 從 0 增加到 `api.duration` 的過程中播放「一輪」完整動畫；當進度達到 1（即 `t >= api.duration`）後請維持在動畫結束時的最終畫面，不要重置或循環重播——之後此效果會依使用者設定的時間整體淡出消失。動畫仍須能因應 `t` 變小（使用者倒退/重新播放）正確地重新計算畫面。',
    '- 僅能使用標準瀏覽器 DOM / Canvas 2D / SVG / 純 JavaScript（ES2017）。禁止使用：fetch、XMLHttpRequest、WebSocket、import、require、eval、new Function、document.cookie、localStorage、sessionStorage、indexedDB、window.parent、window.top、frameElement，也不可載入任何外部網址、字型或函式庫。',
    '- 不要使用 import/export 語法，輸出單一段可直接以 <script> 執行的程式碼。',
    '',
    '若使用者要求「manim 風格」的動畫（例如幾何圖形繪製、座標平面、向量、Create/Write/Transform/FadeIn 等手法、深色背景＋粉彩色塊配色），可使用全域 `window.Manim` 輔助函式庫（在你的程式碼執行前已載入，不需自行定義）：',
    '  - 座標系：以 `root` 中心為原點，x 約在 -7~7、y 約在 -4~4，+y 朝上（與 SVG 相反，函式庫已處理轉換）。',
    '  - `Manim.createSvg(root)`：在 `root` 中建立填滿版面的 `<svg>` 並回傳，後續形狀皆加入此 svg。',
    '  - `Manim.shapes.circle/square/rectangle/line/arrow/dot/polygon/text(svg, opts)`：建立形狀並回傳 mobject（`{ el, kind, svg }`）；`opts` 可含 `x`/`y`（中心座標）、`radius`/`size`/`width`/`height`/`points`（`[[x,y],...]`，限 polygon）/`text`，以及 `color`（邊框/線條/文字色）、`fill`、`fillOpacity`、`strokeWidth`、`fontSize`。',
    '  - `Manim.colors`：manim 慣用色票，含 `WHITE`/`BLACK`/`GREY`/`BLUE`/`GREEN`/`RED`/`YELLOW`/`PURPLE`/`ORANGE`/`PINK`/`TEAL`。',
    '  - `Manim.rate.linear/smooth/thereAndBack/rushInto/rushFrom(t)`：manim 標準 rate function，輸入 0~1 進度，輸出調整後的 0~1 進度，可用於讓動畫的速度曲線更接近 manim。',
    '  - `Manim.animate.create/write/fadeIn/fadeOut/grow/shift/rotate/scale/transform(mobject, ...)`：manim 風格動畫，依目前進度（0~1）直接設定 mobject 的視覺狀態，可在每次 `onFrame` 重複呼叫；`create` 為描邊繪製效果、`write` 為文字逐字顯示、`transform(from, to, progress)` 在兩個同類型 mobject 間漸變並交叉淡化。',
    '  - `Manim.lerp(a, b, t)` / `Manim.lerpColor(hex1, hex2, t)`：數值/顏色線性插值。',
    '',
    '若使用者提供「目前程式碼」，代表使用者想在現有結果的基礎上依新的提示詞調整，請盡量延續其結構並套用變更，而不是整段重寫（除非使用者明確要求重做)。',
    '',
    '請只輸出完整的 JavaScript 原始碼本身（包含 window.renderAnimation 定義），不要使用 JSON 包裝、不要加上 ```、```javascript 等 markdown 程式碼框，也不要加任何說明文字或註解以外的內容——你的整個回覆會被原封不動當作程式碼使用。',
  ].join('\n');
}

function buildCustomScriptUserPrompt(params: { prompt: string; previousCode?: string; pageText?: string }): string {
  const parts: string[] = [];
  if (params.pageText?.trim()) {
    parts.push('【投影片頁面文字（OCR 擷取，僅供參考主題與內容）】', params.pageText.trim(), '');
  }
  if (params.previousCode?.trim()) {
    parts.push('【目前程式碼（請在此基礎上依新提示詞調整）】', params.previousCode.trim(), '');
  }
  parts.push('【使用者提示詞】', params.prompt.trim());
  return parts.join('\n');
}

/**
 * Strips a single leading/trailing markdown code fence (e.g. ```js ... ```)
 * if the LLM wrapped its output despite being asked not to, then trims
 * surrounding whitespace.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return (fenceMatch?.[1] ?? trimmed).trim();
}

/**
 * Asks the configured LLM to generate (or revise) the JavaScript source for
 * a `custom-script` animation effect from a free-text prompt, streaming the
 * raw output as it's generated via `onDelta`. Callers should run
 * `findUnsafeScriptPattern` and `findCustomScriptContractIssue` on the
 * resolved `code` before storing/rendering it.
 */
export async function generateCustomScriptCodeStream(
  params: {
    prompt: string;
    previousCode?: string;
    pageText?: string;
    label: string;
  },
  onDelta: (delta: string) => void,
): Promise<{ code: string; finishReason: string | null }> {
  const userText = buildCustomScriptUserPrompt({
    prompt: params.prompt.slice(0, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH),
    previousCode: params.previousCode,
    pageText: params.pageText,
  });
  const result = await streamChatText({
    label: params.label,
    maxTokens: MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS,
    temperature: 0.5,
    messages: [
      { role: 'system', content: buildCustomScriptSystemPrompt() },
      { role: 'user', content: userText },
    ],
    onDelta,
  });
  return { code: stripCodeFences(result.text), finishReason: result.finishReason };
}

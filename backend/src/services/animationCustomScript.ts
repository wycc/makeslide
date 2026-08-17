import type { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AppLanguage } from './aiSettings';
import { animationTextLanguageRule, contentLanguageName } from './contentLanguage';
import { streamChatText } from './openai';
import {
  MAX_CUSTOM_SCRIPT_IMAGE_DATA_URL_LENGTH,
  MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES,
  MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS,
  MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS,
  MAX_CUSTOM_SCRIPT_PROMPT_LENGTH,
} from './pageAnimation';
import type { ConversationMessage } from './pageAnimation';

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
  // Also block the callable Function constructor (`Function("…")()`), an eval
  // equivalent that `new Function` alone misses. Case-sensitive on the capital F
  // so it never matches the lowercase `function(` keyword in ordinary code.
  { pattern: /\bFunction\s*\(/, label: 'Function constructor' },
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

/**
 * System prompt for step 1 of the two-step generation flow: convert the
 * user's free-text description into a numbered implementation step list,
 * shown to the user before any code is written and later referenced as
 * inline comments by `buildCustomScriptSystemPrompt`'s code generator.
 */
function buildCustomScriptPlanSystemPrompt(language: AppLanguage): string {
  return [
    '你是一位前端動畫工程師，負責將使用者對「自訂腳本動畫」的描述，轉換成一份詳細的實作步驟清單；之後會依此清單撰寫 JavaScript 程式碼，並在程式碼中以註解標示每個步驟，方便使用者對照、手動調整。',
    '',
    '請輸出純文字的條列步驟，每行一個步驟，格式為「數字. 步驟描述」（例如：「1. 在畫面中央建立一個半徑 2 的藍色圓形」）。',
    '每個步驟請具體描述要建立或操作的視覺元素（形狀、文字、座標、顏色等），以及隨動畫進度（0~1，對應 api.onFrame 的 t/api.duration）產生的視覺變化。',
    '步驟順序請依實作順序排列（例如先建立元素，再描述其動畫變化），數量依描述複雜度自行決定，通常 3~8 步。',
    '若使用者描述的是可互動的內容（按鍵、點擊、拖曳等），請在步驟中明確寫出要處理哪些按鍵或哪些滑鼠操作、以及每個操作造成的畫面變化——動畫可向播放器宣告接管這些按鍵/滑鼠事件（未宣告者仍由播放器用於翻頁、播放/暫停）。',
    '若使用者提供「目前程式碼」或「先前對話」，代表使用者想在現有結果基礎上調整：請只列出「需要新增或修改」的步驟，不必重複描述既有且不變的部分。',
    '使用者可能附上參考圖片（例如手繪草圖、示意圖、想模仿的畫面截圖）。有附圖時請以圖片為主要依據，在步驟中具體描述要重現的版面、元素位置、形狀與配色，而不是只重述使用者的文字。',
    '只輸出步驟清單本身，不要輸出程式碼、JSON、標題或其他說明文字。',
    '',
    `【輸出語言】請用${contentLanguageName(language)}撰寫這份步驟清單（它會顯示給使用者看）。${animationTextLanguageRule(language)}步驟中若提到動畫要顯示的字句，請直接以該語言寫出。`,
  ].join('\n');
}

function buildCustomScriptSystemPrompt(language: AppLanguage): string {
  return [
    '你是一位前端動畫工程師，負責依使用者描述產生一段「自訂腳本動畫」的 JavaScript 原始碼，用於投影片播放時疊加顯示。',
    '',
    '你會收到一份「實作步驟」清單（已依使用者提示詞整理為條列步驟）。請依照清單中的步驟撰寫程式碼，並在程式碼中對應位置加上單行註解標示步驟（例如 `// 步驟 1：...`），讓使用者之後可以對照步驟自行調整程式碼；註解可使用步驟原文或精簡摘要，但需清楚對應到該步驟，不需要逐字照抄。',
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
    '互動輸入（鍵盤／滑鼠）：只有在使用者的描述明確要求互動（例如「按方向鍵移動」、「點一下切換」、「用滑鼠拖曳」）時才使用這組 API；純播放的動畫請完全略過這一段，不要呼叫任何 capture 函式。',
    '- 動畫執行在不會取得焦點的 iframe 中，`window.addEventListener(\'keydown\', ...)`、`root.addEventListener(\'click\', ...)` 這類自行監聽**完全收不到事件**（事件都被播放器 UI 接走了），必須改用下列 api：',
    '  - `api.captureKeys(["ArrowLeft", "ArrowRight", " "])`：宣告你要處理的按鍵（值為 `KeyboardEvent.key`，例如 `"ArrowLeft"`、`" "`（空白鍵）、`"a"`；要接管所有按鍵時寫 `api.captureKeys("*")` 或 `api.captureKeys(["*"])` 皆可）。宣告後這些按鍵在此動畫顯示期間會**優先交給你的動畫**，播放器不再用它們翻頁/暫停；沒有宣告的按鍵維持播放器原本的行為。`"Escape"` 由播放器保留（用於離開全螢幕），宣告了也不會送給你。',
    '  - `api.onKey(function (ev) { ... })`：接收已宣告的按鍵事件，`ev` 為 `{ type: "keydown"|"keyup", key, code, repeat, ctrlKey, shiftKey, altKey, metaKey }`。',
    '  - `api.capturePointer()`：宣告你要處理滑鼠事件（若也需要滾輪請用 `api.capturePointer({ wheel: true })`）；只有落在此動畫方框範圍內的滑鼠事件會交給你，方框外仍由播放器處理。',
    '  - `api.onPointer(function (ev) { ... })`：接收滑鼠事件，`ev` 為 `{ type: "pointerdown"|"pointermove"|"pointerup"|"click"|"dblclick"|"contextmenu"|"wheel", x, y, nx, ny, button, buttons, deltaX, deltaY, ctrlKey, shiftKey, altKey, metaKey }`；`x`/`y` 是動畫方框內的像素座標（與 `root` 的座標系一致，可直接對應到你畫出的內容），`nx`/`ny` 是 0~1 的相對座標。',
    '  - `api.releaseKeys()` / `api.releasePointer()`：互動結束後歸還控制權，讓這些按鍵/滑鼠事件回到播放器（例如互動小遊戲結束、或動畫已進入不需互動的階段時）。**這件事很重要**：只要動畫還握著輸入，播放器就會把這一頁停住不自動換頁（否則觀眾會在互動到一半時被換走）；因此互動一旦結束，請務必呼叫 release，否則這一頁不會自己往下走。',
    '- **互動動畫的時間**：一旦宣告了任何 capture，`api.onFrame` 的 `t` 就改由動畫自己的時鐘持續前進——不會因為投影片暫停而停住（觀眾常常就是為了互動才按暫停），也不會被 `api.duration` 夾住（互動要花多久取決於觀眾按多快，一定會超過）。因此互動動畫**不可以**假設 `t` 不超過 `api.duration`，也不要用 `t / api.duration` 當作整體進度；請記下每個階段開始時的 `t`，用「`t` 減去該階段起始時間」計算這一段的進度（例如 `Math.min((t - stageStartTime) / stageSeconds, 1)`）。觀眾倒退或重播時 `t` 會變小，請據此重設互動狀態。',
    '- 請只宣告真正會用到的按鍵，不要為了保險宣告 `"*"` 或一長串按鍵——被宣告的按鍵在此動畫顯示期間，播放器的翻頁（方向鍵）、播放/暫停（空白鍵）等快捷鍵都會失效。',
    '- 互動狀態請存在你自己的變數中，並在事件回呼或 `api.onFrame` 中重繪畫面；只有此效果正顯示於畫面上的期間會收到輸入事件。',
    '- 即使是互動動畫，仍必須呼叫 `api.onFrame(...)`（可用於重繪或處理時間相關的變化）。',
    '',
    '使用者可能附上參考圖片（手繪草圖、示意圖、想模仿的畫面截圖等）。有附圖時請依圖片重現其版面、元素相對位置、形狀與配色；圖片是視覺依據，不要把圖片本身或任何外部網址載入程式碼中（sandbox 無法存取網路），一律用 DOM/Canvas/SVG 自行繪製。',
    '',
    '若使用者要求「manim 風格」的動畫（例如幾何圖形繪製、座標平面、向量、Create/Write/Transform/FadeIn 等手法、深色背景＋粉彩色塊配色），可使用全域 `window.Manim` 輔助函式庫（在你的程式碼執行前已載入，不需自行定義）：',
    '  - 座標系：以 `root` 中心為原點，x 約在 -7~7、y 約在 -4~4，+y 朝上（與 SVG 相反，函式庫已處理轉換）。',
    '  - `Manim.createSvg(root)`：在 `root` 中建立填滿版面的 `<svg>` 並回傳，後續形狀皆加入此 svg。',
    '  - `Manim.shapes.circle/square/rectangle/line/arrow/dot/polygon/text(svg, opts)`：建立形狀並回傳 mobject（`{ el, kind, svg }`）；`opts` 可含 `x`/`y`（中心座標）、`radius`/`size`/`width`/`height`/`points`（`[[x,y],...]`，限 polygon）/`text`，以及 `color`（邊框/線條/文字色）、`fill`、`fillOpacity`、`strokeWidth`、`fontSize`。重要：Manim SVG 場景高度只有 8 個座標單位，`text` 的 `fontSize` 請使用場景單位（建議 0.25~0.8，預設 0.45），不要使用 18、24、32 這類像素大小，否則文字會巨大到遮住整張投影片。',
    '  - `Manim.colors`：manim 慣用色票，含 `WHITE`/`BLACK`/`GREY`/`BLUE`/`GREEN`/`RED`/`YELLOW`/`PURPLE`/`ORANGE`/`PINK`/`TEAL`。',
    '  - `Manim.rate.linear/smooth/thereAndBack/rushInto/rushFrom(t)`：manim 標準 rate function，輸入 0~1 進度，輸出調整後的 0~1 進度，可用於讓動畫的速度曲線更接近 manim。',
    '  - `Manim.animate.create/write/fadeIn/fadeOut/grow/shift/rotate/scale/transform(mobject, ...)`：manim 風格動畫，依目前進度（0~1）直接設定 mobject 的視覺狀態，可在每次 `onFrame` 重複呼叫；`create` 為描邊繪製效果、`write` 為文字逐字顯示、`transform(from, to, progress)` 在兩個同類型 mobject 間漸變並交叉淡化。',
    '  - `Manim.lerp(a, b, t)` / `Manim.lerpColor(hex1, hex2, t)`：數值/顏色線性插值。',
    '  - `Manim.coordinateSystems.axes(svg, opts)` / `Manim.coordinateSystems.numberPlane(svg, opts)`：建立座標平面（對應 manim 的 `Axes`/`NumberPlane`），回傳 `{ el, kind, svg, coordsToPoint }`；`numberPlane` 額外繪製整面格線，`axes` 只畫兩軸與刻度。`opts` 可含 `xRange`/`yRange`（`[min, max, step?]`，預設 `[-7,7,1]`/`[-4,4,1]`，`step` 預設 1，決定格線/刻度間距）、`xLength`/`yLength`（座標系統佔用的場景寬高，預設 14/8）、`color`（軸線/刻度色，預設白）、`gridColor`（`numberPlane` 格線色，預設灰）。回傳值的 `coordsToPoint(x, y)` 會將資料座標線性映射到場景座標（可直接作為 `Manim.shapes.*` 的 `x`/`y`），原點對應 `(0,0)`。整個回傳值可像其他 mobject 一樣傳入 `Manim.animate.*`（`create`/`write` 會退化為 `fadeIn`）。',
    '  - `Manim.tex(latex, opts?)`：回傳 `Promise<HTMLElement>`，透過 postMessage 向 host 頁面請求 KaTeX MathML 渲染（host 已載入 KaTeX 字型，sandbox 無需網路存取），resolve 後得到含有 MathML 的 `<div>` DOM 元素，可直接 `appendChild` 至 `root` 或加入動畫中。`opts` 可含 `color`（文字色）、`fontSize`（字型大小，例如 `\"1.2em\"`）。用法範例：`Manim.tex("E = mc^2").then(el => { root.appendChild(el); })`；在 async 函式中可用 `await Manim.tex(...)` 取得元素後執行動畫。注意：`Manim.tex` 是非同步的，若在 `window.renderAnimation` 內直接 `await` 須將該函式宣告為 `async function`；若需在 `api.onFrame` 的同步回呼中使用已渲染的元素，請先在 `renderAnimation` 初始化時以 `await Manim.tex(...)` 取得所有需要的元素，再於 `api.onFrame` 回呼中操作它們。',
    '',
    '若使用者提供「目前程式碼」，代表使用者想在現有結果的基礎上依新的提示詞調整，請盡量延續其結構並套用變更，而不是整段重寫（除非使用者明確要求重做)。',
    '',
    `【輸出語言】${animationTextLanguageRule(language)}程式碼中標示實作步驟的註解也請用${contentLanguageName(language)}撰寫。`,
    '',
    '請只輸出完整的 JavaScript 原始碼本身（包含 window.renderAnimation 定義），不要使用 JSON 包裝、不要加上 ```、```javascript 等 markdown 程式碼框，也不要加任何說明文字或註解以外的內容——你的整個回覆會被原封不動當作程式碼使用。',
  ].join('\n');
}

function buildCustomScriptUserPrompt(params: {
  prompt: string;
  previousCode?: string;
  pageText?: string;
  plan?: string;
}): string {
  const parts: string[] = [];
  if (params.pageText?.trim()) {
    parts.push('【投影片頁面文字（OCR 擷取，僅供參考主題與內容）】', params.pageText.trim(), '');
  }
  if (params.previousCode?.trim()) {
    parts.push('【目前程式碼（請在此基礎上依新提示詞調整）】', params.previousCode.trim(), '');
  }
  if (params.plan?.trim()) {
    parts.push('【實作步驟】', params.plan.trim(), '');
  }
  parts.push('【使用者提示詞】', params.prompt.trim());
  return parts.join('\n');
}

/** `data:` URLs for the raster formats the vision models accept. */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Keeps only attachments that are actually inline images of a supported type and a sane size.
 *
 * These arrive from the browser and are forwarded straight to the model, so a URL pointing anywhere
 * else (`http:`, `file:`) must never be passed on — that would turn an attachment into a
 * server-side fetch of whatever the caller named.
 */
export function usableReferenceImages(images: readonly string[] | undefined, limit: number): string[] {
  if (!images?.length) return [];
  return images
    .filter((image) => typeof image === 'string'
      && image.length <= MAX_CUSTOM_SCRIPT_IMAGE_DATA_URL_LENGTH
      && IMAGE_DATA_URL_PATTERN.test(image))
    .slice(0, limit);
}

/**
 * The user turn: text alone, or the reference images followed by the text.
 *
 * Images come first because the text refers to them ("draw it like this"), and a model that reads
 * the instruction before seeing the picture answers about the wrong thing.
 */
function buildUserMessage(text: string, images: readonly string[]): ChatCompletionMessageParam {
  if (images.length === 0) return { role: 'user', content: text };
  const parts: ChatCompletionContentPart[] = images.map((image) => ({
    type: 'image_url' as const,
    image_url: { url: image, detail: 'high' as const },
  }));
  parts.push({ type: 'text', text });
  return { role: 'user', content: parts };
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

/** Converts a stored chat turn into the LLM message format, preserving its role. */
function toChatCompletionMessage(message: ConversationMessage): ChatCompletionMessageParam {
  return message.role === 'assistant'
    ? { role: 'assistant', content: message.content }
    : { role: 'user', content: message.content };
}

/**
 * Step 1 of the two-step generation flow: asks the configured LLM to turn the
 * user's free-text prompt into a numbered implementation step list, streaming
 * the raw output as it's generated via `onDelta`. The resolved `plan` is shown
 * to the user and then passed to `generateCustomScriptCodeStream` so the
 * generated code's comments can reference each step. `history` carries prior
 * chat turns so the plan can describe just the incremental change on
 * multi-round edits.
 */
export async function generateCustomScriptPlanStream(
  params: {
    prompt: string;
    previousCode?: string;
    pageText?: string;
    history?: ConversationMessage[];
    /** Inline `data:` image URLs the user attached as visual reference. */
    images?: string[];
    language: AppLanguage;
    label: string;
  },
  onDelta: (delta: string) => void,
): Promise<{ plan: string; finishReason: string | null }> {
  const userText = buildCustomScriptUserPrompt({
    prompt: params.prompt.slice(0, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH),
    previousCode: params.previousCode,
    pageText: params.pageText,
  });
  const result = await streamChatText({
    label: params.label,
    maxTokens: MAX_CUSTOM_SCRIPT_PLAN_OUTPUT_TOKENS,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildCustomScriptPlanSystemPrompt(params.language) },
      ...(params.history ?? []).map(toChatCompletionMessage),
      buildUserMessage(userText, usableReferenceImages(params.images, MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES)),
    ],
    onDelta,
  });
  return { plan: stripCodeFences(result.text), finishReason: result.finishReason };
}

/**
 * Step 2 of the two-step generation flow: asks the configured LLM to generate
 * (or revise) the JavaScript source for a `custom-script` animation effect,
 * following the `plan` produced by `generateCustomScriptPlanStream` and
 * annotating each step as a comment in the output. Streams the raw output as
 * it's generated via `onDelta`. `history` carries prior chat turns (without
 * their generated code) so the LLM has context for progressive, multi-round
 * edits. Callers should run `findUnsafeScriptPattern` and
 * `findCustomScriptContractIssue` on the resolved `code` before
 * storing/rendering it.
 */
export async function generateCustomScriptCodeStream(
  params: {
    prompt: string;
    previousCode?: string;
    pageText?: string;
    plan?: string;
    history?: ConversationMessage[];
    /** Inline `data:` image URLs the user attached as visual reference. */
    images?: string[];
    language: AppLanguage;
    label: string;
  },
  onDelta: (delta: string) => void,
): Promise<{ code: string; finishReason: string | null }> {
  const userText = buildCustomScriptUserPrompt({
    prompt: params.prompt.slice(0, MAX_CUSTOM_SCRIPT_PROMPT_LENGTH),
    previousCode: params.previousCode,
    pageText: params.pageText,
    plan: params.plan,
  });
  const result = await streamChatText({
    label: params.label,
    maxTokens: MAX_CUSTOM_SCRIPT_OUTPUT_TOKENS,
    temperature: 0.5,
    messages: [
      { role: 'system', content: buildCustomScriptSystemPrompt(params.language) },
      ...(params.history ?? []).map(toChatCompletionMessage),
      buildUserMessage(userText, usableReferenceImages(params.images, MAX_CUSTOM_SCRIPT_REFERENCE_IMAGES)),
    ],
    onDelta,
  });
  return { code: stripCodeFences(result.text), finishReason: result.finishReason };
}

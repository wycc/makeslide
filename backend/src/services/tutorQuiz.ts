/**
 * 課後輔導測試（自適應練習）的純邏輯：難度階梯、能力估計、出題提示詞組裝。
 *
 * 與 quizScoring.ts（正式測驗的配分）分開：那邊算的是「一份固定題目的得分」，
 * 這裡算的是「下一題該出多難、目前落在哪一級」。全部是純函式，路由只負責讀寫 DB
 * 與呼叫 LLM，好讓升降級與評估規則能單獨測試。
 */

export const TUTOR_MIN_LEVEL = 1;
export const TUTOR_MAX_LEVEL = 5;
/** 起始難度。從 L2（理解）開始而不是 L1，是因為 L1 只考名詞覆誦，對多數人是浪費題數。 */
export const TUTOR_DEFAULT_LEVEL = 2;
/** 每答滿這麼多題產生一次難度評估。 */
export const TUTOR_ASSESSMENT_INTERVAL = 10;
/** 單一 session 的題數上限，避免無限出題把額度耗光。 */
export const TUTOR_MAX_QUESTIONS = 100;

export type TutorLevel = 1 | 2 | 3 | 4 | 5;

/** 各難度的出題要求，直接嵌進提示詞；描述寫得具體，模型才不會五級都出成換句話說。 */
export const TUTOR_LEVEL_RUBRIC: Record<number, string> = {
  1: 'L1 記憶：只考簡報中直接出現的名詞、定義或事實，答案能在單一頁面上原文找到。',
  2: 'L2 理解：換句話說、辨識概念之間的差異或舉例，需要讀懂而非背誦。',
  3: 'L3 應用：給一個簡短情境，要求套用簡報講過的方法、規則或流程來判斷。',
  4: 'L4 分析：比較多個概念、追因果、找出敘述中的錯誤或隱含前提，通常需要跨頁資訊。',
  5: 'L5 綜合評鑑：整合全篇內容做取捨判斷，例如在多個可行方案中選出最適用者並理解其適用邊界。',
};

export function clampLevel(level: number): TutorLevel {
  const rounded = Math.round(Number.isFinite(level) ? level : TUTOR_DEFAULT_LEVEL);
  if (rounded < TUTOR_MIN_LEVEL) return TUTOR_MIN_LEVEL;
  if (rounded > TUTOR_MAX_LEVEL) return TUTOR_MAX_LEVEL;
  return rounded as TutorLevel;
}

/**
 * 答對升一級、答錯降一級，夾在 L1–L5（經典的 1-up/1-down 階梯法）。
 * 已在頂／底時再答對／答錯就停在原地——這正是「穩定落在某一級」的訊號，
 * estimateAbility 也靠這段停滯把落點算出來。
 */
export function nextLevel(level: number, correct: boolean): TutorLevel {
  return clampLevel(clampLevel(level) + (correct ? 1 : -1));
}

/** 答滿第 10、20、30… 題時該產生評估。未作答（0 題）不算。 */
export function shouldAssess(answeredCount: number): boolean {
  return answeredCount > 0 && answeredCount % TUTOR_ASSESSMENT_INTERVAL === 0;
}

export interface TutorAnswerRecord {
  level: number;
  is_correct: boolean;
}

export interface TutorAbilityEstimate {
  /** 能力落點（1–5，保留一位小數）。 */
  level_estimate: number;
  correct_count: number;
  total: number;
  /** 正確率 0–1。 */
  accuracy: number;
}

/**
 * 由作答紀錄估計能力落點。
 *
 * 每題的貢獻：答對記為該題難度（能達到這一級），答錯記為該題難度 − 1（尚未達到），
 * 取平均後夾在 1–5。這是階梯法慣用的「反轉點平均」的簡化版——不必等反轉點成對出現，
 * 題數少（第一次評估只有 10 題）時也給得出穩定的數字。
 */
export function estimateAbility(records: readonly TutorAnswerRecord[]): TutorAbilityEstimate {
  const total = records.length;
  if (total === 0) {
    return { level_estimate: TUTOR_DEFAULT_LEVEL, correct_count: 0, total: 0, accuracy: 0 };
  }
  const correct_count = records.filter((r) => r.is_correct).length;
  const sum = records.reduce((acc, r) => acc + (r.is_correct ? clampLevel(r.level) : clampLevel(r.level) - 1), 0);
  const raw = sum / total;
  const bounded = Math.min(TUTOR_MAX_LEVEL, Math.max(TUTOR_MIN_LEVEL, raw));
  return {
    level_estimate: Math.round(bounded * 10) / 10,
    correct_count,
    total,
    accuracy: correct_count / total,
  };
}

/**
 * 取「最近一個評估區間」的作答紀錄（第 1–10、11–20…）。評估要描述的是這 10 題的表現，
 * 不是整個 session 的平均——否則練到第 50 題時，前面早期的低難度題會一直把落點往下拉。
 */
export function segmentRecords<T>(records: readonly T[], throughSeq: number): T[] {
  const start = Math.max(0, throughSeq - TUTOR_ASSESSMENT_INTERVAL);
  return records.slice(start, throughSeq);
}

/** 相對前一次評估的變化。前一次不存在時為 'first'。 */
export type TutorTrend = 'up' | 'down' | 'flat' | 'first';

export function abilityTrend(current: number, previous: number | null): TutorTrend {
  if (previous === null) return 'first';
  const delta = current - previous;
  if (delta > 0.25) return 'up';
  if (delta < -0.25) return 'down';
  return 'flat';
}

export interface BuildQuestionPromptInput {
  level: number;
  /** 整份簡報的逐字稿／文字（已截斷）。 */
  context: string;
  /** 使用者輸入的主題聚焦，可為空字串。 */
  topic: string;
  /** 本 session 已出過的題目文字，用來要求不得重複。 */
  askedQuestions: readonly string[];
  /** 最近答錯的題目文字，讓模型往弱點方向靠。 */
  recentWrongQuestions?: readonly string[];
}

/** 已出題清單塞進提示詞的上限；太長會擠掉簡報內容本身。 */
const MAX_ASKED_IN_PROMPT = 20;
const MAX_WRONG_IN_PROMPT = 5;

/**
 * 組出出題用的 user 訊息。抽成純函式是為了能直接斷言「難度描述有進去」「已出過的題目有被列出」
 * ——重複出題是自適應練習最容易破功的地方，而那條要求只存在於提示詞裡。
 */
export function buildQuestionPrompt(input: BuildQuestionPromptInput): string {
  const level = clampLevel(input.level);
  const parts: string[] = [];
  parts.push(`難度等級：${TUTOR_LEVEL_RUBRIC[level]}`);
  const topic = input.topic.trim();
  if (topic) parts.push(`主題聚焦：只出與「${topic}」相關的題目。若簡報中該主題內容不足，就出最接近的部分。`);
  const asked = input.askedQuestions.slice(-MAX_ASKED_IN_PROMPT);
  if (asked.length > 0) {
    parts.push(`已經出過的題目（不得重複，也不要只改寫措辭）：\n${asked.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }
  const wrong = (input.recentWrongQuestions ?? []).slice(-MAX_WRONG_IN_PROMPT);
  if (wrong.length > 0) {
    parts.push(`學習者最近答錯的題目（可針對同一觀念換角度再問，但不得出一模一樣的題）：\n${wrong.map((q) => `- ${q}`).join('\n')}`);
  }
  parts.push(`簡報內容：\n${input.context}`);
  return parts.join('\n\n');
}

/** 出題的 system 訊息。 */
export const TUTOR_QUESTION_SYSTEM_PROMPT =
  '你是課後輔導老師，正在對一位學習者進行自適應練習。請依指定難度等級，根據簡報內容出一道四選項單選題。' +
  '只回傳 JSON：{"question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"...","page_number":1}。' +
  'correct_index 是正確答案的索引（0–3）。explanation 用一到兩句話說明為什麼是這個答案。' +
  'page_number 是這題主要依據的投影片頁碼（整數，不確定就給最相關的一頁）。' +
  '四個選項長度要接近，錯誤選項必須是有人真的會選的合理誤解，不要出明顯湊數的選項。所有欄位必填。';

/** 難度評估評語的 system 訊息。 */
export const TUTOR_ASSESSMENT_SYSTEM_PROMPT =
  '你是課後輔導老師，要為學習者這一輪（10 題）的自適應練習寫一段簡短回饋。' +
  '只回傳 JSON：{"summary":"...","weak_topics":["...","..."]}。' +
  'summary 用繁體中文兩到三句話，說明目前的掌握程度與下一步該加強什麼，語氣具體、對事不對人，不要客套話。' +
  'weak_topics 是 0–3 個弱點主題的短語（每個 20 字內）；若表現穩定且沒有明顯弱點就給空陣列。';

export interface BuildAssessmentPromptInput {
  estimate: TutorAbilityEstimate;
  trend: TutorTrend;
  /** 這一區間的題目與對錯。 */
  segment: readonly { question: string; level: number; is_correct: boolean }[];
  topic: string;
}

export function buildAssessmentPrompt(input: BuildAssessmentPromptInput): string {
  const { estimate, segment, trend } = input;
  const trendText =
    trend === 'first' ? '這是第一次評估' :
    trend === 'up' ? '相較上一輪有進步' :
    trend === 'down' ? '相較上一輪退步' : '與上一輪持平';
  const lines = segment.map((s, i) => `${i + 1}. [L${clampLevel(s.level)}] ${s.is_correct ? '答對' : '答錯'}：${s.question}`);
  const topic = input.topic.trim();
  return [
    `能力落點：L${estimate.level_estimate}（1–5 級，5 最難）；本輪答對 ${estimate.correct_count}/${estimate.total} 題；${trendText}。`,
    topic ? `練習主題：${topic}` : '',
    `本輪作答明細：\n${lines.join('\n')}`,
    `各難度定義：\n${Object.values(TUTOR_LEVEL_RUBRIC).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

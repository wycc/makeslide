// AI 導師（PageAskPanel）多輪對話的脈絡上限管理。
//
// `/ask` 端點會把先前對話（history）連同整份簡報 corpus、原始來源全文一起塞進
// prompt。history 的 schema 僅限制「最多 20 輪、每則最多 8000 字」，最壞情況可達
// 約 160,000 字，與 corpus（14000）、source（12000）相比明顯失衡，長對話會擠爆
// token 預算。此純函式在送入模型前，把 history 收斂到一個字元預算內。
//
// 策略：**保留最新的連續數輪**（由舊到新，超出預算時先丟最舊的），因為追問時最近
// 的脈絡最重要。若「最新一則」本身就超過預算，則保留它但截斷內容（附省略標記），
// 確保只要有 history 且預算 > 0，就不會整段清空而失去眼前的脈絡。

export interface AskChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ELISION_MARKER = '……（前略）……';

// 把對話歷史（oldest-first）收斂到 maxChars 字元預算內，保留最新的連續訊息。
// - maxChars <= 0：回傳空陣列（不帶任何歷史）。
// - 由新到舊累加 content 長度，能完整放入者保留；遇到放不下的較舊訊息即停止。
// - 若最新一則單獨就超過預算，保留它但把 content 截斷為預算長度並加省略標記，
//   避免長訊息導致整段脈絡被丟棄。
// 回傳的陣列維持原本的 oldest-first 順序，且為新物件（不改動輸入）。
export function budgetChatHistory<T extends AskChatMessage>(history: readonly T[], maxChars: number): T[] {
  if (maxChars <= 0 || history.length === 0) return [];
  const kept: T[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (!msg) continue;
    const len = msg.content.length;
    if (used + len <= maxChars) {
      kept.unshift(msg);
      used += len;
      continue;
    }
    // 放不下這一則較舊的訊息。
    if (kept.length === 0) {
      // 這是最新一則、且本身就超過預算：截斷保留而非整段丟棄。
      const budget = Math.max(0, maxChars - ELISION_MARKER.length);
      kept.unshift({ ...msg, content: ELISION_MARKER + msg.content.slice(msg.content.length - budget) } as T);
    }
    break;
  }
  return kept;
}

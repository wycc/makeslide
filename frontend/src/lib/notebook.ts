// Jupyter Notebook（.ipynb）解析為正規化 cell 模型（第一步、純函式）。
//
// 規畫功能：把一個 .ipynb 放進一個頁面並唯讀呈現（執行代碼列為後續）。這裡先把 .ipynb
// 的原始 JSON 解析成前端渲染友善的正規化模型：cell 依序、source 併成單一字串、code cell
// 的 outputs 收斂成 text／image／error 三類。全程防護損壞 JSON 與缺欄位，任何無法解析
// 者退化為空 notebook 或跳過該 cell，不丟例外。

export type NotebookCellType = 'markdown' | 'code' | 'raw';

export interface NotebookOutputText {
  kind: 'text';
  text: string;
}
export interface NotebookOutputImage {
  kind: 'image';
  mimeType: string;
  /** base64（不含 data: 前綴）。 */
  dataBase64: string;
}
export interface NotebookOutputError {
  kind: 'error';
  ename: string;
  evalue: string;
  traceback: string;
}
export type NotebookOutput = NotebookOutputText | NotebookOutputImage | NotebookOutputError;

export interface NotebookCell {
  type: NotebookCellType;
  source: string;
  /** 僅 code cell 可能有；其他一律空陣列。 */
  outputs: NotebookOutput[];
}

export interface ParsedNotebook {
  cells: NotebookCell[];
}

const EMPTY: ParsedNotebook = { cells: [] };

// .ipynb 的 source/text 可能是字串或字串陣列（每行一個元素）；一律併成單一字串。
function joinMultiline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('');
  return '';
}

function normalizeCellType(raw: unknown): NotebookCellType {
  return raw === 'markdown' || raw === 'code' ? raw : 'raw';
}

// 從 execute_result／display_data 的 `data` 物件挑一種可呈現的輸出：優先圖片、否則純文字。
function outputFromData(data: Record<string, unknown>): NotebookOutput | null {
  for (const mimeType of Object.keys(data)) {
    if (mimeType.startsWith('image/')) {
      const payload = data[mimeType];
      const dataBase64 = joinMultiline(payload);
      if (dataBase64) return { kind: 'image', mimeType, dataBase64 };
    }
  }
  const plain = joinMultiline(data['text/plain']);
  if (plain) return { kind: 'text', text: plain };
  return null;
}

function normalizeOutput(raw: unknown): NotebookOutput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  switch (o.output_type) {
    case 'stream': {
      const text = joinMultiline(o.text);
      return text ? { kind: 'text', text } : null;
    }
    case 'execute_result':
    case 'display_data': {
      const data = o.data;
      if (typeof data !== 'object' || data === null) return null;
      return outputFromData(data as Record<string, unknown>);
    }
    case 'error': {
      const traceback = joinMultiline(o.traceback);
      return {
        kind: 'error',
        ename: typeof o.ename === 'string' ? o.ename : '',
        evalue: typeof o.evalue === 'string' ? o.evalue : '',
        traceback,
      };
    }
    default:
      return null;
  }
}

function normalizeCell(raw: unknown): NotebookCell | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const type = normalizeCellType(c.cell_type);
  const source = joinMultiline(c.source);
  const outputs: NotebookOutput[] =
    type === 'code' && Array.isArray(c.outputs)
      ? c.outputs.map(normalizeOutput).filter((o): o is NotebookOutput => o !== null)
      : [];
  return { type, source, outputs };
}

export function parseNotebook(raw: string): ParsedNotebook {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY;
  const cellsRaw = (parsed as Record<string, unknown>).cells;
  if (!Array.isArray(cellsRaw)) return EMPTY;
  const cells = cellsRaw.map(normalizeCell).filter((c): c is NotebookCell => c !== null);
  return { cells };
}

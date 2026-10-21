// 學生交卷後自動下載的「作答證明」PDF（使用者要求，2026-10-07）。
//
// 為什麼在前端用 canvas 畫再包成 PDF：題目與作答多半是中文，純 PDF 文字要嵌入 CJK 字型（數 MB），
// 而 canvas 直接用裝置字型就能畫中文；每頁畫成一張 JPEG，再用最小的 PDF 結構（DCTDecode 影像）
// 包起來，不需要任何新依賴，手機與電腦都能開。
//
// 分三層：`findUnansweredQuestionNumbers`／`buildReceiptLines` 是純函式（可測），
// `jpegPagesToPdf` 只組 PDF 位元組（可測），`renderReceiptPdf` 才碰 DOM canvas。

import type { QuizQuestion } from '../types';

/** 依題目順序回傳尚未作答的題號（1 起算）。選擇題看是否有選項；問答題看是否已上傳照片。 */
export function findUnansweredQuestionNumbers(
  questions: readonly Pick<QuizQuestion, 'id' | 'type'>[],
  answers: Record<string, readonly number[] | undefined>,
  essayPhotoCounts: Record<string, number | undefined>,
): number[] {
  const out: number[] = [];
  questions.forEach((q, idx) => {
    const answered = q.type === 'essay'
      ? (essayPhotoCounts[q.id] ?? 0) > 0
      : (answers[q.id] ?? []).length > 0;
    if (!answered) out.push(idx + 1);
  });
  return out;
}

export interface QuizReceiptData {
  quizTitle: string;
  deckTitle?: string | null;
  code: string | null;
  name?: string | null;
  clientId: string;
  sessionId: string;
  questions: readonly QuizQuestion[];
  answers: Record<string, readonly number[] | undefined>;
  essayPhotoCounts: Record<string, number | undefined>;
  /** 問答題已上傳的照片本身（題目 id → 照片），嵌入 PDF；沒有就只寫張數。 */
  essayPhotos?: Record<string, readonly Blob[] | undefined>;
  generatedAt: Date;
  /** 伺服器回傳的收件資訊；null＝上傳沒有確認成功。 */
  receipt: { attemptId: number; submittedAt: string } | null;
  /** 作答內容的 SHA-256（十六進位）；瀏覽器不支援 crypto.subtle 時為 null。 */
  fingerprint: string | null;
}

export type ReceiptLineKind = 'title' | 'meta' | 'warn' | 'heading' | 'question' | 'option' | 'chosen' | 'note' | 'footer' | 'gap' | 'image';

export interface ReceiptLine {
  kind: ReceiptLineKind;
  text: string;
  /** kind === 'image' 時的照片；text 是照片無法解碼時顯示的替代文字。 */
  image?: Blob;
}

type Format = (key: string, vars?: Record<string, string | number>) => string;

/** 題目／選項是 Markdown＋數學：PDF 只放純文字，拿掉最常見的標記，避免滿版星號與井號。 */
export function receiptPlainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

function formatLocalTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const optionLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

/** 把作答資料排成一行一行的內容（尚未依紙寬換行）。 */
export function buildReceiptLines(data: QuizReceiptData, f: Format): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const push = (kind: ReceiptLineKind, text = '') => lines.push({ kind, text });
  const unanswered = findUnansweredQuestionNumbers(data.questions, data.answers, data.essayPhotoCounts);
  const total = data.questions.length;

  push('title', f('quiz.receipt.heading'));
  push('meta', f('quiz.receipt.quiz', { title: data.quizTitle }));
  if (data.deckTitle) push('meta', f('quiz.receipt.deck', { title: data.deckTitle }));
  push('meta', data.code ? f('quiz.receipt.code', { code: data.code }) : f('quiz.receipt.codeMissing'));
  if (data.name) push('meta', f('quiz.receipt.name', { name: data.name }));
  if (data.receipt) {
    push('meta', f('quiz.receipt.attemptId', { id: data.receipt.attemptId }));
    const serverTime = new Date(data.receipt.submittedAt);
    push('meta', f('quiz.receipt.submittedAt', {
      time: Number.isNaN(serverTime.getTime()) ? data.receipt.submittedAt : formatLocalTime(serverTime),
    }));
  } else {
    push('warn', f('quiz.receipt.notConfirmed'));
  }
  push('meta', f('quiz.receipt.generatedAt', { time: formatLocalTime(data.generatedAt) }));
  push('meta', f('quiz.receipt.session', { session: data.sessionId }));
  push('meta', f('quiz.receipt.device', { client: data.clientId }));
  push('meta', f('quiz.receipt.answered', { answered: total - unanswered.length, total }));
  if (unanswered.length > 0) push('warn', f('quiz.receipt.unansweredList', { list: unanswered.join('、') }));
  if (data.fingerprint) push('note', f('quiz.receipt.fingerprint', { hash: data.fingerprint }));

  data.questions.forEach((q, idx) => {
    push('gap');
    const type = q.type === 'essay'
      ? f('quiz.receipt.typeEssay')
      : q.type === 'multiple' ? f('quiz.receipt.typeMultiple') : f('quiz.receipt.typeSingle');
    const isUnanswered = unanswered.includes(idx + 1);
    push('heading', `${f('quiz.receipt.questionHeading', { index: idx + 1, type })}${isUnanswered ? ` ${f('quiz.receipt.unanswered')}` : ''}`);
    push('question', receiptPlainText(q.question));
    if (q.type === 'essay') {
      const count = data.essayPhotoCounts[q.id] ?? 0;
      push(count > 0 ? 'chosen' : 'warn', count > 0 ? f('quiz.receipt.essayPhotos', { count }) : f('quiz.receipt.unanswered'));
      (data.essayPhotos?.[q.id] ?? []).forEach((image, pIdx) => {
        lines.push({ kind: 'image', text: f('quiz.receipt.photoUnavailable', { index: pIdx + 1 }), image });
      });
      return;
    }
    const selected = data.answers[q.id] ?? [];
    q.options.forEach((opt, oIdx) => {
      const chosen = selected.includes(oIdx);
      push(chosen ? 'chosen' : 'option', `${chosen ? '[X]' : '[  ]'} ${optionLetter(oIdx)}. ${receiptPlainText(opt.text)}`);
    });
    if (selected.length > 0) {
      push('note', f('quiz.receipt.selected', { list: [...selected].sort((a, b) => a - b).map(optionLetter).join('、') }));
    }
  });
  push('gap');
  push('footer', f('quiz.receipt.footer'));
  return lines;
}

/** 作答內容的指紋：同一份作答一定得到同一個值，老師可拿系統紀錄重算比對。 */
export async function receiptFingerprint(input: {
  quizId: number;
  sessionId: string;
  clientId: string;
  answers: Record<string, readonly number[] | undefined>;
}): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle) return null;
  const sorted = Object.keys(input.answers).sort().map((k) => [k, [...(input.answers[k] ?? [])].sort((a, b) => a - b)]);
  const text = JSON.stringify({ quiz_id: input.quizId, session_id: input.sessionId, client_id: input.clientId, answers: sorted });
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** A4，單位 pt。 */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

export interface JpegPage {
  jpeg: Uint8Array;
  /** 影像像素寬高。 */
  width: number;
  height: number;
}

/** 把每頁一張 JPEG 組成 PDF（每張圖鋪滿一頁 A4）。 */
export function jpegPagesToPdf(pages: readonly JpegPage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;
  const push = (d: Uint8Array | string) => {
    const bytes = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(bytes);
    offset += bytes.length;
  };
  const beginObj = (num: number) => {
    offsets[num] = offset;
    push(`${num} 0 obj\n`);
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // 二進位註解：告訴工具這是二進位檔
  const pageObj = (i: number) => 3 + i * 3;
  const objCount = 2 + pages.length * 3 + 1; // + Info
  const infoObj = objCount;

  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2);
  push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  const w = A4_WIDTH_PT.toFixed(2);
  const h = A4_HEIGHT_PT.toFixed(2);
  pages.forEach((page, i) => {
    const p = pageObj(i);
    beginObj(p);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>\nendobj\n`);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    beginObj(p + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    beginObj(p + 2);
    push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });
  beginObj(infoObj);
  push('<< /Producer (MakeSlide) /Title (Quiz answer receipt) >>\nendobj\n');

  const xrefOffset = offset;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objCount; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** 把一段文字切成可換行的單位：連續英數一組（不在單字中間斷行），中文與其他字元一個一組。 */
export function splitWrapTokens(text: string): string[] {
  return text.match(/[\x21-\x7e]+|\s+|[\s\S]/gu) ?? [];
}

/** 依量測函式把文字斷成不超過 maxWidth 的多行；單一 token 太長時再逐字切。 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    const flush = () => {
      out.push(line.replace(/\s+$/, ''));
      line = '';
    };
    for (const token of splitWrapTokens(para)) {
      if (measure(line + token) <= maxWidth) {
        line += token;
        continue;
      }
      if (/^\s+$/.test(token)) {
        flush();
        continue;
      }
      if (line) flush();
      if (measure(token) <= maxWidth) {
        line = token;
        continue;
      }
      for (const ch of Array.from(token)) {
        if (line && measure(line + ch) > maxWidth) flush();
        line += ch;
      }
    }
    flush();
  }
  return out;
}

// ---- 以下需要瀏覽器 canvas ----

const PAGE_PX_W = 1240; // A4 @ 150dpi
const PAGE_PX_H = 1754;
const MARGIN = 96;
const FONT_FAMILY = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", system-ui, sans-serif';

const STYLE: Record<ReceiptLineKind, { size: number; weight: number; color: string; indent: number; before: number }> = {
  title: { size: 44, weight: 700, color: '#0f172a', indent: 0, before: 0 },
  meta: { size: 24, weight: 400, color: '#1e293b', indent: 0, before: 4 },
  warn: { size: 24, weight: 700, color: '#b91c1c', indent: 0, before: 4 },
  heading: { size: 26, weight: 700, color: '#0f172a', indent: 0, before: 0 },
  question: { size: 26, weight: 400, color: '#0f172a', indent: 0, before: 6 },
  option: { size: 24, weight: 400, color: '#475569', indent: 28, before: 6 },
  chosen: { size: 24, weight: 700, color: '#047857', indent: 28, before: 6 },
  note: { size: 20, weight: 400, color: '#64748b', indent: 0, before: 6 },
  footer: { size: 20, weight: 400, color: '#64748b', indent: 0, before: 0 },
  gap: { size: 18, weight: 400, color: '#000', indent: 0, before: 0 },
  image: { size: 22, weight: 400, color: '#b91c1c', indent: 28, before: 12 },
};

/** 照片在頁面上的最大高度：一頁約可放兩張，又不會小到看不清楚字跡。 */
const IMAGE_MAX_H = 760;

type Drawable = CanvasImageSource & { width: number; height: number };

/** 解碼照片：優先 createImageBitmap（照 EXIF 轉正），不支援時退回 <img>。失敗回 null。 */
async function decodeImage(blob: Blob): Promise<Drawable | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* 退回 <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 照片等比縮放到內容寬度與最大高度內。 */
export function fitImage(width: number, height: number, maxW: number, maxH = IMAGE_MAX_H): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: 0, h: 0 };
  const scale = Math.min(maxW / width, maxH / height, 1.5);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 在 canvas 上逐頁畫出內容並組成 PDF Blob（問答題照片要先解碼，所以是非同步）。 */
export async function renderReceiptPdf(lines: readonly ReceiptLine[], pageLabel: (page: number, total: number) => string): Promise<Blob> {
  type Placed = { kind: ReceiptLineKind; text: string; y: number; image?: Drawable; w?: number; h?: number };
  const decoded = new Map<Blob, Drawable | null>();
  for (const line of lines) {
    if (line.image && !decoded.has(line.image)) decoded.set(line.image, await decodeImage(line.image));
  }
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  if (!mctx) throw new Error('canvas 2d unavailable');
  const font = (k: ReceiptLineKind) => `${STYLE[k].weight} ${STYLE[k].size}px ${FONT_FAMILY}`;

  // 先排版：決定每一行在哪一頁、哪個 y。
  let current: Placed[] = [];
  const pagesLayout: Placed[][] = [current];
  const bottom = PAGE_PX_H - MARGIN - 40; // 留頁碼位置
  let y = MARGIN;
  for (const line of lines) {
    const st = STYLE[line.kind];
    if (line.kind === 'gap') {
      y += st.size;
      continue;
    }
    const drawable = line.image ? decoded.get(line.image) : undefined;
    if (line.kind === 'image' && drawable) {
      const { w, h } = fitImage(drawable.width, drawable.height, PAGE_PX_W - MARGIN * 2 - st.indent);
      y += st.before;
      if (y + h > bottom && current.length > 0) {
        current = [];
        pagesLayout.push(current);
        y = MARGIN;
      }
      current.push({ kind: line.kind, text: '', y, image: drawable, w, h });
      y += h;
      continue;
    }
    mctx.font = font(line.kind);
    const lineHeight = Math.round(st.size * 1.45);
    const wrapped = wrapText(line.text, PAGE_PX_W - MARGIN * 2 - st.indent, (s) => mctx.measureText(s).width);
    y += st.before;
    for (const text of wrapped) {
      if (y + lineHeight > bottom) {
        current = [];
        pagesLayout.push(current);
        y = MARGIN;
      }
      current.push({ kind: line.kind, text, y });
      y += lineHeight;
    }
    if (line.kind === 'title') y += 16;
  }

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_PX_W;
  canvas.height = PAGE_PX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  const jpegs: JpegPage[] = pagesLayout.map((placed, pageIdx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_PX_W, PAGE_PX_H);
    ctx.textBaseline = 'top';
    for (const item of placed) {
      const st = STYLE[item.kind];
      if (item.image) {
        ctx.drawImage(item.image, MARGIN + st.indent, item.y, item.w ?? 0, item.h ?? 0);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(MARGIN + st.indent, item.y, item.w ?? 0, item.h ?? 0);
        continue;
      }
      ctx.font = font(item.kind);
      ctx.fillStyle = st.color;
      ctx.fillText(item.text, MARGIN + st.indent, item.y);
    }
    ctx.font = font('footer');
    ctx.fillStyle = STYLE.footer.color;
    const label = pageLabel(pageIdx + 1, pagesLayout.length);
    ctx.fillText(label, PAGE_PX_W - MARGIN - ctx.measureText(label).width, PAGE_PX_H - MARGIN);
    return { jpeg: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.85)), width: PAGE_PX_W, height: PAGE_PX_H };
  });
  for (const d of decoded.values()) if (d && 'close' in d && typeof d.close === 'function') d.close();
  const bytes = jpegPagesToPdf(jpegs);
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** 檔名：quiz-receipt-<測驗>-<學號>-<時間>.pdf，去掉檔名不允許的字元。 */
export function receiptFilename(quizTitle: string, code: string | null, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return ['quiz-receipt', clean(quizTitle), code ? clean(code) : '', stamp].filter(Boolean).join('-') + '.pdf';
}

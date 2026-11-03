/**
 * Printable quiz papers: the student paper and the teacher's answer key, as A4 PDFs.
 *
 * Rendered by headless Chrome rather than the frontend's canvas receipt because questions carry
 * LaTeX (matrices, display math) that only reads correctly through KaTeX. The HTML builder is pure
 * and carries the one rule that matters: the `paper` variant never contains an answer.
 */
import { escapeHtml, renderMarkdownMathHtml } from './markdownMathHtml';
import { katexCssWithInlineFonts } from './pageElementsDocument';
import { launchHeadlessChrome } from './reactSlideBake';
import { normalizeQuestionScores } from './quizScoring';

export type QuizPaperVariant = 'paper' | 'answers';
export type QuizPaperLang = 'zh-TW' | 'en';

export interface QuizPaperQuestion {
  id: string;
  type: 'single' | 'multiple' | 'essay';
  question: string;
  options: Array<{ text: string }>;
  answer_indices: number[];
  explanation?: string;
  reference_answer?: string;
  score?: number | null;
}

export interface QuizPaperInput {
  quizTitle: string;
  deckTitle: string | null;
  timeLimitSeconds: number;
  questions: QuizPaperQuestion[];
  variant: QuizPaperVariant;
  lang: QuizPaperLang;
}

const LABELS = {
  'zh-TW': {
    answerKey: '解答（教師版，請勿發給學生）',
    count: (n: number) => `共 ${n} 題`,
    minutes: (n: number) => `作答時間 ${n} 分鐘`,
    name: '姓名',
    code: '學號',
    score: '得分',
    meta: (type: 'single' | 'multiple' | 'essay', points: number) =>
      `（${{ single: '單選', multiple: '複選', essay: '問答' }[type]}，${points} 分）`,
    answer: '答案：',
    noAnswer: '未設定',
    explanation: '解析：',
    reference: '參考答案：',
  },
  en: {
    answerKey: 'Answer key (teacher copy, do not hand out)',
    count: (n: number) => `${n} question${n === 1 ? '' : 's'}`,
    minutes: (n: number) => `Time limit: ${n} min`,
    name: 'Name',
    code: 'Student ID',
    score: 'Score',
    meta: (type: 'single' | 'multiple' | 'essay', points: number) =>
      `(${{ single: 'Single choice', multiple: 'Multiple choice', essay: 'Essay' }[type]}, ${points} pts)`,
    answer: 'Answer: ',
    noAnswer: 'not set',
    explanation: 'Explanation: ',
    reference: 'Reference answer: ',
  },
} as const;

const optionLetter = (i: number): string => String.fromCharCode(65 + i);
const round2 = (value: number): number => Math.round(value * 100) / 100;

const PAPER_CSS = `
* { box-sizing: border-box; }
body { margin: 0; color: #000; font: 11pt/1.55 "Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; }
h1 { margin: 0; font-size: 18pt; line-height: 1.3; text-align: center; }
.deck, .info { margin-top: 2pt; text-align: center; font-size: 10pt; }
.key { margin-top: 4pt; text-align: center; font-weight: 700; }
.fields { display: flex; gap: 16pt; margin: 12pt 0 4pt; }
.fields span { flex: 1; border-bottom: 1px solid #000; padding-bottom: 2pt; }
hr { border: 0; border-top: 1px solid #000; margin: 8pt 0 0; }
.q { margin-top: 12pt; }
.variant-paper .q, .q-head { break-inside: avoid; }
.q-head { display: flex; gap: 4pt; }
.q-no { font-weight: 700; flex: none; }
.q-body { flex: 1; min-width: 0; }
.q-meta { font-size: 9pt; }
.md p { margin: 0; }
.md ul, .md ol { margin: 2pt 0; padding-left: 18pt; }
.md h3, .md h4 { margin: 2pt 0; font-size: 11pt; }
.md pre { margin: 2pt 0; white-space: pre-wrap; font-size: 9.5pt; }
.md table { border-collapse: collapse; margin: 2pt 0; }
.md th, .md td { border: 1px solid #000; padding: 1pt 5pt; }
.md-math { margin: 3pt 0; }
.opts { margin-top: 3pt; padding-left: 20pt; }
.opt { display: flex; gap: 5pt; margin-top: 2pt; }
.opt-letter { flex: none; }
.opt-text { flex: 1; min-width: 0; }
.opt.correct { font-weight: 700; }
.blank { height: 5.5cm; margin: 4pt 0 0 20pt; border: 1px solid #000; }
.note { margin: 4pt 0 0 20pt; padding: 3pt 6pt; border-left: 2pt solid #000; font-size: 10pt; }
.note .md { display: inline-block; vertical-align: top; }
`;

function questionHtml(q: QuizPaperQuestion, index: number, points: number, input: QuizPaperInput): string {
  const labels = LABELS[input.lang];
  const showAnswers = input.variant === 'answers';
  const options = q.type === 'essay' ? '' : `<div class="opts">${q.options.map((opt, i) => {
    const correct = showAnswers && q.answer_indices.includes(i);
    return `<div class="opt${correct ? ' correct' : ''}"><span class="opt-letter">${correct ? '✓ ' : ''}(${optionLetter(i)})</span><span class="opt-text">${renderMarkdownMathHtml(opt.text)}</span></div>`;
  }).join('')}</div>`;

  let after = '';
  if (!showAnswers) {
    if (q.type === 'essay') after = '<div class="blank"></div>';
  } else if (q.type === 'essay') {
    if (q.reference_answer) after = `<div class="note"><strong>${labels.reference}</strong>${renderMarkdownMathHtml(q.reference_answer)}</div>`;
  } else {
    const answer = [...q.answer_indices].sort((a, b) => a - b).map(optionLetter).join('、') || labels.noAnswer;
    after = `<div class="note"><strong>${labels.answer}</strong>${escapeHtml(answer)}</div>`;
  }
  if (showAnswers && q.explanation) {
    after += `<div class="note"><strong>${labels.explanation}</strong>${renderMarkdownMathHtml(q.explanation)}</div>`;
  }

  return `<section class="q"><div class="q-head"><span class="q-no">${index + 1}.</span><div class="q-body">`
    + `<div class="q-meta">${escapeHtml(labels.meta(q.type, round2(points)))}</div>${renderMarkdownMathHtml(q.question)}`
    + `</div></div>${options}${after}</section>`;
}

/** Self-contained HTML for one paper. Question text is escaped by renderMarkdownMathHtml. */
export function buildQuizPaperHtml(input: QuizPaperInput): string {
  const labels = LABELS[input.lang];
  const points = normalizeQuestionScores(input.questions);
  const minutes = Math.ceil(input.timeLimitSeconds / 60);
  const info = [labels.count(input.questions.length), ...(minutes > 0 ? [labels.minutes(minutes)] : [])].join('　');
  const fields = input.variant === 'paper'
    ? `<div class="fields"><span>${labels.name}：</span><span>${labels.code}：</span><span>${labels.score}：</span></div>`
    : '';
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><title>${escapeHtml(input.quizTitle)}</title>`
    + `<style>${katexCssWithInlineFonts()}${PAPER_CSS}</style></head><body class="variant-${input.variant}">`
    + `<h1>${escapeHtml(input.quizTitle)}</h1>`
    + (input.deckTitle ? `<div class="deck">${escapeHtml(input.deckTitle)}</div>` : '')
    + `<div class="info">${escapeHtml(info)}</div>`
    + (input.variant === 'answers' ? `<div class="key">${labels.answerKey}</div>` : '')
    + `${fields}<hr>${input.questions.map((q, i) => questionHtml(q, i, points[i] ?? 0, input)).join('')}`
    + `</body></html>`;
}

const PDF_TIMEOUT_MS = 30_000;
const FOOTER = `<div style="width:100%;text-align:center;font-size:9px;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

/** Throws BakeUnavailableError when this deployment has no Chrome. */
export async function renderQuizPaperPdf(html: string): Promise<Buffer> {
  const browser = await launchHeadlessChrome();
  try {
    // The stylesheet and fonts are inlined, so nothing here needs scripts or the network.
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: PDF_TIMEOUT_MS });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER,
      margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

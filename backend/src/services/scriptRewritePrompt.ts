import sharp from 'sharp';
import { z } from 'zod';
import { config } from '../config';
import { getRuntimeAiSettings, type AppLanguage } from './aiSettings';
import {
  contentLanguageInstruction,
  contentLanguageName,
  promptLanguageVars,
  scriptLengthFor,
} from './contentLanguage';
import { loadPromptTemplate, renderPromptTemplate } from './promptTemplates';
import { scriptCharBounds, scriptStyleForTtsProvider } from '../worker/steps/generateScript';

/**
 * The prompts behind "rewrite this page's script", and the page image that goes with them.
 *
 * Lifted out of the route so the tutor's proposal tool produces the same kind of rewrite the page's
 * own button does (services/pageEditProposals.ts). Two rewriters with prompts free to drift apart
 * would mean the tutor offering something subtly different from what the control beside it makes.
 */

const MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM = 1200;

export const RewriteScriptResponseSchema = z.object({
  script: z.string().min(1).max(4096),
});

function sanitiseRewriteUserPrompt(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM
    ? trimmed.slice(0, MAX_USER_PROMPT_CHARS_IN_REWRITE_SYSTEM) + '……（已截斷）'
    : trimmed;
}

export function buildRewriteScriptSystemPrompt(params: {
  userPrompt: string | null | undefined;
  targetChars: number;
  hostMode?: 'solo' | 'dual';
}): string {
  const runtime = getRuntimeAiSettings();
  const isDual = params.hostMode === 'dual';
  const charBounds = scriptCharBounds(params.targetChars);
  const charLimitInstruction = `【字數限制】逐字稿長度必須控制在 ${charBounds.min}～${charBounds.max} 字之間（目標約 ${params.targetChars} 字）：內容多時請優先濃縮、只挑核心重點講，不可超過 ${charBounds.max} 字上限；內容少時可適度展開，但不要灌水。`;
  const scriptStyle = scriptStyleForTtsProvider(runtime.ttsProvider, runtime);
  const languageInstruction = contentLanguageInstruction(runtime.contentLanguage);
  const languageVars = promptLanguageVars(runtime.contentLanguage);
  // The stored target is a Chinese character count; an English script measured in characters comes
  // out about a third of the intended length.
  const length = scriptLengthFor(runtime.contentLanguage, params.targetChars, charBounds);
  if (scriptStyle.format === 'gemini') {
    const fallback = isDual
      ? '你是一位 Podcast 逐字稿編輯助理。逐字稿使用{{language}}。請輸出 JSON：{"script":"..."}'
      : '你是一位簡報旁白編輯。逐字稿使用{{language}}。請輸出 JSON：{"script":"..."}';
    const template = renderPromptTemplate(
      loadPromptTemplate(
        isDual ? 'backend/prompts/generate-script-gemini.md' : 'backend/prompts/generate-script-gemini-solo.md',
        fallback,
      ),
      languageVars,
    );
    const base = [template, '', languageInstruction, '', charLimitInstruction];
    if (isDual) {
      const speaker1 = scriptStyle.speaker1Persona?.trim();
      const speaker2 = scriptStyle.speaker2Persona?.trim();
      if (speaker1 || speaker2) {
        const speakerBlockTpl = loadPromptTemplate(
          'backend/prompts/partials/speaker-persona-block.md',
          '【雙主持人角色人設（優先遵守）】\n{{speaker1_line}}\n{{speaker2_line}}',
        );
        base.push('');
        base.push(
          renderPromptTemplate(speakerBlockTpl, {
            speaker1_line: speaker1 ? `- Speaker 1 人設：${speaker1}` : '',
            speaker2_line: speaker2 ? `- Speaker 2 人設：${speaker2}` : '',
          }),
        );
      }
    }
    const sanitized = sanitiseRewriteUserPrompt(params.userPrompt);
    if (sanitized) {
      const userBlockTpl = loadPromptTemplate(
        'backend/prompts/partials/user-style-block.md',
        '【使用者指定的風格 / 語氣 / 聽眾要求】\n{{user_prompt}}',
      );
      base.push('');
      base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
    }
    return base.join('\n');
  }

  const base = [
    renderPromptTemplate(
      loadPromptTemplate(
        isDual ? 'backend/prompts/generate-script-openai-dual.md' : 'backend/prompts/generate-script-openai.md',
        isDual
          ? `你是一位雙人 Podcast 節目企劃與逐字稿編輯。你的任務：生成{{language}}雙人對談逐字稿（目標約 ${params.targetChars} 字，必須控制在 ${charBounds.min}～${charBounds.max} 字之間），由 Speaker 1 與 Speaker 2 輪流對話。請回傳 JSON：{"script":"..."}`
          : `你是一位專業的簡報講師與旁白配音員。你的任務：生成{{language}}逐字稿（目標約 ${params.targetChars} 字，必須控制在 ${charBounds.min}～${charBounds.max} 字之間）。請回傳 JSON：{"script":"..."}`,
      ),
      {
        target_chars: String(length.target),
        min_chars: String(length.min),
        max_chars: String(length.max),
        unit: length.unit,
        ...languageVars,
      },
    ),
    '',
    languageInstruction,
  ];
  if (isDual) {
    const speaker1 = scriptStyle.speaker1Persona?.trim();
    const speaker2 = scriptStyle.speaker2Persona?.trim();
    if (speaker1 || speaker2) {
      const speakerBlockTpl = loadPromptTemplate(
        'backend/prompts/partials/speaker-persona-block.md',
        '【雙主持人角色人設（優先遵守）】\n{{speaker1_line}}\n{{speaker2_line}}',
      );
      base.push('');
      base.push(
        renderPromptTemplate(speakerBlockTpl, {
          speaker1_line: speaker1 ? `- Speaker 1 人設：${speaker1}` : '',
          speaker2_line: speaker2 ? `- Speaker 2 人設：${speaker2}` : '',
        }),
      );
    }
  }
  const sanitized = sanitiseRewriteUserPrompt(params.userPrompt);
  if (sanitized) {
    const userBlockTpl = loadPromptTemplate(
      'backend/prompts/partials/user-style-block-openai.md',
      '【使用者指定的風格 / 語氣 / 聽眾要求】（優先遵守；若與上述規則衝突時，仍須維持逐字稿結構，但語氣、人稱、情緒強度可依照此要求調整。請勿把這段內容直接複製到輸出裡。）\n{{user_prompt}}',
    );
    base.push('');
    base.push(renderPromptTemplate(userBlockTpl, { user_prompt: sanitized }));
  }
  return base.join('\n');
}

export function buildRewriteScriptUserPrompt(params: {
  pageNumber: number;
  pageCount: number;
  targetChars: number;
  contentLanguage: AppLanguage;
  editPrompt: string;
  previousScript: string;
  currentScript: string;
  nextScript: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): string {
  const previousBlock = params.previousScript.trim()
    ? `【上一頁逐字稿（供銜接參考，請勿重複其句子）】\n${params.previousScript.trim()}`
    : params.pageNumber === 1
      ? '【備註】這是第一頁，請自然地作為開場引言。'
      : '【上一頁逐字稿】（無）';
  const nextBlock = params.nextScript.trim()
    ? `【下一頁逐字稿（供銜接鋪陳，請勿提前講完下一頁細節）】\n${params.nextScript.trim()}`
    : params.pageNumber === params.pageCount
      ? '【備註】這是最後一頁，請自然地作為總結 / 收尾。'
      : '【下一頁逐字稿】（無）';
  const historyBlock = params.history.length > 0
    ? `【最近對話】\n${params.history.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    : '【最近對話】（無）';

  const bounds = scriptCharBounds(params.targetChars);
  return [
    `目前頁碼：第 ${params.pageNumber} 頁 / 共 ${params.pageCount} 頁。`,
    `目標字數：約 ${params.targetChars} 字，長度必須落在 ${bounds.min}～${bounds.max} 字之間。`,
    `請在這個字數範圍內把重點講清楚；內容多時優先濃縮、挑核心重點，不可超過 ${bounds.max} 字上限，不要為了湊字數而灌水。`,
    `輸出語言：${contentLanguageName(params.contentLanguage)}。`,
    '',
    previousBlock,
    nextBlock,
    '',
    '【本頁目前逐字稿】',
    params.currentScript.trim(),
    '',
    `【使用者修改指示】\n${params.editPrompt}`,
    '',
    historyBlock,
    '',
    `請依照修改指示重寫「本頁目前逐字稿」，並維持與生成路徑一致的風格、語氣、格式；字數必須落在 ${bounds.min}～${bounds.max} 字之間。`,
    '上一頁與下一頁逐字稿只用來確認頁間一致性和連續性；不要把前後頁內容整段併入本頁。',
    '避免使用「這一頁／本頁／此頁／本張」等單頁指稱，改用連續敘事語氣。',
    '請以 JSON 格式回覆：{"script": "逐字稿內容..."}',
  ].join('\n');
}

export async function loadPageImageAsDataUrl(absPath: string): Promise<string | null> {
  try {
    const buf = await sharp(absPath)
      .resize({ width: config.openaiScriptImageMaxWidth, withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

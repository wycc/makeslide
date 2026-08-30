import type { AppLanguage } from './aiSettings';
import { imageTextLanguageRule } from './contentLanguage';

export interface ImagePromptTemplate {
  key:
    | 'academic_minimalist'
    | 'technology_blueprint'
    | 'medical_textbook'
    | 'storybook_education'
    | 'isometric_3d_infographic'
    | 'ghibli_anime'
    | 'anime_cel_shading'
    | 'makoto_shinkai'
    | 'claymation_3d'
    | 'isometric_vibrant'
    | 'lego_bricks'
    | 'watercolor_pastel'
    | 'oil_painting_impasto'
    | 'cyberpunk_neon';
  label: string;
  description: string;
  prompt_en: string;
  prompt_zh: string;
}

export const IMAGE_PROMPT_TEMPLATES: ImagePromptTemplate[] = [
  {
    key: 'academic_minimalist',
    label: '學術簡約風',
    description: '課程簡報、研究計畫、論文概念圖、醫學/工程主題',
    prompt_en:
      'academic minimalist style, clean layout, soft neutral background, precise visual hierarchy, elegant vector illustration, professional presentation design, subtle gradients, no clutter, high readability',
    prompt_zh:
      '學術簡約風格，乾淨版面，柔和中性色背景，清楚的視覺層次，精緻向量插圖，專業簡報設計，低干擾、高可讀性',
  },
  {
    key: 'technology_blueprint',
    label: '科技藍圖風',
    description: 'AI 系統架構、資料流程、模型訓練流程、雲端平台',
    prompt_en:
      'futuristic technology blueprint style, deep blue background, glowing lines, data flow diagrams, modular system blocks, clean technical illustration, cybernetic aesthetic, professional AI presentation',
    prompt_zh:
      '未來科技藍圖風，深藍色背景，發光線條，資料流示意，模組化系統區塊，乾淨技術插圖，適合 AI 與系統架構簡報',
  },
  {
    key: 'medical_textbook',
    label: '醫學教科書插畫風',
    description: '醫學 AI、臨床流程、醫學影像、醫療場景、生命科學',
    prompt_en:
      'medical textbook illustration style, clean anatomical and clinical visuals, soft colors, educational diagram, precise labeling areas, calm professional tone, suitable for medical school presentation',
    prompt_zh:
      '醫學教科書插畫風，乾淨的解剖與臨床視覺，柔和配色，教育型圖解，標註空間清楚，專業而沉穩，適合醫學院簡報',
  },
  {
    key: 'storybook_education',
    label: '繪本式教學風',
    description: '把抽象概念講得親切，適合教學投影片配圖',
    prompt_en:
      'storybook educational illustration style, warm pastel colors, friendly characters, simple symbolic objects, gentle lighting, clear metaphorical composition, suitable for teaching complex ideas',
    prompt_zh:
      '繪本式教學插畫風，溫暖粉彩色，友善角色，簡單象徵物件，柔和光線，用隱喻方式呈現抽象概念，適合教學簡報',
  },
  {
    key: 'isometric_3d_infographic',
    label: '3D 等距資訊圖風',
    description: '平台首頁 hero image、系統流程、AI pipeline、資料中心',
    prompt_en:
      'isometric 3D infographic style, clean geometric shapes, modern UI elements, layered workflow, soft shadows, pastel color palette, professional technology presentation, high-level system overview',
    prompt_zh:
      '3D 等距資訊圖風，乾淨幾何造型，現代 UI 元素，分層工作流程，柔和陰影，粉彩科技配色，適合系統總覽與平台簡報',
  },
  {
    key: 'ghibli_anime',
    label: '吉卜力動漫風',
    description: '卡通敘事、角色導向、溫暖幻想感場景',
    prompt_en: 'Studio Ghibli style, Hayao Miyazaki, anime art style',
    prompt_zh: '吉卜力動畫風格，宮崎駿感，日系動漫插畫風',
  },
  {
    key: 'anime_cel_shading',
    label: '日系賽璐璐風',
    description: '二次元人物、清晰輪廓、平塗光影',
    prompt_en: 'Anime cel shading, Japanese illustration',
    prompt_zh: '日系賽璐璐上色，清楚線條與平塗陰影的日本插畫風',
  },
  {
    key: 'makoto_shinkai',
    label: '新海誠電影風',
    description: '高細節天空、光影戲劇性、電影感構圖',
    prompt_en: 'Makoto Shinkai style, highly detailed, beautiful sky, cinematic lighting',
    prompt_zh: '新海誠風格，高細節、絕美天空、電影級光影',
  },
  {
    key: 'claymation_3d',
    label: '3D 黏土質感風',
    description: '可愛角色、柔光、可觸感材質',
    prompt_en: '3D clay rendering, cute, soft lighting, tactile texture',
    prompt_zh: '3D 黏土渲染，可愛造型，柔和打光，具觸感紋理',
  },
  {
    key: 'isometric_vibrant',
    label: '3D 等角鮮明風',
    description: '等角視角、亮彩色塊、乾淨背景',
    prompt_en: '3D isometric illustration, vibrant colors, clean background',
    prompt_zh: '3D 等角插畫，鮮明色彩，背景乾淨俐落',
  },
  {
    key: 'lego_bricks',
    label: '樂高積木風',
    description: '積木造型、拼裝感、玩具質地',
    prompt_en: 'Made of lego bricks, highly detailed',
    prompt_zh: '由樂高積木構成，高細節拼裝風格',
  },
  {
    key: 'watercolor_pastel',
    label: '水彩粉彩風',
    description: '柔和筆觸、淡雅色彩、手繪感',
    prompt_en: 'Watercolor illustration, soft brush strokes, pastel colors',
    prompt_zh: '水彩插畫，柔和筆觸，粉彩色調',
  },
  {
    key: 'oil_painting_impasto',
    label: '厚塗油畫風',
    description: '厚重筆觸、經典畫布感、藝術性強',
    prompt_en: 'Impasto oil painting, thick brush strokes, classic art',
    prompt_zh: '厚塗油畫風，粗厚筆觸，經典藝術質感',
  },
  {
    key: 'cyberpunk_neon',
    label: '賽博龐克霓虹風',
    description: '未來城市、霓虹燈光、暗色氛圍',
    prompt_en: 'Cyberpunk style, neon lights, futuristic, dark atmosphere',
    prompt_zh: '賽博龐克風格，霓虹光效，未來感，暗色氛圍',
  },
];

export const IMAGE_PROMPT_GENERAL_RULES = [
  '請產生一張 16:9 的現代知識型簡報頁，視覺風格接近 NotebookLM（資訊圖卡、清楚層級、留白充足）。',
  '不要在圖片中加入任何 Slide 編號（例如 Slide 1、第 1 頁、Page 1）。',
];

/**
 * 圖片生成 prompt 的字元上限。實際上限由影像模型決定（實測 OpenAI 影像端點是
 * 32000 字元，超過就是一個 400），這裡取得更保守，替呼叫端在本函式之後附加的
 * 文字（例如 renderTextPagesWithLlm 的 `[Context]` 區塊）留餘裕。
 */
export const IMAGE_PROMPT_MAX_CHARS = 28_000;

/**
 * 單一引用區塊的字元上限。一頁投影片的文字正常只有一兩百字，會撞到這個上限
 * 的都是異常資料——一篇論文曾因分頁誤判讓單頁吞下 51k 字元，整份簡報因此被
 * 一個 400 打掉，儘管前面幾頁的圖都已經產好了。截斷讓那一頁畫得比較泛泛，
 * 但簡報還在。
 */
const QUOTED_SECTION_MAX_CHARS = 6_000;

/** 截到 `maxChars`，並告訴模型後面還有內容——免得它以為原文就在這裡結束。 */
function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}\n（內容過長，其餘已省略）`;
}

export function buildImagePrompt(params: {
  stylePrompt?: string | null;
  deckAdjustmentPrompt?: string | null;
  pageText?: string | null;
  pageScript?: string | null;
  userAdjustmentPrompt?: string | null;
  slideLabel?: string | null;
  figureNotes?: string | null;
  textBody?: string | null;
  /**
   * Which language the words drawn on the slide are in. Defaults to the Chinese the prompt itself
   * is written in, so callers that have no runtime settings to read keep their old behaviour.
   */
  contentLanguage?: AppLanguage;
}): string {
  const lines: string[] = [...IMAGE_PROMPT_GENERAL_RULES];
  // Early, and before the page text it applies to: the rest of this prompt — and the material
  // quoted into it — is Chinese, which is what the model would otherwise copy onto the slide.
  lines.push(imageTextLanguageRule(params.contentLanguage ?? 'zh-TW'));
  if (params.stylePrompt?.trim()) {
    lines.push(`生圖風格模板：${params.stylePrompt.trim()}`);
  }
  if (params.deckAdjustmentPrompt?.trim()) {
    lines.push('請保持全份簡報視覺風格一致。');
    lines.push(`整份調整需求：\n${truncateForPrompt(params.deckAdjustmentPrompt.trim(), QUOTED_SECTION_MAX_CHARS)}`);
  }
  if (params.userAdjustmentPrompt?.trim()) {
    lines.push(`使用者修改需求：\n${truncateForPrompt(params.userAdjustmentPrompt.trim(), QUOTED_SECTION_MAX_CHARS)}`);
  }
  if (params.slideLabel?.trim()) {
    lines.push(`頁面標記：${params.slideLabel.trim()}。請依該頁主題做視覺化總結。`);
  }
  if (params.pageText !== undefined) {
    lines.push(
      `頁面文字內容（參考）：\n${truncateForPrompt((params.pageText ?? '').trim(), QUOTED_SECTION_MAX_CHARS) || '(無)'}`,
    );
  }
  if (params.pageScript !== undefined) {
    lines.push(
      `頁面逐字稿（參考）：\n${truncateForPrompt((params.pageScript ?? '').trim(), QUOTED_SECTION_MAX_CHARS) || '(無)'}`,
    );
  }
  if (params.figureNotes?.trim()) {
    lines.push(truncateForPrompt(params.figureNotes.trim(), QUOTED_SECTION_MAX_CHARS));
  }
  if (params.textBody?.trim()) {
    lines.push(truncateForPrompt(params.textBody.trim(), QUOTED_SECTION_MAX_CHARS));
  }
  // Per-section caps keep any single quoted block sane; this is the hard
  // guarantee that the whole prompt stays under the model's limit no matter how
  // many sections a caller filled in.
  return truncateForPrompt(lines.join('\n\n'), IMAGE_PROMPT_MAX_CHARS);
}

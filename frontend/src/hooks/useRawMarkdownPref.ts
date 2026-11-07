import { useCallback, useState } from 'react';

/**
 * 「原始格式」選項（AI tutor 問答面板、課後練習視窗共用）：開啟時 AI 寫的內容不經 Markdown／LaTeX
 * 排版、原文照輸出，排版出錯時看得到模型實際寫了什麼，也方便整段複製。兩處共用同一個設定，
 * 記在這台裝置上——會切到原始格式的人通常是想一直看原文，不該在每個面板各切一次。
 */
export const RAW_MARKDOWN_STORAGE_KEY = 'makeslide:tutorQuiz:rawMarkdown';

function readPref(): boolean {
  try {
    return window.localStorage.getItem(RAW_MARKDOWN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePref(value: boolean): void {
  try {
    window.localStorage.setItem(RAW_MARKDOWN_STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* 私密模式等無法儲存時只是不記住，不影響切換 */
  }
}

export function useRawMarkdownPref(): [boolean, () => void] {
  const [raw, setRaw] = useState(readPref);
  const toggle = useCallback(() => {
    setRaw((prev) => {
      writePref(!prev);
      return !prev;
    });
  }, []);
  return [raw, toggle];
}

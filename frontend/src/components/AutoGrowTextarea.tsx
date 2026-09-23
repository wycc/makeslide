import { useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

export type AutoGrowTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  /** 最少顯示幾列（內容更短時也不會縮得比這個小）。 */
  minRows?: number;
};

/**
 * 高度跟著內容長的 textarea：內容永遠整份看得見，不必捲動，也不會因為固定 rows 而被切掉。
 * 每次 value 變動就把高度重設為 scrollHeight（先歸零再量，否則縮短內容時量到的是舊高度）。
 */
export function AutoGrowTextarea({ minRows = 2, value, className, ...rest }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    const padding = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.max(el.scrollHeight, minRows * lineHeight + padding)}px`;
  }, [value, minRows]);

  return <textarea ref={ref} value={value} className={`resize-none overflow-hidden ${className ?? ''}`} {...rest} />;
}

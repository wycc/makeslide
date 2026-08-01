import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScriptMaxCharsInput } from '../lib/scriptMaxChars';

export interface ScriptMaxCharsInput {
  /** 輸入框要顯示的文字 — 一律是使用者打的原文，不會被改寫。 */
  raw: string;
  /** 輸入框的 onChange 用；文字合法時才把新值往外送。 */
  onRawChange: (next: string) => void;
  /** 目前文字解析出的值；空白或不合法時為 null。 */
  value: number | null;
  /** true 表示文字不可用，該以紅色提示並停用送出。 */
  invalid: boolean;
}

/**
 * 「每頁字數上限」輸入框的受控狀態：保留使用者打的原文，只在文字合法時
 * 才呼叫 `onValidChange` 更新外部狀態。
 *
 * 先前三個對話框都是邊打邊夾範圍（打「8」立刻變成 80），使用者無法從頭輸入
 * 想要的數字。這裡改成不動使用者的文字：不合法時外部值維持不變，由畫面標紅
 * 讓使用者自己更正。
 *
 * @param externalValue 外部目前的值（null＝未設定／系統預設）
 * @param onValidChange 文字合法時回報新值
 * @param opts.allowBlank 是否接受留空（＝交給系統預設）。預設接受；重新生成／初次
 *   設定那類一定要有值的欄位傳 false，留空就視為不合法。
 */
export function useScriptMaxCharsInput(
  externalValue: number | null,
  onValidChange: (value: number | null) => void,
  opts: { allowBlank?: boolean } = {},
): ScriptMaxCharsInput {
  const allowBlank = opts.allowBlank ?? true;
  const [raw, setRaw] = useState(() => (externalValue == null ? '' : String(externalValue)));
  const rawRef = useRef(raw);
  rawRef.current = raw;

  // 外部值被別處改掉（例如開啟對話框時重設）就同步回輸入框。使用者打到一半的
  // 不合法文字不會被這裡蓋掉：那種情況外部值根本沒變，effect 不會重跑；而合法
  // 文字解析後等於外部值時也刻意不覆寫，才不會把「0080」硬改成「80」。
  useEffect(() => {
    if (parseScriptMaxCharsInput(rawRef.current).value === externalValue) return;
    setRaw(externalValue == null ? '' : String(externalValue));
  }, [externalValue]);

  const onRawChange = useCallback(
    (next: string) => {
      setRaw(next);
      const parsed = parseScriptMaxCharsInput(next);
      if (parsed.invalid || (!allowBlank && parsed.value === null)) return;
      onValidChange(parsed.value);
    },
    [allowBlank, onValidChange],
  );

  const parsed = parseScriptMaxCharsInput(raw);
  return {
    raw,
    onRawChange,
    value: parsed.value,
    invalid: parsed.invalid || (!allowBlank && parsed.value === null),
  };
}

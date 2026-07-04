// 簡易 email 格式檢查（共用純函式）。
// 去重自 `AccessControlPanel`／`GroupsManager` 各自定義的 `EMAIL_RE`。規則刻意寬鬆——
// 非空白/非 @ 的本地部分 + `@` + 網域 + `.` + TLD，僅擋明顯無效的輸入，實際有效性由後端把關。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

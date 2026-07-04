// Jupyter Notebook 唯讀渲染（第一步 b：渲染元件）。
//
// 以 `parseNotebook` 產出的正規化模型（cells）唯讀呈現一個 .ipynb：markdown cell 走既有
// 的 `MarkdownMath`（標題／粗體／條列／表格／LaTeX），code cell 以等寬區塊顯示原始碼，
// outputs 依 text／image／error 三類呈現。不含「執行代碼」（列為後續獨立項目），也尚未
// 定義「.ipynb 如何成為一個頁面」的載入/儲存接線（步驟 c）。

import { MarkdownMath } from './MarkdownMath';
import type { NotebookOutput, ParsedNotebook } from '../lib/notebook';

function OutputBlock({ output }: { output: NotebookOutput }) {
  if (output.kind === 'image') {
    return (
      <img
        src={`data:${output.mimeType};base64,${output.dataBase64}`}
        alt=""
        className="max-w-full rounded border border-border"
      />
    );
  }
  if (output.kind === 'error') {
    return (
      <pre className="overflow-x-auto rounded bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
        <span className="font-semibold">{[output.ename, output.evalue].filter(Boolean).join(': ')}</span>
        {output.traceback ? `\n${output.traceback}` : ''}
      </pre>
    );
  }
  return (
    <pre className="overflow-x-auto rounded bg-surface-muted px-3 py-2 text-xs text-text">{output.text}</pre>
  );
}

export function NotebookView({ notebook, className }: { notebook: ParsedNotebook; className?: string }) {
  if (notebook.cells.length === 0) {
    return null;
  }
  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      {notebook.cells.map((cell, i) => {
        if (cell.type === 'markdown') {
          return <MarkdownMath key={i} content={cell.source} />;
        }
        // code / raw：以等寬區塊顯示原始碼；code cell 額外呈現 outputs。
        return (
          <div key={i} className="flex flex-col gap-1.5">
            {cell.source.trim() !== '' && (
              <pre className="overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-text">
                <code>{cell.source}</code>
              </pre>
            )}
            {cell.outputs.map((output, j) => (
              <OutputBlock key={j} output={output} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

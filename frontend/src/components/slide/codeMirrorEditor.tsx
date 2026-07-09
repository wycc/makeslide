// Heavy CodeMirror editor for notebook code cells (Jupyter phase 3b). Imported lazily by
// NotebookPanel (React.lazy) so CodeMirror + the Python language mode are code-split into their
// own chunk and never enter the main bundle — only editors of a notebook page pay for it.
//
// The notebook panel lives inside the always-dark play stage (slate-950), and the non-editing
// source is shown as a dark code block, so the editor uses CodeMirror's built-in dark theme
// unconditionally. That keeps proper syntax highlighting and a consistent dark look whether the
// surrounding app is in light or dark mode (avoids the pale-text-on-light-surface mismatch).
//
// Keyboard: we deliberately do NOT bind Ctrl/⌘+Enter, Shift+Enter, or Escape here. CodeMirror
// leaves those unbound, so they bubble up to NotebookPanel's container onKeyDown which owns the
// run / commit-edit model. Plain Enter / arrows stay inside the editor as usual.

import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

export default function CodeMirrorEditor({ value, onChange, autoFocus }: CodeMirrorEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      theme="dark"
      extensions={[python(), EditorView.lineWrapping]}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
        highlightActiveLineGutter: true,
      }}
      className="rounded-md border border-sky-500/50 overflow-hidden text-xs"
    />
  );
}

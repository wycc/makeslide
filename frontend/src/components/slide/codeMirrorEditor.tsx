// Heavy CodeMirror editor for notebook code cells (Jupyter phase 3b). Imported lazily by
// NotebookPanel (React.lazy) so CodeMirror + the Python language mode are code-split into their
// own chunk and never enter the main bundle — only editors of a notebook page pay for it.
//
// Keyboard: we deliberately do NOT bind Ctrl/⌘+Enter, Shift+Enter, or Escape here. CodeMirror
// leaves those unbound, so they bubble up to NotebookPanel's container onKeyDown which owns the
// run / commit-edit model. Plain Enter / arrows stay inside the editor as usual.

import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Cell font size in px; keeps the editor in step with the adjustable cell text size. */
  fontSize?: number;
}

/** Track the app's Tailwind `class` dark mode (html.dark) so the editor theme matches. */
function useHtmlDarkClass(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function CodeMirrorEditor({ value, onChange, autoFocus, fontSize }: CodeMirrorEditorProps) {
  const dark = useHtmlDarkClass();
  const extensions = useMemo(
    () => [
      python(),
      EditorView.lineWrapping,
      EditorView.theme({ '&': { fontSize: `${fontSize ?? 13}px` } }),
    ],
    [fontSize],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
        highlightActiveLineGutter: true,
      }}
      className="rounded-md border border-sky-500/50 overflow-hidden"
    />
  );
}

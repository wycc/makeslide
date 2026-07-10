// Builds the sandboxed document for a notebook `text/html` output (phase 2b).
//
// Notebook HTML outputs (pandas tables, plotly, repr HTML, …) can contain arbitrary markup
// and scripts, so they are rendered inside an `<iframe sandbox="allow-scripts">` with NO
// `allow-same-origin` — the frame runs in an opaque origin and cannot touch the parent page,
// its cookies, or storage (same isolation the custom-script animation sandbox uses). The
// embedded script only measures its own height and postMessage's it to the parent so the
// iframe can be sized to its content. Pure/string-only so it can be unit-tested.

/** postMessage payload type the parent listens for to auto-size the iframe. */
export const NOTEBOOK_HTML_HEIGHT_MESSAGE = 'makeslide:nb-html-height';

/**
 * Wrap a notebook HTML output fragment in a minimal, theme-neutral document that reports its
 * content height to the parent. The fragment is embedded verbatim (the sandbox — not escaping —
 * is what contains it).
 */
export function buildNotebookHtmlSrcDoc(html: string, dark = false): string {
  // The frame is transparent, so its text/borders must contrast with the panel surface showing
  // through: a dark surface wants light text, a light surface wants dark text. (A fixed light text
  // made pandas tables near-invisible on the light-mode white surface.)
  const text = dark ? '#e2e8f0' : '#1e293b';
  const border = dark ? '#334155' : '#cbd5e1';
  const headBg = dark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.05)';
  const link = dark ? '#38bdf8' : '#0284c7';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;color:inherit;
    font:12px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;}
  body{padding:2px 0;overflow:hidden;color:${text};}
  table{border-collapse:collapse;} th,td{border:1px solid ${border};padding:2px 6px;} th{background:${headBg};}
  a{color:${link};} img{max-width:100%;}
</style>
</head>
<body>
<div id="nb-root">${html}</div>
<script>
(function(){
  function report(){
    var h = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    parent.postMessage({ type: ${JSON.stringify(NOTEBOOK_HTML_HEIGHT_MESSAGE)}, height: h }, '*');
  }
  window.addEventListener('load', report);
  window.addEventListener('resize', report);
  if (typeof ResizeObserver !== 'undefined') {
    try { new ResizeObserver(report).observe(document.body); } catch (e) {}
  }
  setTimeout(report, 50);
})();
</script>
</body>
</html>`;
}

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
export function buildNotebookHtmlSrcDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent;color:inherit;
    font:12px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;}
  body{padding:2px 0;overflow:hidden;color:#e2e8f0;}
  table{border-collapse:collapse;} th,td{border:1px solid #334155;padding:2px 6px;}
  a{color:#38bdf8;} img{max-width:100%;}
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

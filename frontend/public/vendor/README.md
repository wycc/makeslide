# Vendored React UMD builds

`react.production.min.js` / `react-dom.production.min.js` are copied verbatim from
`node_modules/react/umd/` and `node_modules/react-dom/umd/` (React 18.3.1).

They are served from our own origin so a React slide page (`render_type = 'react'`,
see `docs/react-slide-design.md`) can load React inside its sandboxed iframe. The
sandbox has no `allow-same-origin`, so it cannot reach the app's own module bundle —
and pulling React from a CDN would break every offline / air-gapped deployment.

To update after bumping React:

```sh
cp node_modules/react/umd/react.production.min.js \
   node_modules/react-dom/umd/react-dom.production.min.js \
   frontend/public/vendor/
```

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { applyThemePreference, watchSystemThemeChange } from './lib/theme';
import 'katex/dist/katex.min.css';
import './index.css';

// The inline script in index.html already applied the stored theme before first
// paint; re-apply here so the result stays consistent if the bundle's theme
// logic ever diverges, and keep following OS changes while in `system` mode.
applyThemePreference();
watchSystemThemeChange();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ImportTextPage from './pages/ImportTextPage';
import PlayPage from './pages/PlayPage';
import SettingsPage from './pages/SettingsPage';
import SystemDataPage from './pages/SystemDataPage';
import { useEffect, useState } from 'react';
import { getAuthStatus, getOpenAIKeyStatus } from './lib/api';
import { useLocation, useNavigate } from 'react-router-dom';
import CreditExhaustedDialog from './components/CreditExhaustedDialog';

const PUBLIC_AUTH_PATHS = new Set(['/settings']);

function hasShareToken(search: string): boolean {
  const token = new URLSearchParams(search).get('share');
  return Boolean(token && token.trim());
}

export default function App() {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const auth = await getAuthStatus();
        if (!alive) return;
        const sharedAccess = hasShareToken(location.search);
        if (auth.google_enabled && !auth.authenticated && !PUBLIC_AUTH_PATHS.has(location.pathname) && !sharedAccess) {
          navigate('/settings', { replace: true });
          return;
        }

        const status = await getOpenAIKeyStatus();
        if (!alive) return;
        if (!status.has_key && location.pathname !== '/settings' && !sharedAccess) {
          navigate('/settings', { replace: true });
        }
      } finally {
        if (alive) setChecked(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [location.pathname, location.search, navigate]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <p className="text-sm text-slate-400">載入設定中…</p>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/import-text" element={<ImportTextPage />} />
        <Route path="/play/:id" element={<PlayPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/system" element={<SystemDataPage />} />
        <Route
          path="*"
          element={
            <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
              <p>404 Not Found</p>
            </div>
          }
        />
      </Routes>
      <CreditExhaustedDialog />
    </>
  );
}

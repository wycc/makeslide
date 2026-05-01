import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ImportTextPage from './pages/ImportTextPage';
import PlayPage from './pages/PlayPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/import-text" element={<ImportTextPage />} />
      <Route path="/play/:id" element={<PlayPage />} />
      <Route
        path="*"
        element={
          <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
            <p>404 Not Found</p>
          </div>
        }
      />
    </Routes>
  );
}

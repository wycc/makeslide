// Must be set before any backend imports so pino-pretty transport is skipped
process.env.NODE_ENV ??= 'production';

import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Required for environments with strict security policies (AppLocker, etc.)
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let mainWindow: BrowserWindow | null = null;
let serverPort = 3000;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MakeSlide',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  void mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function startBackend(): Promise<number> {
  // In the packaged app, the backend is at resources/app/backend/dist/server.js.
  // In development, __dirname is electron/ so go up one level.
  // Use the esbuild CJS bundle (.cjs so Electron's asar-patched require() resolves
  // native addons in app.asar.unpacked; ESM import() would bypass that patch).
  const serverPath = path.join(__dirname, '..', 'backend', 'dist', 'server.bundle.cjs');
  // On Windows, path.join() produces "C:\..." which is not a valid ESM URL scheme.
  // pathToFileURL converts it to "file:///C:/..." before dynamic import().
  const serverUrl = pathToFileURL(serverPath).href;
  const { startServer } = await import(serverUrl) as { startServer: () => Promise<number> };
  return startServer();
}

app.whenReady().then(async () => {
  try {
    serverPort = await startBackend();
  } catch (err) {
    console.error('Failed to start backend server:', err);
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

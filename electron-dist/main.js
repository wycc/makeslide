import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let serverPort = 3000;
function createWindow() {
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
async function startBackend() {
    // In the packaged app, the backend is at resources/app/backend/dist/server.js.
    // In development, __dirname is electron/ so go up one level.
    const serverPath = path.join(__dirname, '..', 'backend', 'dist', 'server.js');
    const { startServer } = await import(serverPath);
    return startServer();
}
app.whenReady().then(async () => {
    try {
        serverPort = await startBackend();
    }
    catch (err) {
        console.error('Failed to start backend server:', err);
        app.quit();
        return;
    }
    createWindow();
    app.on('activate', () => {
        if (mainWindow === null)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});

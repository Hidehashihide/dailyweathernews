/**
 * Electron main process (Windows / macOS / Linux desktop build).
 *
 * Security posture, all of it deliberate:
 *   - contextIsolation on, nodeIntegration off, sandbox on. The renderer is
 *     untrusted; it only reaches the disk through the narrow preload bridge.
 *   - A Content-Security-Policy header is injected for the app:// content.
 *   - Every attempt to open a new window or navigate off-origin is refused.
 *
 * Saves live in app.getPath('userData') as plain JSON, written atomically
 * (temp file + rename) so a crash mid-write cannot leave a truncated save.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const DIST = path.join(__dirname, '..', 'dist');
const SAVE_DIR = path.join(app.getPath('userData'), 'saves');

/** Save keys are filenames; refuse anything that could escape SAVE_DIR. */
function safeKey(key) {
  if (typeof key !== 'string' || key === '') return null;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) return null;
  if (key === '.' || key === '..') return null;
  return key;
}

function savePath(key) {
  return path.join(SAVE_DIR, `${key}.json`);
}

async function ensureSaveDir() {
  await fs.mkdir(SAVE_DIR, { recursive: true });
}

ipcMain.handle('save:read', async (_event, key) => {
  const safe = safeKey(key);
  if (!safe) throw new Error('invalid save key');
  try {
    return await fs.readFile(savePath(safe), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
});

ipcMain.handle('save:write', async (_event, key, value) => {
  const safe = safeKey(key);
  if (!safe) throw new Error('invalid save key');
  if (typeof value !== 'string') throw new Error('save payload must be a string');
  await ensureSaveDir();
  // Atomic replace: a crash leaves either the old file or the new one, never
  // a half-written one.
  const target = savePath(safe);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, value, 'utf8');
  await fs.rename(temp, target);
});

ipcMain.handle('save:remove', async (_event, key) => {
  const safe = safeKey(key);
  if (!safe) throw new Error('invalid save key');
  try {
    await fs.unlink(savePath(safe));
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#14110e',
    title: 'MY FAKE MUSEUM',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; font-src 'self'; connect-src 'none'; " +
            "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ],
      },
    });
  });

  // The game is fully offline; nothing may navigate or pop out.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  void win.loadFile(path.join(DIST, 'index.html'));
  return win;
}

// One instance only; a second launch focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

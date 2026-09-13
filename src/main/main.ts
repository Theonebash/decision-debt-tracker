import { BrowserWindow, app, dialog } from 'electron';
import path from 'node:path';
import { DecisionStore } from './store';
import { registerIpc } from './ipc';
import { buildMenu } from './menu';
import type { MenuCommand } from '../shared/model';

const WINDOW_BACKGROUND = '#f1f1ef';

let mainWindow: BrowserWindow | null = null;
let store: DecisionStore | null = null;

function databasePath(): string {
  return path.join(app.getPath('userData'), 'decisions.db');
}

function rendererFile(name: string): string {
  return path.join(__dirname, '..', 'renderer', name);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    title: 'Decision Debt Tracker',
    backgroundColor: WINDOW_BACKGROUND,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Showing only once the first frame is painted avoids a white flash on launch.
  window.once('ready-to-show', () => window.show());

  // Nothing in the interface links out, so a request to open a window is always refused.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  window.on('closed', () => {
    mainWindow = null;
  });

  window.loadFile(rendererFile('index.html')).catch((error: unknown) => {
    fatal('The interface could not be loaded.', error);
  });
  mainWindow = window;
}

/** Startup failures have nowhere to surface, so they are reported and the process is released. */
function fatal(summary: string, error: unknown): never {
  const detail = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('Decision Debt Tracker', `${summary}\n\n${detail}`);
  app.exit(1);
  throw error;
}

function sendCommand(command: MenuCommand): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  target?.webContents.send('menu:command', command);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId('com.decisiondebt.tracker');

  void app.whenReady().then(() => {
    try {
      store = new DecisionStore(databasePath());
    } catch (error) {
      fatal(`The decision database could not be opened at:\n${databasePath()}`, error);
    }

    registerIpc(store);
    buildMenu(sendCommand);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    store?.close();
    store = null;
  });
}

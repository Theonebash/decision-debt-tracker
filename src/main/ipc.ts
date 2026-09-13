import { BrowserWindow, dialog, ipcMain, type MessageBoxOptions } from 'electron';
import type { DecisionStore } from './store';
import { toDecisionId, toListOptions, toWeekStart } from '../shared/validation';

async function confirmDelete(store: DecisionStore, id: number, sender: Electron.WebContents) {
  const decision = store.get(id);
  if (!decision) return false;

  const options: MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Delete Decision'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Delete Decision',
    message: `Delete “${decision.title}”?`,
    detail:
      decision.status === 'resolved'
        ? 'The decision and its recorded outcome will be removed permanently.'
        : 'The decision and everything recorded about it will be removed permanently.',
  };

  const window = BrowserWindow.fromWebContents(sender);
  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);

  if (response !== 1) return false;

  store.remove(decision.id);
  return true;
}

export function registerIpc(store: DecisionStore): void {
  ipcMain.handle('decisions:list', (_event, options: unknown) => store.list(toListOptions(options)));
  ipcMain.handle('decisions:stats', () => store.stats());
  ipcMain.handle('decisions:create', (_event, draft: unknown) => store.create(draft));
  ipcMain.handle('decisions:update', (_event, id: unknown, draft: unknown) =>
    store.update(toDecisionId(id), draft),
  );
  ipcMain.handle('decisions:resolve', (_event, id: unknown, resolution: unknown) =>
    store.resolve(toDecisionId(id), resolution),
  );
  ipcMain.handle('summary:weekly', (_event, weekStart: unknown) => store.weeklySummary(toWeekStart(weekStart)));
  ipcMain.handle('decisions:delete', (event, id: unknown) => confirmDelete(store, toDecisionId(id), event.sender));
}

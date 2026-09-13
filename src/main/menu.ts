import { Menu, app, dialog, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../shared/model';

/** The native menu is the single owner of every Ctrl accelerator; it forwards intent to the renderer. */
export function buildMenu(send: (command: MenuCommand) => void): void {
  const file: MenuItemConstructorOptions = {
    label: '&File',
    submenu: [
      { label: 'New Decision', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
      { label: 'Edit Decision', accelerator: 'CmdOrCtrl+E', click: () => send('edit') },
      { label: 'Resolve Decision', accelerator: 'CmdOrCtrl+R', click: () => send('resolve') },
      // No accelerator: Delete belongs to whatever text field has focus.
      { label: 'Delete Decision…', click: () => send('delete') },
      { type: 'separator' },
      { role: 'close', label: 'Close Window' },
      { role: 'quit', label: 'Exit' },
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: '&Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: '&View',
    submenu: [
      { label: 'Open Decisions', accelerator: 'CmdOrCtrl+1', click: () => send('view-open') },
      { label: 'Weekly Summary', accelerator: 'CmdOrCtrl+2', click: () => send('view-summary') },
      { type: 'separator' },
      { label: 'Search Decisions', accelerator: 'CmdOrCtrl+F', click: () => send('focus-search') },
      { label: 'Show Resolved Decisions', click: () => send('toggle-resolved') },
    ],
  };

  if (!app.isPackaged) {
    view.submenu = [
      ...(view.submenu as MenuItemConstructorOptions[]),
      { type: 'separator' },
      { role: 'reload', accelerator: 'CmdOrCtrl+Shift+R' },
      { role: 'toggleDevTools', accelerator: 'F12' },
    ];
  }

  const window: MenuItemConstructorOptions = {
    label: '&Window',
    submenu: [{ role: 'minimize' }, { role: 'close', label: 'Close' }],
  };

  const help: MenuItemConstructorOptions = {
    label: '&Help',
    submenu: [
      {
        label: 'About Decision Debt Tracker',
        click: () => {
          void dialog.showMessageBox({
            type: 'info',
            title: 'About Decision Debt Tracker',
            message: `Decision Debt Tracker ${app.getVersion()}`,
            detail: `Postponed decisions, and what the delay is costing.\n\nYour decisions are stored on this computer at:\n${app.getPath('userData')}`,
            buttons: ['Close'],
            noLink: true,
          });
        },
      },
    ],
  };

  Menu.setApplicationMenu(Menu.buildFromTemplate([file, edit, view, window, help]));
}

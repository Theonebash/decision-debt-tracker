import { contextBridge, ipcRenderer } from 'electron';
import type { DdtApi } from '../shared/api';
import type { DecisionDraft, ListOptions, MenuCommand, Resolution } from '../shared/model';

const api: DdtApi = {
  listDecisions: (options: ListOptions) => ipcRenderer.invoke('decisions:list', options),
  createDecision: (draft: DecisionDraft) => ipcRenderer.invoke('decisions:create', draft),
  updateDecision: (id: number, draft: DecisionDraft) => ipcRenderer.invoke('decisions:update', id, draft),
  resolveDecision: (id: number, resolution: Resolution) => ipcRenderer.invoke('decisions:resolve', id, resolution),
  deleteDecision: (id: number) => ipcRenderer.invoke('decisions:delete', id),
  getStats: () => ipcRenderer.invoke('decisions:stats'),
  getWeeklySummary: (weekStart: string) => ipcRenderer.invoke('summary:weekly', weekStart),
  onMenuCommand: (handler: (command: MenuCommand) => void) => {
    ipcRenderer.on('menu:command', (_event, command: MenuCommand) => handler(command));
  },
};

contextBridge.exposeInMainWorld('ddt', api);

import type {
  Decision,
  DecisionDraft,
  ListOptions,
  MenuCommand,
  MutationResult,
  Resolution,
  Stats,
  WeeklySummary,
} from './model';

/** The surface the preload script exposes to the renderer as `window.ddt`. */
export interface DdtApi {
  listDecisions(options: ListOptions): Promise<Decision[]>;
  createDecision(draft: DecisionDraft): Promise<MutationResult>;
  updateDecision(id: number, draft: DecisionDraft): Promise<MutationResult>;
  resolveDecision(id: number, resolution: Resolution): Promise<MutationResult>;
  /** Asks for confirmation in a native dialog before removing the decision. */
  deleteDecision(id: number): Promise<boolean>;
  getStats(): Promise<Stats>;
  getWeeklySummary(weekStart: string): Promise<WeeklySummary>;
  onMenuCommand(handler: (command: MenuCommand) => void): void;
}

declare global {
  interface Window {
    ddt: DdtApi;
  }
}

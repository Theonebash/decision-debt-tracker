/** Domain model for Decision Debt Tracker. Field names match the SQLite columns exactly. */

export type DecayLevel = 'low' | 'medium' | 'high';
export type DecisionStatus = 'open' | 'resolved';

export const DECAY_LEVELS: readonly DecayLevel[] = ['low', 'medium', 'high'];

export const DECAY_LABEL: Record<DecayLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export interface Decision {
  id: number;
  title: string;
  context: string;
  people_involved: string;
  reason_delayed: string;
  /** Local calendar date, YYYY-MM-DD. */
  review_date: string;
  decay_level: DecayLevel;
  status: DecisionStatus;
  outcome: string;
  /** ISO-8601 instant. */
  created_at: string;
  /** ISO-8601 instant, null while the decision is open. */
  resolved_at: string | null;
}

/** The editor's editable fields. */
export interface DecisionDraft {
  title: string;
  context: string;
  people_involved: string;
  reason_delayed: string;
  review_date: string;
  decay_level: DecayLevel;
}

export interface Resolution {
  outcome: string;
  /** Local calendar date the decision was closed; may be backdated. */
  resolved_on: string;
}

export type SortKey = 'decay' | 'review' | 'title';
export type SortDirection = 'asc' | 'desc';

/** The sortable columns, in the order they appear. Shared by the menu, the IPC boundary and the list. */
export const SORT_KEYS: readonly SortKey[] = ['decay', 'review', 'title'];
export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

export interface SortSpec {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortSpec = { key: 'decay', direction: 'desc' };

export interface ListOptions {
  include_resolved: boolean;
  search: string;
  sort: SortSpec;
}

export interface Stats {
  open_count: number;
  overdue_count: number;
  resolved_count: number;
}

export interface WeeklySummary {
  /** Monday and Sunday of the reported week, inclusive. */
  week_start: string;
  week_end: string;
  resolved_this_week: Decision[];
  open_count: number;
  overdue_count: number;
  open_by_decay: Record<DecayLevel, number>;
  oldest_open: Decision | null;
}

export type DecisionField = keyof DecisionDraft | 'outcome' | 'resolved_on';
export type FieldErrors = Partial<Record<DecisionField, string>>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

export type MutationResult =
  | { ok: true; decision: Decision }
  | { ok: false; errors: FieldErrors };

/** Commands the native menu sends to the renderer. */
export type MenuCommand =
  | 'new'
  | 'edit'
  | 'resolve'
  | 'delete'
  | 'focus-search'
  | 'toggle-resolved'
  | 'view-open'
  | 'view-summary';

export function isDecayLevel(value: unknown): value is DecayLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

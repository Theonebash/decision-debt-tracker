/**
 * SQLite storage for decisions. The table columns use the same snake_case names
 * as the `Decision` fields, so a selected row is used as-is.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { toLocalISO, todayISO, weekBounds } from '../shared/dates';
import {
  isDecayLevel,
  type Decision,
  type DecayLevel,
  type ListOptions,
  type MutationResult,
  type SortDirection,
  type SortKey,
  type SortSpec,
  type Stats,
  type WeeklySummary,
} from '../shared/model';
import { validateDraft, validateResolution } from '../shared/validation';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  context TEXT NOT NULL,
  people_involved TEXT NOT NULL DEFAULT '',
  reason_delayed TEXT NOT NULL DEFAULT '',
  review_date TEXT NOT NULL CHECK (review_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  decay_level TEXT NOT NULL CHECK (decay_level IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  outcome TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS decisions_status_review
  ON decisions (status, review_date);
`;

const SQL = {
  insert: `INSERT INTO decisions
      (title, context, people_involved, reason_delayed, review_date, decay_level, status, outcome, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', '', ?, NULL)`,
  update: `UPDATE decisions
    SET title = ?, context = ?, people_involved = ?, reason_delayed = ?, review_date = ?, decay_level = ?
    WHERE id = ?`,
  resolve: `UPDATE decisions SET status = 'resolved', outcome = ?, resolved_at = ? WHERE id = ?`,
  remove: 'DELETE FROM decisions WHERE id = ?',
  get: 'SELECT * FROM decisions WHERE id = ?',
  countOpen: "SELECT COUNT(*) AS total FROM decisions WHERE status = 'open'",
  countOverdue: "SELECT COUNT(*) AS total FROM decisions WHERE status = 'open' AND review_date < ?",
  countResolved: "SELECT COUNT(*) AS total FROM decisions WHERE status = 'resolved'",
  openByDecay: "SELECT decay_level, COUNT(*) AS total FROM decisions WHERE status = 'open' GROUP BY decay_level",
  oldestOpen: "SELECT * FROM decisions WHERE status = 'open' ORDER BY created_at ASC, id ASC LIMIT 1",
  resolved: "SELECT * FROM decisions WHERE status = 'resolved' ORDER BY resolved_at DESC, id DESC",
} as const;

type Statements = { [K in keyof typeof SQL]: StatementSync };

/** ORDER BY whitelists: neither the sort key nor the direction reaches SQL as text. */
const DECAY_RANK_SQL = "CASE decay_level WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END";
const DIRECTION_SQL: Record<SortDirection, string> = { asc: 'ASC', desc: 'DESC' };
const ORDER_BY_SQL: Record<SortKey, (direction: string) => string> = {
  decay: (direction) => `${DECAY_RANK_SQL} ${direction}, review_date ASC, id ASC`,
  review: (direction) => `review_date ${direction}, ${DECAY_RANK_SQL} DESC, id ASC`,
  title: (direction) => `title COLLATE NOCASE ${direction}, review_date ASC, id ASC`,
};

function orderBy(sort: SortSpec): string {
  return ORDER_BY_SQL[sort.key](DIRECTION_SQL[sort.direction]);
}

/** The instant stored for a resolution recorded against a local calendar date. */
function resolvedInstant(resolvedOn: string): string {
  if (resolvedOn === todayISO()) return new Date().toISOString();
  // A backdated resolution is stamped at local noon: twelve hours of slack on either
  // side keep the instant on the requested calendar day under any offset or DST shift.
  const [year, month, day] = resolvedOn.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0).toISOString();
}

function countRows(statement: StatementSync, ...params: string[]): number {
  return Number(statement.get(...params)?.total ?? 0);
}

export class DecisionStore {
  private readonly db: DatabaseSync;
  private readonly stmts: Statements;

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.stmts = {
      insert: this.db.prepare(SQL.insert),
      update: this.db.prepare(SQL.update),
      resolve: this.db.prepare(SQL.resolve),
      remove: this.db.prepare(SQL.remove),
      get: this.db.prepare(SQL.get),
      countOpen: this.db.prepare(SQL.countOpen),
      countOverdue: this.db.prepare(SQL.countOverdue),
      countResolved: this.db.prepare(SQL.countResolved),
      openByDecay: this.db.prepare(SQL.openByDecay),
      oldestOpen: this.db.prepare(SQL.oldestOpen),
      resolved: this.db.prepare(SQL.resolved),
    };
  }

  close(): void {
    this.db.close();
  }

  create(draft: unknown): MutationResult {
    const validated = validateDraft(draft);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const value = validated.value;
    const inserted = this.stmts.insert.run(
      value.title,
      value.context,
      value.people_involved,
      value.reason_delayed,
      value.review_date,
      value.decay_level,
      new Date().toISOString(),
    );
    return { ok: true, decision: this.require(Number(inserted.lastInsertRowid)) };
  }

  update(id: number, draft: unknown): MutationResult {
    const validated = validateDraft(draft);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const value = validated.value;
    // Only the editable columns are written: status, outcome, created_at and
    // resolved_at are never part of the statement, so a resolved decision cannot reopen.
    const updated = this.stmts.update.run(
      value.title,
      value.context,
      value.people_involved,
      value.reason_delayed,
      value.review_date,
      value.decay_level,
      id,
    );
    if (Number(updated.changes) === 0) throw new Error(`No decision with id ${id} to update.`);
    return { ok: true, decision: this.require(id) };
  }

  resolve(id: number, resolution: unknown): MutationResult {
    const validated = validateResolution(resolution);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const existing = this.get(id);
    if (!existing) throw new Error(`No decision with id ${id} to resolve.`);
    if (existing.status === 'resolved') throw new Error(`Decision ${id} is already resolved.`);

    const { outcome, resolved_on } = validated.value;
    this.stmts.resolve.run(outcome, resolvedInstant(resolved_on), id);
    return { ok: true, decision: this.require(id) };
  }

  remove(id: number): void {
    this.stmts.remove.run(id);
  }

  get(id: number): Decision | null {
    return (this.stmts.get.get(id) as Decision | undefined) ?? null;
  }

  list(options: ListOptions): Decision[] {
    const filter = options.include_resolved ? '' : " WHERE status = 'open'";
    const rows = this.db
      .prepare(`SELECT * FROM decisions${filter} ORDER BY ${orderBy(options.sort)}`)
      .all();

    const decisions = rows as unknown as Decision[];
    const search = options.search.trim().toLocaleLowerCase();
    if (search === '') return decisions;

    // Matched here rather than in SQL: LIKE folds case for ASCII only, so a search for
    // "änderung" would otherwise miss "Änderung". It also keeps % and _ literal.
    return decisions.filter((decision) =>
      [decision.title, decision.context, decision.people_involved, decision.reason_delayed].some(
        (field) => field.toLocaleLowerCase().includes(search),
      ),
    );
  }

  stats(): Stats {
    return {
      open_count: countRows(this.stmts.countOpen),
      overdue_count: countRows(this.stmts.countOverdue, todayISO()),
      resolved_count: countRows(this.stmts.countResolved),
    };
  }

  weeklySummary(weekStart: string): WeeklySummary {
    const { start, end } = weekBounds(weekStart);
    const stats = this.stats();

    const resolved = this.stmts.resolved.all() as unknown as Decision[];
    // Filtered here rather than in SQL because the week is a local-calendar window and
    // SQLite's date functions would interpret the stored instants as UTC.
    const resolved_this_week = resolved.filter((decision) => {
      if (decision.resolved_at === null) return false;
      const localDate = toLocalISO(new Date(decision.resolved_at));
      return localDate >= start && localDate <= end;
    });

    const open_by_decay: Record<DecayLevel, number> = { low: 0, medium: 0, high: 0 };
    for (const row of this.stmts.openByDecay.all()) {
      if (isDecayLevel(row.decay_level)) open_by_decay[row.decay_level] = Number(row.total);
    }

    return {
      week_start: start,
      week_end: end,
      resolved_this_week,
      open_count: stats.open_count,
      overdue_count: stats.overdue_count,
      open_by_decay,
      oldest_open: (this.stmts.oldestOpen.get() as Decision | undefined) ?? null,
    };
  }

  private require(id: number): Decision {
    const decision = this.get(id);
    if (!decision) throw new Error(`No decision with id ${id}.`);
    return decision;
  }
}

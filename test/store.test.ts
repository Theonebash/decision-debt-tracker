import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { DecisionStore } from '../src/main/store';
import { parseISODate, toLocalISO, todayISO, weekBounds } from '../src/shared/dates';
import {
  DEFAULT_SORT,
  type Decision,
  type DecisionDraft,
  type FieldErrors,
  type ListOptions,
  type MutationResult,
} from '../src/shared/model';

/** Every test gets its own in-memory database and closes it again. */
function withStore(run: (store: DecisionStore) => void): void {
  const store = new DecisionStore(':memory:');
  try {
    run(store);
  } finally {
    store.close();
  }
}

function draft(overrides: Partial<DecisionDraft> = {}): DecisionDraft {
  return {
    title: 'Pick a vendor',
    context: 'Two quotes are on the table.',
    people_involved: 'Ana',
    reason_delayed: 'Waiting on budget approval',
    review_date: todayISO(),
    decay_level: 'medium',
    ...overrides,
  };
}

function options(overrides: Partial<ListOptions> = {}): ListOptions {
  return { include_resolved: false, search: '', sort: DEFAULT_SORT, ...overrides };
}

function expectOk(result: MutationResult): Decision {
  assert.equal(result.ok, true, 'expected the mutation to succeed');
  if (!result.ok) throw new Error('unreachable: the mutation reported errors');
  return result.decision;
}

function expectErrors(result: MutationResult): FieldErrors {
  assert.equal(result.ok, false, 'expected the mutation to be rejected');
  if (result.ok) throw new Error('unreachable: the mutation succeeded');
  return result.errors;
}

/** Calendar-date arithmetic, so no fixture depends on the day the suite runs. */
function addDays(isoDate: string, days: number): string {
  const date = parseISODate(isoDate);
  assert.ok(date, `expected a real calendar date, got ${isoDate}`);
  return toLocalISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function create(store: DecisionStore, overrides: Partial<DecisionDraft> = {}): Decision {
  return expectOk(store.create(draft(overrides)));
}

function titles(decisions: Decision[]): string[] {
  return decisions.map((decision) => decision.title);
}

describe('create', () => {
  it('stores an open decision with an empty outcome and no resolved_at', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Choose a CRM' });

      assert.ok(decision.id > 0, 'the row should have an id');
      assert.equal(decision.title, 'Choose a CRM');
      assert.equal(decision.context, 'Two quotes are on the table.');
      assert.equal(decision.status, 'open');
      assert.equal(decision.outcome, '');
      assert.equal(decision.resolved_at, null);
      assert.ok(!Number.isNaN(Date.parse(decision.created_at)), 'created_at should be an ISO instant');
    });
  });

  it('reports a blank title and stores nothing', () => {
    withStore((store) => {
      const errors = expectErrors(store.create(draft({ title: '   ' })));

      assert.ok(errors.title, 'expected a title error');
      assert.equal(errors.context, undefined);
      assert.equal(store.list(options()).length, 0);
    });
  });

  it('reports a missing context', () => {
    withStore((store) => {
      const errors = expectErrors(
        store.create({ title: 'No context here', review_date: todayISO(), decay_level: 'low' }),
      );

      assert.ok(errors.context, 'expected a context error');
      assert.equal(errors.title, undefined);
    });
  });

  it('reports an impossible review date', () => {
    withStore((store) => {
      const errors = expectErrors(store.create(draft({ review_date: '2026-02-30' })));

      assert.ok(errors.review_date, 'expected a review_date error');
      assert.equal(store.list(options()).length, 0);
    });
  });

  it('reports an unknown decay level', () => {
    withStore((store) => {
      const errors = expectErrors(store.create({ ...draft(), decay_level: 'urgent' }));

      assert.ok(errors.decay_level, 'expected a decay_level error');
      assert.equal(store.list(options()).length, 0);
    });
  });

  it('rejects a non-object draft at the store boundary', () => {
    withStore((store) => {
      const errors = expectErrors(store.create(null));

      assert.ok(errors.title, 'expected a title error');
      assert.ok(errors.context, 'expected a context error');
      assert.ok(errors.review_date, 'expected a review_date error');
      assert.ok(errors.decay_level, 'expected a decay_level error');
      assert.equal(store.list(options()).length, 0);
    });
  });
});

describe('list sorting', () => {
  it('orders by decay high to low, then by earliest review date', () => {
    withStore((store) => {
      const today = todayISO();
      create(store, { title: 'low soon', decay_level: 'low', review_date: today });
      create(store, { title: 'medium soon', decay_level: 'medium', review_date: addDays(today, 1) });
      create(store, { title: 'high late', decay_level: 'high', review_date: addDays(today, 5) });
      create(store, { title: 'high soon', decay_level: 'high', review_date: today });
      create(store, { title: 'high mid', decay_level: 'high', review_date: addDays(today, 2) });

      assert.deepEqual(titles(store.list(options())), [
        'high soon',
        'high mid',
        'high late',
        'medium soon',
        'low soon',
      ]);
    });
  });

  it('sorts titles alphabetically regardless of case', () => {
    withStore((store) => {
      create(store, { title: 'banana' });
      create(store, { title: 'Apple' });
      create(store, { title: 'cherry' });

      const asc = options({ sort: { key: 'title', direction: 'asc' } });
      const desc = options({ sort: { key: 'title', direction: 'desc' } });

      assert.deepEqual(titles(store.list(asc)), ['Apple', 'banana', 'cherry']);
      assert.deepEqual(titles(store.list(desc)), ['cherry', 'banana', 'Apple']);
    });
  });

  it('sorts by review date in both directions', () => {
    withStore((store) => {
      const today = todayISO();
      create(store, { title: 'middle', review_date: addDays(today, 10) });
      create(store, { title: 'latest', review_date: addDays(today, 20) });
      create(store, { title: 'earliest', review_date: today });

      const asc = options({ sort: { key: 'review', direction: 'asc' } });
      const desc = options({ sort: { key: 'review', direction: 'desc' } });

      assert.deepEqual(titles(store.list(asc)), ['earliest', 'middle', 'latest']);
      assert.deepEqual(titles(store.list(desc)), ['latest', 'middle', 'earliest']);
    });
  });

  it('hides resolved decisions unless include_resolved is set', () => {
    withStore((store) => {
      create(store, { title: 'still open' });
      const closed = create(store, { title: 'already closed' });
      expectOk(store.resolve(closed.id, { outcome: 'Went with the cheaper quote', resolved_on: todayISO() }));

      assert.deepEqual(titles(store.list(options({ include_resolved: false }))), ['still open']);
      assert.deepEqual(
        titles(store.list(options({ include_resolved: true, sort: { key: 'title', direction: 'asc' } }))),
        ['already closed', 'still open'],
      );
    });
  });
});

describe('list search', () => {
  it('matches title, context, people and reason case-insensitively', () => {
    withStore((store) => {
      create(store, {
        title: 'Migrate the database',
        context: 'Legacy schema blocks the release.',
        people_involved: 'Ana Ruiz',
        reason_delayed: 'Waiting on legal review',
      });
      create(store, {
        title: 'Hire a designer',
        context: 'Portfolio work is behind.',
        people_involved: 'Tom',
        reason_delayed: 'Budget cycle',
      });

      assert.deepEqual(titles(store.list(options({ search: 'MIGRATE' }))), ['Migrate the database']);
      assert.deepEqual(titles(store.list(options({ search: 'legacy schema' }))), ['Migrate the database']);
      assert.deepEqual(titles(store.list(options({ search: 'ana ruiz' }))), ['Migrate the database']);
      assert.deepEqual(titles(store.list(options({ search: 'LEGAL' }))), ['Migrate the database']);
      assert.deepEqual(titles(store.list(options({ search: 'nothing here' }))), []);
    });
  });

  it('treats % _ and \\ in the search text as literal characters', () => {
    withStore((store) => {
      create(store, { title: 'Offer a 10% discount' });
      create(store, { title: 'Offer a 10x discount' });
      create(store, { title: 'Underscore_name review' });
      create(store, { title: 'Escaped \\ path review' });

      assert.deepEqual(titles(store.list(options({ search: '%' }))), ['Offer a 10% discount']);
      assert.deepEqual(titles(store.list(options({ search: '10% d' }))), ['Offer a 10% discount']);
      assert.deepEqual(titles(store.list(options({ search: '_' }))), ['Underscore_name review']);
      assert.deepEqual(titles(store.list(options({ search: '\\' }))), ['Escaped \\ path review']);
    });
  });

  it('folds case for text outside ASCII', () => {
    withStore((store) => {
      create(store, { title: 'Änderung besprechen' });
      create(store, { title: 'Angebot prüfen' });

      assert.equal(store.list(options({ search: 'änderung' })).length, 1, 'lower case should match');
      assert.equal(store.list(options({ search: 'ÄNDERUNG' })).length, 1, 'upper case should match');
      assert.equal(store.list(options({ search: 'PRÜFEN' })).length, 1, 'upper case umlaut should match');
    });
  });
});

describe('resolve', () => {
  it('marks the decision resolved and takes it out of the open list', () => {
    withStore((store) => {
      const today = todayISO();
      const decision = create(store, { title: 'Approve the reorg' });
      const resolved = expectOk(
        store.resolve(decision.id, { outcome: 'Approved with two new hires', resolved_on: today }),
      );

      assert.equal(resolved.status, 'resolved');
      assert.equal(resolved.outcome, 'Approved with two new hires');
      const instant = resolved.resolved_at;
      assert.ok(instant, 'resolved_at should be stamped');
      assert.equal(toLocalISO(new Date(instant)), today);
      assert.deepEqual(store.list(options()), []);
      assert.equal(store.get(decision.id)?.status, 'resolved');
    });
  });

  it('stamps a resolution recorded today with the current instant, not local noon', () => {
    withStore((store) => {
      const resolved = expectOk(
        store.resolve(create(store, { title: 'Close it now' }).id, {
          outcome: 'Closed on the spot',
          resolved_on: todayISO(),
        }),
      );

      assert.ok(resolved.resolved_at, 'resolved_at should be stamped');
      assert.ok(
        Math.abs(Date.now() - Date.parse(resolved.resolved_at)) < 5_000,
        'a resolution recorded today should carry the time it was recorded',
      );
    });
  });

  it('stores a backdated resolution on the requested local calendar day', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Backdate me' });
      const backdated = addDays(todayISO(), -9);
      const resolved = expectOk(
        store.resolve(decision.id, { outcome: 'Chose the cheaper vendor', resolved_on: backdated }),
      );

      const instant = resolved.resolved_at;
      assert.ok(instant, 'resolved_at should be stamped');
      assert.equal(toLocalISO(new Date(instant)), backdated);
      assert.equal(new Date(instant).getHours(), 12, 'backdated resolutions are stamped at local noon');
    });
  });

  it('refuses to resolve the same decision twice', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Close it once' });
      expectOk(store.resolve(decision.id, { outcome: 'First closing', resolved_on: todayISO() }));

      assert.throws(
        () => store.resolve(decision.id, { outcome: 'Second closing', resolved_on: todayISO() }),
        /already resolved/,
      );
      assert.equal(store.get(decision.id)?.outcome, 'First closing');
    });
  });

  it('rejects an empty outcome and leaves the decision open', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Needs an outcome' });
      const errors = expectErrors(store.resolve(decision.id, { outcome: '   ', resolved_on: todayISO() }));

      assert.ok(errors.outcome, 'expected an outcome error');
      assert.equal(store.get(decision.id)?.status, 'open');
    });
  });

  it('throws when the decision does not exist', () => {
    withStore((store) => {
      assert.throws(() => store.resolve(4242, { outcome: 'Nothing to close', resolved_on: todayISO() }), /4242/);
    });
  });
});

describe('update', () => {
  it('throws when the decision does not exist', () => {
    withStore((store) => {
      assert.throws(() => store.update(4242, draft()), /4242/);
    });
  });

  it('cannot change status, outcome, created_at or resolved_at', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Original title' });
      const before = store.get(decision.id);
      assert.ok(before, 'the decision should exist');

      const hostile = {
        ...draft({ title: 'Renamed by update' }),
        status: 'resolved',
        outcome: 'sneaked in',
        created_at: '1999-01-01T00:00:00.000Z',
        resolved_at: '1999-01-01T00:00:00.000Z',
      };
      const updated = expectOk(store.update(decision.id, hostile));

      assert.equal(updated.title, 'Renamed by update');
      assert.equal(updated.status, 'open');
      assert.equal(updated.outcome, '');
      assert.equal(updated.resolved_at, null);
      assert.equal(updated.created_at, before.created_at);
      assert.equal(updated.id, decision.id);
    });
  });

  it('cannot resurrect a resolved decision', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Close the office' });
      expectOk(store.resolve(decision.id, { outcome: 'Kept it open', resolved_on: todayISO() }));
      const before = store.get(decision.id);
      assert.ok(before, 'the decision should exist');

      const updated = expectOk(
        store.update(decision.id, { ...draft({ title: 'Close the office for good' }), status: 'open', outcome: '' }),
      );

      assert.equal(updated.title, 'Close the office for good');
      assert.equal(updated.status, 'resolved');
      assert.equal(updated.outcome, 'Kept it open');
      assert.equal(updated.resolved_at, before.resolved_at);
    });
  });

  it('rejects an invalid draft and leaves the row untouched', () => {
    withStore((store) => {
      const decision = create(store, { title: 'Keep this title' });
      const errors = expectErrors(store.update(decision.id, draft({ title: '   ', review_date: 'nope' })));

      assert.ok(errors.title, 'expected a title error');
      assert.ok(errors.review_date, 'expected a review_date error');
      assert.equal(store.get(decision.id)?.title, 'Keep this title');
    });
  });
});

describe('stats', () => {
  it('counts open, overdue and resolved decisions', () => {
    withStore((store) => {
      const today = todayISO();
      create(store, { title: 'overdue by three days', review_date: addDays(today, -3) });
      create(store, { title: 'due today', review_date: today });
      create(store, { title: 'due next week', review_date: addDays(today, 7) });
      const closed = create(store, { title: 'already closed' });
      expectOk(store.resolve(closed.id, { outcome: 'Decided', resolved_on: today }));

      assert.deepEqual(store.stats(), { open_count: 3, overdue_count: 1, resolved_count: 1 });
    });
  });

  it('stops counting an overdue decision as overdue once it is resolved', () => {
    withStore((store) => {
      const today = todayISO();
      const late = create(store, { title: 'late', review_date: addDays(today, -30) });
      assert.equal(store.stats().overdue_count, 1);

      expectOk(store.resolve(late.id, { outcome: 'Caught up', resolved_on: today }));

      assert.deepEqual(store.stats(), { open_count: 0, overdue_count: 0, resolved_count: 1 });
    });
  });
});

describe('weeklySummary', () => {
  it('reports the resolutions inside the Monday to Sunday window', () => {
    withStore((store) => {
      const today = todayISO();
      const { start, end } = weekBounds(today);
      const lastSunday = addDays(start, -1);

      const oldest = create(store, { title: 'oldest open', decay_level: 'low', review_date: addDays(today, -3) });
      const newer = create(store, { title: 'newer open', decay_level: 'high', review_date: addDays(today, 4) });
      const monday = create(store, { title: 'closed on monday', review_date: today });
      const sunday = create(store, { title: 'closed on sunday', review_date: today });
      const outside = create(store, { title: 'closed last week', review_date: today });

      expectOk(store.resolve(monday.id, { outcome: 'Monday outcome', resolved_on: start }));
      expectOk(store.resolve(sunday.id, { outcome: 'Sunday outcome', resolved_on: end }));
      expectOk(store.resolve(outside.id, { outcome: 'Last week outcome', resolved_on: lastSunday }));

      const summary = store.weeklySummary(start);

      assert.equal(summary.week_start, start);
      assert.equal(summary.week_end, end);
      assert.deepEqual(titles(summary.resolved_this_week), ['closed on sunday', 'closed on monday']);
      assert.deepEqual(summary.open_by_decay, { low: 1, medium: 0, high: 1 });
      assert.equal(summary.open_count, 2);
      assert.equal(summary.overdue_count, 1);
      assert.equal(summary.oldest_open?.id, oldest.id);
      assert.notEqual(summary.oldest_open?.id, newer.id);
    });
  });

  it('returns empty decay buckets and a null oldest_open when nothing is open', () => {
    withStore((store) => {
      const { start, end } = weekBounds(todayISO());
      const only = create(store, { title: 'the only one', decay_level: 'high' });
      expectOk(store.resolve(only.id, { outcome: 'Done', resolved_on: start }));

      const summary = store.weeklySummary(start);

      assert.deepEqual(summary.open_by_decay, { low: 0, medium: 0, high: 0 });
      assert.equal(summary.open_count, 0);
      assert.equal(summary.overdue_count, 0);
      assert.equal(summary.oldest_open, null);
      assert.deepEqual(titles(summary.resolved_this_week), ['the only one']);
      assert.equal(summary.week_end, end);
    });
  });

  it('uses the Monday to Sunday bounds of the week it is given', () => {
    withStore((store) => {
      const { start, end } = weekBounds(todayISO());
      const summary = store.weeklySummary(start);

      assert.equal(summary.week_start, start);
      assert.equal(summary.week_end, end);
      assert.deepEqual(summary.resolved_this_week, []);
    });
  });

  it('snaps a mid-week start date to the Monday of that same week', () => {
    withStore((store) => {
      const { start } = weekBounds(todayISO());
      const summary = store.weeklySummary(addDays(start, 3));

      assert.equal(summary.week_start, start);
      assert.equal(summary.week_end, addDays(start, 6));
    });
  });
});

describe('remove', () => {
  it('deletes the decision', () => {
    withStore((store) => {
      const doomed = create(store, { title: 'delete me' });
      create(store, { title: 'keep me' });

      store.remove(doomed.id);

      assert.equal(store.get(doomed.id), null);
      assert.deepEqual(titles(store.list(options())), ['keep me']);
      assert.equal(store.stats().open_count, 1);
    });
  });
});

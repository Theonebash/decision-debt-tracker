import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LIMITS,
  toDecisionId,
  toListOptions,
  toWeekStart,
  validateDraft,
  validateResolution,
} from '../src/shared/validation';
import { todayISO } from '../src/shared/dates';
import { DEFAULT_SORT, type FieldErrors } from '../src/shared/model';

const validDraft = {
  title: 'Renew the Berlin lease',
  context: 'The lease renews automatically unless notice is given.',
  people_involved: 'Facilities',
  reason_delayed: 'Waiting on the cost breakdown.',
  review_date: '2026-09-20',
  decay_level: 'high',
};

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    const result = validateDraft(validDraft);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, validDraft);
  });

  it('trims surrounding whitespace', () => {
    const result = validateDraft({ ...validDraft, title: '  Renew the Berlin lease  ' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.title, 'Renew the Berlin lease');
  });

  it('treats missing optional fields as empty strings', () => {
    const result = validateDraft({ ...validDraft, people_involved: undefined, reason_delayed: undefined });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.people_involved, '');
    assert.equal(result.value.reason_delayed, '');
  });

  it('requires a title and a context', () => {
    const result = validateDraft({ ...validDraft, title: '   ', context: '' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.title);
    assert.ok(result.errors.context);
  });

  it('rejects a title beyond the limit', () => {
    const result = validateDraft({ ...validDraft, title: 'x'.repeat(LIMITS.title + 1) });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.title);
  });

  it('enforces every field limit, not just the title', () => {
    const over: Array<[keyof FieldErrors, string, number]> = [
      ['title', 'title', LIMITS.title],
      ['context', 'context', LIMITS.context],
      ['people_involved', 'people_involved', LIMITS.people_involved],
      ['reason_delayed', 'reason_delayed', LIMITS.reason_delayed],
    ];

    for (const [field, key, limit] of over) {
      const rejected = validateDraft({ ...validDraft, [key]: 'x'.repeat(limit + 1) });
      assert.equal(rejected.ok, false, `${key} over its limit should be rejected`);
      if (rejected.ok) continue;
      assert.ok(rejected.errors[field], `${key} should report an error`);

      const accepted = validateDraft({ ...validDraft, [key]: 'x'.repeat(limit) });
      assert.equal(accepted.ok, true, `${key} at its limit should be accepted`);
    }
  });

  it('drops NUL characters, which SQLite would otherwise truncate on', () => {
    const result = validateDraft({ ...validDraft, title: 'Renew\u0000 the lease' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.title, 'Renew the lease');
  });

  it('rejects a review date that is not a real calendar date', () => {
    for (const review_date of ['2026-02-30', '2026-13-01', '20-09-2026', '', 'soon']) {
      const result = validateDraft({ ...validDraft, review_date });
      assert.equal(result.ok, false, `expected ${review_date} to be rejected`);
      if (result.ok) continue;
      assert.ok(result.errors.review_date);
    }
  });

  it('rejects an unknown decay level', () => {
    const result = validateDraft({ ...validDraft, decay_level: 'critical' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.decay_level);
  });

  it('reports every problem at once', () => {
    const result = validateDraft({ title: '', context: '', review_date: 'nope', decay_level: null });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(Object.keys(result.errors).sort(), [
      'context',
      'decay_level',
      'review_date',
      'title',
    ]);
  });

  it('survives input that is not an object at all', () => {
    for (const input of [null, undefined, 42, 'a decision', []]) {
      const result = validateDraft(input);
      assert.equal(result.ok, false);
    }
  });

  it('rejects non-string field values instead of coercing them', () => {
    const result = validateDraft({ ...validDraft, title: 12345 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.title);
  });
});

describe('validateResolution', () => {
  it('accepts an outcome and defaults the date to today', () => {
    const result = validateResolution({ outcome: 'Renewed for two years.' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.outcome, 'Renewed for two years.');
    assert.equal(result.value.resolved_on, todayISO());
  });

  it('keeps an explicit resolution date', () => {
    const result = validateResolution({ outcome: 'Renewed.', resolved_on: '2026-09-01' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.resolved_on, '2026-09-01');
  });

  it('requires an outcome', () => {
    const result = validateResolution({ outcome: '  ', resolved_on: '2026-09-01' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.outcome);
  });

  it('rejects an impossible resolution date', () => {
    const result = validateResolution({ outcome: 'Renewed.', resolved_on: '2026-02-30' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.resolved_on);
  });

  it('rejects a resolution that is not an object', () => {
    assert.equal(validateResolution(null).ok, false);
  });

  it('rejects a resolution dated in the future', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
      tomorrow.getDate(),
    ).padStart(2, '0')}`;

    const result = validateResolution({ outcome: 'Decided early', resolved_on: iso });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.resolved_on);
  });
});

/* These narrow what arrives over IPC, including the value that reaches ORDER BY. */
describe('toListOptions', () => {
  it('falls back to the default sort for anything not whitelisted', () => {
    for (const sort of [
      { key: 'toString', direction: 'asc' },
      { key: 'decay; DROP TABLE decisions--', direction: 'desc' },
      { key: '__proto__', direction: 'constructor' },
      { key: 42, direction: null },
      { key: 'title', direction: 'sideways' },
    ]) {
      assert.deepEqual(toListOptions({ sort }).sort, DEFAULT_SORT, `expected ${JSON.stringify(sort)} to be narrowed`);
    }
  });

  it('keeps a supported sort key and direction', () => {
    assert.deepEqual(toListOptions({ sort: { key: 'title', direction: 'asc' } }).sort, {
      key: 'title',
      direction: 'asc',
    });
  });

  it('treats only a literal true as include_resolved', () => {
    assert.equal(toListOptions({ include_resolved: true }).include_resolved, true);
    assert.equal(toListOptions({ include_resolved: 'yes' }).include_resolved, false);
  });

  it('caps the search text and ignores a non-text search', () => {
    assert.equal(toListOptions({ search: 'x'.repeat(500) }).search.length, 200);
    assert.equal(toListOptions({ search: 42 }).search, '');
  });

  it('survives input that is not an object', () => {
    assert.deepEqual(toListOptions(null), { include_resolved: false, search: '', sort: DEFAULT_SORT });
    assert.deepEqual(toListOptions('list everything').sort, DEFAULT_SORT);
  });
});

describe('toDecisionId', () => {
  it('accepts a positive integer', () => {
    assert.equal(toDecisionId(7), 7);
  });

  it('rejects anything that is not a positive integer', () => {
    for (const value of [0, -1, 1.5, '3', null, undefined, Number.NaN, {}]) {
      assert.throws(() => toDecisionId(value), /valid decision id/, `expected ${String(value)} to be rejected`);
    }
  });
});

describe('toWeekStart', () => {
  it('accepts a real calendar date', () => {
    assert.equal(toWeekStart('2026-09-07'), '2026-09-07');
  });

  it('rejects an impossible date or a non-text value', () => {
    for (const value of ['2026-02-30', '2026-09-07 ', 'monday', '', 42, null]) {
      assert.throws(() => toWeekStart(value), /week start date/, `expected ${String(value)} to be rejected`);
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  daysBetween,
  daysSince,
  describeReview,
  formatLongDate,
  formatShortDate,
  isOverdue,
  parseISODate,
  toISODate,
  todayISO,
  weekBounds,
} from '../src/shared/dates';

describe('parseISODate', () => {
  it('accepts a real calendar date', () => {
    const date = parseISODate('2026-09-13');
    assert.equal(date?.getFullYear(), 2026);
    assert.equal(date?.getMonth(), 8);
    assert.equal(date?.getDate(), 13);
  });

  it('accepts a leap day in a leap year', () => {
    assert.notEqual(parseISODate('2024-02-29'), null);
  });

  it('rejects a leap day in a common year', () => {
    assert.equal(parseISODate('2026-02-29'), null);
  });

  it('rejects a day past the end of the month', () => {
    assert.equal(parseISODate('2026-02-30'), null);
    assert.equal(parseISODate('2026-04-31'), null);
  });

  it('rejects impossible months and malformed input', () => {
    assert.equal(parseISODate('2026-13-01'), null);
    assert.equal(parseISODate('2026-00-10'), null);
    assert.equal(parseISODate('13-09-2026'), null);
    assert.equal(parseISODate('2026-9-3'), null);
    assert.equal(parseISODate(''), null);
    assert.equal(parseISODate('yesterday'), null);
  });
});

describe('todayISO and toISODate', () => {
  it('zero-pads month and day', () => {
    assert.equal(toISODate(2026, 1, 2), '2026-01-02');
    assert.equal(toISODate(2026, 12, 31), '2026-12-31');
  });

  it('matches the local calendar date', () => {
    const now = new Date(2026, 8, 13, 23, 30);
    assert.equal(todayISO(now), '2026-09-13');
  });
});

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    assert.equal(daysBetween('2026-09-10', '2026-09-13'), 3);
    assert.equal(daysBetween('2026-09-13', '2026-09-10'), -3);
    assert.equal(daysBetween('2026-09-13', '2026-09-13'), 0);
  });

  it('counts across a month boundary', () => {
    assert.equal(daysBetween('2026-08-30', '2026-09-02'), 3);
  });

  it('counts across a spring daylight-saving transition', () => {
    // Europe/London loses an hour on 2026-03-29; the day count must not shift.
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  });

  it('returns null when either date is unusable', () => {
    assert.equal(daysBetween('nonsense', '2026-09-13'), null);
    assert.equal(daysBetween('2026-09-13', ''), null);
  });
});

describe('isOverdue', () => {
  it('is true only for a date strictly before today', () => {
    assert.equal(isOverdue('2026-09-12', '2026-09-13'), true);
    assert.equal(isOverdue('2026-09-13', '2026-09-13'), false);
    assert.equal(isOverdue('2026-09-14', '2026-09-13'), false);
  });
});

describe('describeReview', () => {
  it('describes the near future in words', () => {
    assert.equal(describeReview('2026-09-13', '2026-09-13'), 'today');
    assert.equal(describeReview('2026-09-14', '2026-09-13'), 'tomorrow');
    assert.equal(describeReview('2026-09-17', '2026-09-13'), 'in 4d');
  });

  it('describes lateness in days', () => {
    assert.equal(describeReview('2026-09-12', '2026-09-13'), '1d late');
    assert.equal(describeReview('2026-09-01', '2026-09-13'), '12d late');
  });
});

describe('weekBounds', () => {
  it('returns Monday to Sunday for a mid-week date', () => {
    assert.deepEqual(weekBounds('2026-09-09'), { start: '2026-09-07', end: '2026-09-13' });
  });

  it('treats Monday as the first day of its own week', () => {
    assert.deepEqual(weekBounds('2026-09-07'), { start: '2026-09-07', end: '2026-09-13' });
  });

  it('treats Sunday as the last day of the week that began on Monday', () => {
    assert.deepEqual(weekBounds('2026-09-13'), { start: '2026-09-07', end: '2026-09-13' });
  });

  it('crosses a month boundary', () => {
    assert.deepEqual(weekBounds('2026-10-01'), { start: '2026-09-28', end: '2026-10-04' });
  });
});

describe('daysSince', () => {
  const now = new Date(2026, 8, 13, 18, 0, 0);

  function instant(year: number, month: number, day: number, hour: number, minute = 0): string {
    return new Date(year, month, day, hour, minute, 0).toISOString();
  }

  it('counts whole calendar days back to the given moment', () => {
    assert.equal(daysSince(instant(2026, 8, 13, 9), now), 0);
    assert.equal(daysSince(instant(2026, 8, 12, 9), now), 1);
    assert.equal(daysSince(instant(2026, 7, 14, 9), now), 30);
  });

  it('counts days, not hours', () => {
    // Eleven hours earlier is still the previous calendar day.
    assert.equal(daysSince(instant(2026, 8, 13, 7), new Date(2026, 8, 13, 18, 0, 0)), 0);
    // A minute before midnight yesterday is a full day ago.
    assert.equal(daysSince(instant(2026, 8, 12, 23, 59), new Date(2026, 8, 13, 0, 1, 0)), 1);
  });

  it('returns null for an instant it cannot read', () => {
    assert.equal(daysSince('not an instant', now), null);
    assert.equal(daysSince('', now), null);
  });
});

describe('formatting', () => {
  it('omits the year inside the current year', () => {
    assert.equal(formatShortDate('2026-09-04', '2026-09-13'), '4 Sep');
  });

  it('includes the year outside the current year', () => {
    assert.equal(formatShortDate('2027-01-04', '2026-09-13'), '4 Jan 2027');
  });

  it('always writes the year in the long form', () => {
    assert.equal(formatLongDate('2026-09-04'), '4 Sep 2026');
  });

  it('passes malformed input through untouched rather than inventing a date', () => {
    assert.equal(formatLongDate('not a date'), 'not a date');
    assert.equal(formatShortDate('not a date'), 'not a date');
  });
});

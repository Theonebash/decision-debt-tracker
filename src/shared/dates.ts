/**
 * Calendar-date helpers. Review and resolution dates are calendar dates in the
 * user's local time zone, so they are handled as YYYY-MM-DD strings rather than
 * instants. Day arithmetic goes through UTC day numbers to stay correct across
 * daylight-saving boundaries.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function todayISO(now: Date = new Date()): string {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toISODate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Returns null for anything that is not a real calendar date. */
export function parseISODate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;

  return roundTrips ? date : null;
}

function dayNumber(value: string): number | null {
  const date = parseISODate(value);
  if (!date) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null) return null;
  return end - start;
}

export function isOverdue(reviewDate: string, today: string = todayISO()): boolean {
  const remaining = daysBetween(today, reviewDate);
  return remaining !== null && remaining < 0;
}

export function daysSince(instant: string, now: Date = new Date()): number | null {
  const started = Date.parse(instant);
  if (Number.isNaN(started)) return null;
  const start = dayNumber(toLocalISO(new Date(started)));
  const end = dayNumber(toLocalISO(now));
  if (start === null || end === null) return null;
  return end - start;
}

export function toLocalISO(date: Date): string {
  return toISODate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** "4 Sep" inside the current year, "4 Sep 2027" outside it. */
export function formatShortDate(value: string, today: string = todayISO()): string {
  const date = parseISODate(value);
  if (!date) return value;
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === Number(today.slice(0, 4)) ? label : `${label} ${date.getFullYear()}`;
}

export function formatLongDate(value: string): string {
  const date = parseISODate(value);
  if (!date) return value;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Monday to Sunday of the week containing `value`. */
export function weekBounds(value: string = todayISO()): { start: string; end: string } {
  const date = parseISODate(value) ?? new Date();
  const weekday = (date.getDay() + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday + 6);
  return { start: toLocalISO(start), end: toLocalISO(end) };
}

/** Relative wording used in the review column: "today", "in 4d", "12d late". */
export function describeReview(reviewDate: string, today: string = todayISO()): string {
  const remaining = daysBetween(today, reviewDate);
  if (remaining === null) return '';
  if (remaining === 0) return 'today';
  if (remaining === 1) return 'tomorrow';
  return remaining > 0 ? `in ${remaining}d` : `${-remaining}d late`;
}

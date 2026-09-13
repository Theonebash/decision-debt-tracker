import { parseISODate, todayISO } from './dates';
import {
  DEFAULT_SORT,
  SORT_DIRECTIONS,
  SORT_KEYS,
  isDecayLevel,
  type DecisionDraft,
  type FieldErrors,
  type ListOptions,
  type Resolution,
  type Validation,
} from './model';

export const LIMITS = {
  title: 120,
  context: 2000,
  people_involved: 300,
  reason_delayed: 1000,
  outcome: 4000,
} as const;

const MAX_SEARCH_LENGTH = 200;

function text(value: unknown): string {
  // A NUL would be truncated by SQLite's own text handling, so it is dropped here.
  return typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function report(errors: FieldErrors): Validation<never> | null {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : null;
}

/**
 * Validates a draft arriving from the editor dialog or from the renderer over
 * IPC, so both paths enforce the same rules.
 */
export function validateDraft(input: unknown): Validation<DecisionDraft> {
  const source: Record<string, unknown> = isRecord(input) ? input : {};
  const errors: FieldErrors = {};

  const title = text(source.title);
  if (title === '') errors.title = 'A title is required.';
  else if (title.length > LIMITS.title) errors.title = `Keep the title under ${LIMITS.title} characters.`;

  const context = text(source.context);
  if (context === '') errors.context = 'Describe what the decision is about.';
  else if (context.length > LIMITS.context) errors.context = `Keep the context under ${LIMITS.context} characters.`;

  const people = text(source.people_involved);
  if (people.length > LIMITS.people_involved) {
    errors.people_involved = `Keep this under ${LIMITS.people_involved} characters.`;
  }

  const reason = text(source.reason_delayed);
  if (reason.length > LIMITS.reason_delayed) {
    errors.reason_delayed = `Keep this under ${LIMITS.reason_delayed} characters.`;
  }

  const review_date = text(source.review_date);
  if (review_date === '') errors.review_date = 'Set a review date.';
  else if (!parseISODate(review_date)) errors.review_date = 'Enter a real date as YYYY-MM-DD.';

  const decay_level = source.decay_level;
  if (!isDecayLevel(decay_level)) errors.decay_level = 'Choose a decay level.';

  const invalid = report(errors);
  if (invalid) return invalid;

  return {
    ok: true,
    value: {
      title,
      context,
      people_involved: people,
      reason_delayed: reason,
      review_date,
      decay_level: decay_level as DecisionDraft['decay_level'],
    },
  };
}

export function validateResolution(input: unknown): Validation<Resolution> {
  const source: Record<string, unknown> = isRecord(input) ? input : {};
  const errors: FieldErrors = {};

  const outcome = text(source.outcome);
  if (outcome === '') errors.outcome = 'Record what was decided.';
  else if (outcome.length > LIMITS.outcome) errors.outcome = `Keep the outcome under ${LIMITS.outcome} characters.`;

  const resolved_on = text(source.resolved_on) || todayISO();
  if (!parseISODate(resolved_on)) errors.resolved_on = 'Enter a real date as YYYY-MM-DD.';
  else if (resolved_on > todayISO()) errors.resolved_on = 'A decision cannot be resolved in the future.';

  const invalid = report(errors);
  if (invalid) return invalid;

  return { ok: true, value: { outcome, resolved_on } };
}

/* Narrowing for the IPC boundary. Renderer payloads arrive as `unknown`, and the values
   that reach a query or an ORDER BY clause are whitelisted here rather than trusted. */

export function toListOptions(input: unknown): ListOptions {
  const source = isRecord(input) ? input : {};
  const sort = isRecord(source.sort) ? source.sort : {};
  const key = SORT_KEYS.find((candidate) => candidate === sort.key);
  const direction = SORT_DIRECTIONS.find((candidate) => candidate === sort.direction);

  return {
    include_resolved: source.include_resolved === true,
    search: typeof source.search === 'string' ? source.search.slice(0, MAX_SEARCH_LENGTH) : '',
    // A sort is only honoured when both halves are recognised; anything else uses the default.
    sort: key !== undefined && direction !== undefined ? { key, direction } : DEFAULT_SORT,
  };
}

export function toDecisionId(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) {
    throw new Error('A valid decision id is required.');
  }
  return input;
}

export function toWeekStart(input: unknown): string {
  if (typeof input !== 'string' || !parseISODate(input)) {
    throw new Error('A week start date is required.');
  }
  return input;
}

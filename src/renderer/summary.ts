import { daysSince, formatLongDate, formatShortDate, parseISODate, toLocalISO } from '../shared/dates';
import { DECAY_LABEL, DECAY_LEVELS, type Decision, type WeeklySummary } from '../shared/model';
import { el, formatCount } from './dom';

/** "8 – 14 Sep 2026" inside one month, the full form across a month or year boundary. */
function range(summary: WeeklySummary): string {
  const start = parseISODate(summary.week_start);
  const end = parseISODate(summary.week_end);
  if (!start || !end) return `${summary.week_start} – ${summary.week_end}`;

  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()} – ${formatLongDate(summary.week_end)}`
    : `${formatLongDate(summary.week_start)} – ${formatLongDate(summary.week_end)}`;
}

function metric(value: number, label: string, overdue = false): HTMLElement {
  const block = el('div', 'metric');
  block.append(
    el('span', `metric-value${overdue ? ' is-overdue' : ''}`, String(value)),
    el('span', 'metric-label', label),
  );
  return block;
}

function section(title: string): HTMLElement {
  const block = el('section', 'summary-section');
  block.append(el('h2', undefined, title));
  return block;
}

function resolvedSection(summary: WeeklySummary, today: string): HTMLElement {
  const block = section('Resolved this week');

  if (summary.resolved_this_week.length === 0) {
    block.append(el('p', 'is-empty', 'Nothing resolved this week.'));
    return block;
  }

  const list = el('ul', 'resolved-list');
  for (const decision of summary.resolved_this_week) {
    const item = el('li', 'resolved-item');
    const date = decision.resolved_at
      ? formatShortDate(toLocalISO(new Date(decision.resolved_at)), today)
      : '—';

    const badge = el('span', `decay decay-${decision.decay_level}`);
    badge.append(el('i', 'swatch'), document.createTextNode(DECAY_LABEL[decision.decay_level]));

    item.append(el('span', 'resolved-date', date), badge, el('span', 'resolved-name', decision.title));
    list.append(item);
  }

  block.append(list);
  return block;
}

function decaySection(summary: WeeklySummary): HTMLElement {
  const block = section('Open by decay');
  const table = el('table', 'decay-table');
  const body = el('tbody');

  for (const level of [...DECAY_LEVELS].reverse()) {
    const row = el('tr');
    row.append(el('th', undefined, DECAY_LABEL[level]), el('td', undefined, String(summary.open_by_decay[level])));
    body.append(row);
  }

  table.append(body);
  block.append(table);
  return block;
}

function oldestSection(summary: WeeklySummary): HTMLElement {
  const block = section('Longest outstanding');
  const decision: Decision | null = summary.oldest_open;

  if (!decision) {
    block.append(el('p', 'is-empty', 'Nothing outstanding.'));
    return block;
  }

  const age = daysSince(decision.created_at);
  block.append(el('p', 'summary-title', decision.title));
  block.append(
    el(
      'p',
      'summary-note',
      age === null
        ? `Review ${formatLongDate(decision.review_date)}`
        : `Open ${formatCount(age, 'day')} · review ${formatLongDate(decision.review_date)}`,
    ),
  );
  return block;
}

export function renderSummary(container: HTMLElement, summary: WeeklySummary, today: string): void {
  const root = el('div', 'summary');

  const head = el('header', 'summary-head');
  head.append(el('h1', undefined, 'Weekly Summary'), el('p', 'summary-range', range(summary)));

  const metrics = el('div', 'metrics');
  metrics.append(
    metric(summary.resolved_this_week.length, 'Resolved this week'),
    metric(summary.open_count, 'Still open'),
    metric(summary.overdue_count, 'Overdue', summary.overdue_count > 0),
  );

  root.append(head, metrics, resolvedSection(summary, today), decaySection(summary), oldestSection(summary));
  container.replaceChildren(root);
}

export function renderSummaryError(container: HTMLElement, message: string): void {
  const root = el('div', 'summary');

  const head = el('header', 'summary-head');
  head.append(el('h1', undefined, 'Weekly Summary'), el('p', 'summary-range', 'Unavailable'));

  const block = section('Could not load the summary');
  block.append(el('p', 'is-empty', message));

  const retry = el('button', 'btn', 'Retry');
  retry.type = 'button';
  retry.dataset.command = 'retry-summary';

  const actions = el('div', 'placeholder-actions');
  actions.append(retry);
  block.append(actions);

  root.append(head, block);
  container.replaceChildren(root);
}

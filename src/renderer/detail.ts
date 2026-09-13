import { daysBetween, daysSince, formatLongDate, toLocalISO } from '../shared/dates';
import { DECAY_LABEL, type Decision } from '../shared/model';
import { el, formatCount } from './dom';

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['↑ ↓', 'Move through list'],
  ['Enter', 'Open decision'],
  ['Ctrl+N', 'New decision'],
  ['Ctrl+R', 'Resolve decision'],
];

function idle(): HTMLElement {
  const wrapper = el('div', 'detail-idle');
  wrapper.append(el('p', 'idle-title', 'No decision selected'));

  const list = el('dl', 'shortcuts');
  for (const [keys, description] of SHORTCUTS) {
    const row = el('div');
    row.append(el('dt', undefined, keys), el('dd', undefined, description));
    list.append(row);
  }
  wrapper.append(list);
  return wrapper;
}

function metaRow(label: string, value: string, className?: string): HTMLElement {
  const row = el('div');
  row.append(el('dt', undefined, label), el('dd', className, value));
  return row;
}

function ago(instant: string): string {
  const days = daysSince(instant);
  if (days === null) return '';
  return days === 0 ? 'today' : `${formatCount(days, 'day')} ago`;
}

function reviewRow(decision: Decision, today: string): HTMLElement {
  const date = formatLongDate(decision.review_date);
  if (decision.status === 'resolved') return metaRow('Review', date);

  const remaining = daysBetween(today, decision.review_date);
  if (remaining === null) return metaRow('Review', date);
  if (remaining === 0) return metaRow('Review', `${date} · today`);
  if (remaining === 1) return metaRow('Review', `${date} · tomorrow`);

  return remaining > 0
    ? metaRow('Review', `${date} · in ${formatCount(remaining, 'day')}`)
    : metaRow('Review', `${date} · ${formatCount(-remaining, 'day')} overdue`, 'is-overdue');
}

function section(title: string, body: string, emptyWording: string): HTMLElement {
  const block = el('section', 'detail-section');
  block.append(el('h3', undefined, title));

  const text = body.trim();
  block.append(
    text === '' ? el('p', 'is-empty', emptyWording) : el('p', undefined, text),
  );
  return block;
}

function actions(decision: Decision): HTMLElement {
  const bar = el('div', 'detail-actions');

  const edit = el('button', 'btn', 'Edit');
  edit.type = 'button';
  edit.dataset.command = 'edit';
  bar.append(edit);

  const secondary = el('button', 'btn', decision.status === 'open' ? 'Resolve…' : 'Delete');
  secondary.type = 'button';

  if (decision.status === 'open') {
    secondary.classList.add('btn-primary');
    secondary.dataset.command = 'resolve';
  } else {
    secondary.dataset.command = 'delete';
  }

  bar.append(secondary);
  return bar;
}

function detail(decision: Decision, today: string): HTMLElement {
  const wrapper = el('div', 'detail-inner');

  const head = el('div', 'detail-head');
  const badge = el('span', `decay decay-${decision.decay_level}`);
  badge.append(el('i', 'swatch'), document.createTextNode(`${DECAY_LABEL[decision.decay_level]} decay`));
  head.append(badge, el('h2', 'detail-title', decision.title));

  const meta = el('dl', 'detail-meta');
  meta.append(reviewRow(decision, today));

  const created = toLocalISO(new Date(decision.created_at));
  const age = ago(decision.created_at);
  meta.append(metaRow('Captured', age === '' ? formatLongDate(created) : `${formatLongDate(created)} · ${age}`, 'is-mono'));

  if (decision.status === 'resolved' && decision.resolved_at) {
    const closed = toLocalISO(new Date(decision.resolved_at));
    const since = ago(decision.resolved_at);
    meta.append(metaRow('Resolved', since === '' ? formatLongDate(closed) : `${formatLongDate(closed)} · ${since}`, 'is-mono'));
  }

  meta.append(metaRow('People', decision.people_involved.trim() === '' ? '—' : decision.people_involved));

  wrapper.append(head, meta);
  wrapper.append(section('Context', decision.context, 'Not recorded.'));
  wrapper.append(section('Why delayed', decision.reason_delayed, 'Not recorded.'));

  if (decision.status === 'resolved') {
    wrapper.append(section('Outcome', decision.outcome, 'Not recorded.'));
  }

  wrapper.append(actions(decision));
  return wrapper;
}

export function renderDetail(container: HTMLElement, decision: Decision | null, today: string): void {
  container.replaceChildren(decision ? detail(decision, today) : idle());
}

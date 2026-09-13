import {
  daysBetween,
  daysSince,
  describeReview,
  formatLongDate,
  formatShortDate,
  isOverdue,
  toLocalISO,
} from '../shared/dates';
import { DECAY_LABEL, type Decision } from '../shared/model';
import { el, formatCount } from './dom';

const PREVIEW_LENGTH = 110;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function preview(context: string): string {
  const flat = collapse(context);
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}

/** The second line of a row: who is affected, and enough context to recognise it. */
function subLine(decision: Decision, today: string): string {
  const parts: string[] = [];
  if (decision.status === 'resolved' && decision.resolved_at) {
    const closed = toLocalISO(new Date(decision.resolved_at));
    parts.push(`Resolved ${formatShortDate(closed, today)}`);
  }
  if (decision.people_involved.trim() !== '') parts.push(collapse(decision.people_involved));
  parts.push(preview(decision.context));
  return parts.join(' · ');
}

/** How long the decision was outstanding. Null when the record cannot express it. */
function ageInDays(decision: Decision): number | null {
  if (decision.status === 'resolved' && decision.resolved_at) {
    const days = daysBetween(
      toLocalISO(new Date(decision.created_at)),
      toLocalISO(new Date(decision.resolved_at)),
    );
    // A decision captured after it was actually settled has no meaningful outstanding age.
    return days !== null && days >= 0 ? days : null;
  }
  return daysSince(decision.created_at);
}

function ageCell(decision: Decision): HTMLElement {
  const days = ageInDays(decision);
  const cell = el('span', 'row-age', days === null ? '—' : `${days}d`);
  if (days === null) return cell;

  const recorded = formatLongDate(toLocalISO(new Date(decision.created_at)));
  cell.title =
    decision.status === 'resolved'
      ? `Resolved after ${formatCount(days, 'day')}. Recorded ${recorded}.`
      : `Open for ${formatCount(days, 'day')}, since ${recorded}.`;
  return cell;
}

function decayBadge(decision: Decision): HTMLElement {
  const badge = el('span', `decay decay-${decision.decay_level}`);
  badge.append(el('i', 'swatch'), document.createTextNode(DECAY_LABEL[decision.decay_level]));
  return badge;
}

function buildRow(decision: Decision, selected: boolean, today: string): HTMLElement {
  const overdue = decision.status === 'open' && isOverdue(decision.review_date, today);
  const classes = ['row'];
  if (overdue) classes.push('is-overdue');
  if (decision.status === 'resolved') classes.push('is-resolved');
  if (selected) classes.push('is-selected');

  const node = el('div', classes.join(' '));
  node.id = `row-${decision.id}`;
  node.dataset.id = String(decision.id);
  node.setAttribute('role', 'option');
  node.setAttribute('aria-selected', selected ? 'true' : 'false');

  const title = el('div', 'row-title');
  title.append(el('span', 'row-name', decision.title), el('span', 'row-sub', subLine(decision, today)));

  node.append(el('span', `row-rail decay-${decision.decay_level}`), title, decayBadge(decision));
  node.append(el('span', `row-review${overdue ? ' is-overdue' : ''}`, formatShortDate(decision.review_date, today)));

  if (decision.status === 'resolved') {
    node.append(el('span', 'row-due', 'resolved'));
  } else {
    const wording = describeReview(decision.review_date, today);
    const state = overdue ? ' is-overdue' : wording === 'today' ? ' is-today' : '';
    node.append(el('span', `row-due${state}`, wording));
  }

  node.append(ageCell(decision));
  return node;
}

export function renderList(
  container: HTMLElement,
  decisions: Decision[],
  selectedId: number | null,
  today: string,
): void {
  container.replaceChildren(...decisions.map((decision) => buildRow(decision, decision.id === selectedId, today)));
  applySelection(container, selectedId);
}

/**
 * Moves the selection without rebuilding the rows. Replacing them on every click would
 * destroy the node the second click of a double click lands on, so no dblclick would fire.
 */
export function applySelection(container: HTMLElement, selectedId: number | null): void {
  for (const row of container.querySelectorAll<HTMLElement>('.row')) {
    const selected = row.dataset.id === String(selectedId);
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
  }

  if (selectedId !== null && container.querySelector(`#row-${selectedId}`)) {
    container.setAttribute('aria-activedescendant', `row-${selectedId}`);
  } else {
    container.removeAttribute('aria-activedescendant');
  }
}

/** Keeps a sensible selection after the list changes under the user. */
export function resolveSelection(
  decisions: Decision[],
  selectedId: number | null,
  previousIndex: number,
): number | null {
  if (decisions.length === 0) return null;
  if (selectedId !== null && decisions.some((decision) => decision.id === selectedId)) return selectedId;

  const index = Math.min(Math.max(previousIndex, 0), decisions.length - 1);
  return decisions[index]?.id ?? null;
}

import { todayISO, weekBounds } from '../shared/dates';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  type Decision,
  type ListOptions,
  type MenuCommand,
  type SortKey,
  type Stats,
} from '../shared/model';
import { renderDetail } from './detail';
import { clear, el, errorMessage, formatCount, requireElement } from './dom';
import { createEditorDialog } from './editor';
import { renderList, applySelection, resolveSelection } from './list';
import { createResolveDialog } from './resolve';
import { renderSummary, renderSummaryError } from './summary';

const SEARCH_DEBOUNCE_MS = 120;
const MIN_DETAIL_WIDTH = 300;
const MAX_DETAIL_WIDTH = 640;
const DETAIL_WIDTH_SHARE = 0.6;
const SPLITTER_STEP = 16;

const SORT_DESCRIPTION: Record<SortKey, string> = {
  decay: 'Sorted by decay, then review date',
  review: 'Sorted by review date',
  title: 'Sorted by title',
};

type ViewName = 'open' | 'summary';

interface Placeholder {
  title: string;
  text?: string;
  action?: { label: string; command: string; primary?: boolean };
  error?: boolean;
}

const dom = {
  app: requireElement<HTMLElement>('.app'),
  openView: requireElement<HTMLElement>('#view-open'),
  summaryView: requireElement<HTMLElement>('#view-summary'),
  list: requireElement<HTMLElement>('#decision-list'),
  placeholder: requireElement<HTMLElement>('#list-empty'),
  detail: requireElement<HTMLElement>('#detail'),
  search: requireElement<HTMLInputElement>('#search'),
  showResolved: requireElement<HTMLInputElement>('#show-resolved'),
  statusCounts: requireElement<HTMLElement>('#status-counts'),
  statusNote: requireElement<HTMLElement>('#status-note'),
  toolbarNote: requireElement<HTMLElement>('#toolbar-note'),
  splitter: requireElement<HTMLElement>('#splitter'),
  editButton: requireElement<HTMLButtonElement>('#btn-edit'),
  resolveButton: requireElement<HTMLButtonElement>('#btn-resolve'),
  deleteButton: requireElement<HTMLButtonElement>('#btn-delete'),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
  sortHeaders: Array.from(document.querySelectorAll<HTMLButtonElement>('button.col[data-sort]')),
};

const state = {
  view: 'open' as ViewName,
  include_resolved: false,
  search: '',
  sort: { ...DEFAULT_SORT },
  decisions: [] as Decision[],
  selectedId: null as number | null,
  stats: { open_count: 0, overdue_count: 0, resolved_count: 0 } as Stats,
  loaded: false,
  error: null as string | null,
};

function selected(): Decision | null {
  return state.decisions.find((decision) => decision.id === state.selectedId) ?? null;
}

function selectedIndex(): number {
  const index = state.decisions.findIndex((decision) => decision.id === state.selectedId);
  return index < 0 ? 0 : index;
}

/* ---------- rendering ---------- */

function placeholderContent(): Placeholder | null {
  if (state.decisions.length > 0) return null;

  if (state.error !== null) {
    return { title: 'Could not load decisions', text: state.error, action: { label: 'Retry', command: 'retry' }, error: true };
  }
  if (!state.loaded) return { title: 'Loading decisions…' };

  if (state.stats.open_count + state.stats.resolved_count === 0) {
    return {
      title: 'No decisions recorded',
      text: 'Every postponed decision has a cost. Record the first one so the delay stops being invisible.',
      action: { label: 'New Decision', command: 'new', primary: true },
    };
  }
  if (state.search !== '') {
    return {
      title: 'No matches',
      text: `Nothing matches “${state.search}”.`,
      action: { label: 'Clear search', command: 'clear-search' },
    };
  }
  // With the resolved filter off and rows already counted, everything left must be resolved.
  if (!state.include_resolved) {
    return { title: 'Nothing open', text: 'All recorded decisions are resolved.' };
  }
  return null;
}

function renderPlaceholder(): void {
  const content = placeholderContent();

  if (!content) {
    dom.placeholder.hidden = true;
    dom.list.hidden = false;
    clear(dom.placeholder);
    return;
  }

  const inner = el('div', 'placeholder-inner');
  inner.append(el('p', 'placeholder-title', content.title));
  if (content.text) inner.append(el('p', 'placeholder-text', content.text));

  if (content.action) {
    const button = el('button', `btn${content.action.primary ? ' btn-primary' : ''}`, content.action.label);
    button.type = 'button';
    button.dataset.command = content.action.command;

    const actions = el('div', 'placeholder-actions');
    actions.append(button);
    inner.append(actions);
  }

  dom.placeholder.classList.toggle('is-error', content.error === true);
  dom.placeholder.replaceChildren(inner);
  dom.placeholder.hidden = false;
  dom.list.hidden = true;
}

function renderStatus(): void {
  dom.statusCounts.replaceChildren(
    document.createTextNode(`${state.stats.open_count} open · `),
    el('span', state.stats.overdue_count > 0 ? 'is-overdue' : undefined, `${state.stats.overdue_count} overdue`),
    document.createTextNode(` · ${state.stats.resolved_count} resolved`),
  );

  // The sort order only describes the decisions list, so it is not shown over the summary.
  dom.statusNote.textContent =
    state.error ?? (state.view === 'open' ? SORT_DESCRIPTION[state.sort.key] : '');
}

function syncToolbar(): void {
  const decision = selected();
  const actionable = decision !== null && state.view === 'open';

  dom.editButton.disabled = !actionable;
  dom.resolveButton.disabled = !actionable || decision?.status === 'resolved';
  dom.deleteButton.disabled = !actionable;

  dom.toolbarNote.textContent =
    state.search === '' ? '' : formatCount(state.decisions.length, 'match', 'matches');
}

function syncSortHeaders(): void {
  for (const header of dom.sortHeaders) {
    const key = SORT_KEYS.find((candidate) => candidate === header.dataset.sort);
    if (!key) continue;

    const active = key === state.sort.key;
    const mark = header.querySelector('.sort-mark');
    if (mark) mark.textContent = active ? (state.sort.direction === 'desc' ? '▼' : '▲') : '';

    header.setAttribute(
      'aria-sort',
      active ? (state.sort.direction === 'desc' ? 'descending' : 'ascending') : 'none',
    );
  }
}

function render(): void {
  renderList(dom.list, state.decisions, state.selectedId, todayISO());
  renderDetail(dom.detail, selected(), todayISO());
  renderPlaceholder();
  renderStatus();
  syncToolbar();
  syncSortHeaders();

  const focus = document.activeElement;
  if (state.view === 'open' && (focus === null || focus === document.body)) dom.list.focus();
}

/* ---------- data ---------- */

async function refresh(): Promise<void> {
  const previousIndex = selectedIndex();

  try {
    const options: ListOptions = {
      include_resolved: state.include_resolved,
      search: state.search,
      sort: state.sort,
    };
    const [decisions, stats] = await Promise.all([
      window.ddt.listDecisions(options),
      window.ddt.getStats(),
    ]);

    state.decisions = decisions;
    state.stats = stats;
    state.loaded = true;
    state.error = null;
    state.selectedId = resolveSelection(decisions, state.selectedId, previousIndex);
  } catch (error) {
    state.error = errorMessage(error);
  }

  render();
  scrollSelectionIntoView();
}

async function loadSummary(): Promise<void> {
  try {
    const summary = await window.ddt.getWeeklySummary(weekBounds(todayISO()).start);
    renderSummary(dom.summaryView, summary, todayISO());
  } catch (error) {
    renderSummaryError(dom.summaryView, errorMessage(error));
  }
}

function scrollSelectionIntoView(): void {
  if (state.selectedId === null) return;
  dom.list.querySelector(`#row-${state.selectedId}`)?.scrollIntoView({ block: 'nearest' });
}

/* ---------- selection and views ---------- */

function select(id: number | null): void {
  state.selectedId = id;
  applySelection(dom.list, id);
  renderDetail(dom.detail, selected(), todayISO());
  syncToolbar();
  scrollSelectionIntoView();
}

function selectAt(index: number): void {
  const decision = state.decisions[index];
  if (decision) select(decision.id);
}

function setView(view: ViewName): void {
  state.view = view;
  dom.openView.hidden = view !== 'open';
  dom.summaryView.hidden = view !== 'summary';

  for (const tab of dom.tabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  syncToolbar();
  renderStatus();

  if (view === 'summary') void loadSummary();
  else dom.list.focus();
}

function applySort(key: SortKey): void {
  state.sort =
    state.sort.key === key
      ? { key, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'decay' ? 'desc' : 'asc' };

  void refresh();
}

/* ---------- commands ---------- */

const editor = createEditorDialog({
  onSaved: (decision) => {
    state.selectedId = decision.id;
    void reload();
  },
});

const resolve = createResolveDialog({
  onResolved: () => {
    void reload();
  },
});

/** Re-reads whichever view is on screen, so a mutation never leaves the summary stale. */
async function reload(): Promise<void> {
  await refresh();
  if (state.view === 'summary') await loadSummary();
}

/** These act on the list selection, which is not visible from the summary view. */
function openEditorForSelection(): void {
  const decision = selected();
  if (state.view === 'open' && decision) editor.openEdit(decision);
}

function openResolveForSelection(): void {
  const decision = selected();
  if (state.view === 'open' && decision?.status === 'open') resolve.open(decision);
}

async function deleteSelected(): Promise<void> {
  const decision = selected();
  if (state.view !== 'open' || !decision) return;

  try {
    if (await window.ddt.deleteDecision(decision.id)) await reload();
  } catch (error) {
    state.error = errorMessage(error);
    render();
  }
}

/** Actions triggered from the interface itself, via `data-command`. */
function runCommand(command: string): void {
  switch (command) {
    case 'new':
      editor.openCreate();
      return;
    case 'edit':
      openEditorForSelection();
      return;
    case 'resolve':
      openResolveForSelection();
      return;
    case 'delete':
      void deleteSelected();
      return;
    case 'retry':
      state.error = null;
      state.loaded = false;
      void refresh();
      return;
    case 'retry-summary':
      void loadSummary();
      return;
    case 'clear-search':
      dom.search.value = '';
      state.search = '';
      void refresh();
      return;
    default:
      return;
  }
}

/** Actions triggered from the native menu and its accelerators. */
function runMenuCommand(command: MenuCommand): void {
  if (editor.isOpen() || resolve.isOpen()) return;

  switch (command) {
    case 'new':
      editor.openCreate();
      return;
    case 'edit':
      openEditorForSelection();
      return;
    case 'resolve':
      openResolveForSelection();
      return;
    case 'delete':
      void deleteSelected();
      return;
    case 'focus-search':
      if (state.view !== 'open') setView('open');
      dom.search.focus();
      dom.search.select();
      return;
    case 'toggle-resolved':
      dom.showResolved.checked = !dom.showResolved.checked;
      state.include_resolved = dom.showResolved.checked;
      void refresh();
      return;
    case 'view-open':
      setView('open');
      return;
    case 'view-summary':
      setView('summary');
      return;
  }
}

/* ---------- events ---------- */

function rowIdFrom(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>('.row');
  const raw = row?.dataset.id;
  return raw === undefined ? null : Number(raw);
}

function wireEvents(): void {
  dom.app.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest<HTMLElement>('[data-command]');
    if (!trigger) return;
    if (trigger instanceof HTMLButtonElement && trigger.disabled) return;

    const command = trigger.dataset.command;
    if (command) runCommand(command);
  });

  dom.list.addEventListener('click', (event) => {
    const id = rowIdFrom(event.target);
    if (id === null) return;
    select(id);
    dom.list.focus();
  });

  dom.list.addEventListener('dblclick', (event) => {
    const id = rowIdFrom(event.target);
    if (id === null) return;
    select(id);
    openEditorForSelection();
  });

  dom.list.addEventListener('keydown', (event) => {
    const count = state.decisions.length;
    if (count === 0) return;
    const current = state.decisions.findIndex((decision) => decision.id === state.selectedId);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectAt(Math.min(current + 1, count - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        selectAt(current <= 0 ? 0 : current - 1);
        return;
      case 'Home':
        event.preventDefault();
        selectAt(0);
        return;
      case 'End':
        event.preventDefault();
        selectAt(count - 1);
        return;
      case 'Enter':
        event.preventDefault();
        openEditorForSelection();
        return;
      case 'Delete':
        event.preventDefault();
        void deleteSelected();
        return;
      default:
        return;
    }
  });

  let searchTimer: number | undefined;
  dom.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = dom.search.value.trim();
      void refresh();
    }, SEARCH_DEBOUNCE_MS);
  });

  dom.search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || dom.search.value === '') return;
    event.preventDefault();
    dom.search.value = '';
    state.search = '';
    void refresh();
  });

  dom.showResolved.addEventListener('change', () => {
    state.include_resolved = dom.showResolved.checked;
    void refresh();
  });

  for (const tab of dom.tabs) {
    tab.addEventListener('click', () => {
      const target = tab.dataset.view;
      if (target === 'open' || target === 'summary') setView(target);
    });
  }

  for (const header of dom.sortHeaders) {
    header.addEventListener('click', () => {
      const key = SORT_KEYS.find((candidate) => candidate === header.dataset.sort);
      if (key) applySort(key);
    });
  }

  wireSplitter();
}

function currentDetailWidth(): number {
  return dom.detail.getBoundingClientRect().width;
}

function setDetailWidth(width: number): void {
  const clamped = Math.min(Math.max(Math.round(width), MIN_DETAIL_WIDTH), MAX_DETAIL_WIDTH);
  dom.openView.style.setProperty('--detail-width', `${clamped}px`);
}

function wireSplitter(): void {
  dom.splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    const startX = event.clientX;
    const startWidth = currentDetailWidth();
    dom.splitter.setPointerCapture(event.pointerId);
    dom.splitter.classList.add('is-dragging');

    const move = (moveEvent: PointerEvent) => setDetailWidth(startWidth - (moveEvent.clientX - startX));
    const end = () => {
      dom.splitter.classList.remove('is-dragging');
      dom.splitter.removeEventListener('pointermove', move);
      dom.splitter.removeEventListener('pointerup', end);
      dom.splitter.removeEventListener('pointercancel', end);
    };

    dom.splitter.addEventListener('pointermove', move);
    dom.splitter.addEventListener('pointerup', end);
    dom.splitter.addEventListener('pointercancel', end);
  });

  dom.splitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setDetailWidth(currentDetailWidth() + SPLITTER_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setDetailWidth(currentDetailWidth() - SPLITTER_STEP);
    }
  });

  window.addEventListener('resize', () => {
    const available = dom.openView.getBoundingClientRect().width;
    if (available > 0) setDetailWidth(Math.min(currentDetailWidth(), available * DETAIL_WIDTH_SHARE));
  });
}

/* ---------- start ---------- */

render();
setView('open');
wireEvents();
window.ddt.onMenuCommand(runMenuCommand);
void refresh();

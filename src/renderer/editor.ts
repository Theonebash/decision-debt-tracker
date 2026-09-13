import { toISODate } from '../shared/dates';
import { isDecayLevel, type Decision, type DecisionDraft, type FieldErrors } from '../shared/model';
import { validateDraft } from '../shared/validation';
import { errorMessage, requireElement, trapFocus } from './dom';

export interface EditorDialog {
  openCreate(): void;
  openEdit(decision: Decision): void;
  isOpen(): boolean;
}

export interface EditorOptions {
  onSaved(decision: Decision): void;
}

/** A week is a reasonable first guess at when a fresh decision should come back up. */
const REVIEW_LEAD_DAYS = 7;

const FIELDS = ['title', 'context', 'people_involved', 'reason_delayed', 'review_date', 'decay_level'] as const;
type FieldName = (typeof FIELDS)[number];

export function createEditorDialog(options: EditorOptions): EditorDialog {
  const root = requireElement<HTMLElement>('#editor-dialog');
  const form = requireElement<HTMLFormElement>('#editor-form');
  const heading = requireElement<HTMLElement>('#editor-title');
  const note = requireElement<HTMLElement>('#editor-note');
  const save = requireElement<HTMLButtonElement>('#editor-save');
  const cancel = requireElement<HTMLButtonElement>('#editor-cancel');

  const inputs = {
    title: requireElement<HTMLInputElement>('#f-title'),
    context: requireElement<HTMLTextAreaElement>('#f-context'),
    people_involved: requireElement<HTMLInputElement>('#f-people'),
    reason_delayed: requireElement<HTMLInputElement>('#f-reason'),
    review_date: requireElement<HTMLInputElement>('#f-review-date'),
    decay_level: requireElement<HTMLSelectElement>('#f-decay'),
  };

  let editingId: number | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let busy = false;

  function fieldWrapper(name: FieldName): HTMLElement {
    const wrapper = form.querySelector<HTMLElement>(`.field[data-field="${name}"]`);
    if (!wrapper) throw new Error(`Missing field in the editor form: ${name}`);
    return wrapper;
  }

  function errorSlot(name: FieldName): HTMLElement {
    const slot = fieldWrapper(name).querySelector<HTMLElement>('.field-error');
    if (!slot) throw new Error(`Missing error slot in the editor form: ${name}`);
    return slot;
  }

  function clearFieldError(name: FieldName): void {
    fieldWrapper(name).classList.remove('has-error');
    errorSlot(name).textContent = '';
  }

  function clearErrors(): void {
    for (const name of FIELDS) clearFieldError(name);
  }

  function showErrors(errors: FieldErrors): void {
    clearErrors();
    let firstInvalid: HTMLElement | null = null;

    for (const name of FIELDS) {
      const message = errors[name];
      if (!message) continue;

      fieldWrapper(name).classList.add('has-error');
      errorSlot(name).textContent = message;
      firstInvalid ??= inputs[name];
    }

    firstInvalid?.focus();
  }

  function readDraft(): DecisionDraft {
    const decay = inputs.decay_level.value;
    return {
      title: inputs.title.value,
      context: inputs.context.value,
      people_involved: inputs.people_involved.value,
      reason_delayed: inputs.reason_delayed.value,
      review_date: inputs.review_date.value,
      decay_level: isDecayLevel(decay) ? decay : 'medium',
    };
  }

  function defaultReviewDate(): string {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + REVIEW_LEAD_DAYS);
    return toISODate(next.getFullYear(), next.getMonth() + 1, next.getDate());
  }

  function open(decision: Decision | null): void {
    editingId = decision?.id ?? null;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    clearErrors();
    form.reset();

    if (decision) {
      inputs.title.value = decision.title;
      inputs.context.value = decision.context;
      inputs.people_involved.value = decision.people_involved;
      inputs.reason_delayed.value = decision.reason_delayed;
      inputs.review_date.value = decision.review_date;
      inputs.decay_level.value = decision.decay_level;
      heading.textContent = 'Edit Decision';
      note.textContent = decision.title;
      save.textContent = 'Save Changes';
    } else {
      inputs.review_date.value = defaultReviewDate();
      inputs.decay_level.value = 'medium';
      heading.textContent = 'New Decision';
      note.textContent = 'Record a decision you are postponing.';
      save.textContent = 'Save Decision';
    }

    root.hidden = false;
    inputs.title.focus();
    inputs.title.select();
  }

  function close(): void {
    // A commit is already on its way to the database; closing now would misreport it as discarded.
    if (busy) return;

    root.hidden = true;
    editingId = null;

    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    previouslyFocused = null;
  }

  async function commit(): Promise<void> {
    if (busy) return;

    const validated = validateDraft(readDraft());
    if (!validated.ok) {
      showErrors(validated.errors);
      return;
    }

    busy = true;
    save.disabled = true;

    try {
      const result =
        editingId === null
          ? await window.ddt.createDecision(validated.value)
          : await window.ddt.updateDecision(editingId, validated.value);

      if (!result.ok) {
        showErrors(result.errors);
        return;
      }

      const saved = result.decision;
      busy = false;
      close();
      options.onSaved(saved);
    } catch (error) {
      note.textContent = errorMessage(error);
    } finally {
      busy = false;
      save.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void commit();
  });

  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Enter belongs to a textarea unless the modifier asks for the form to be saved.
    if (event.target instanceof HTMLTextAreaElement && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void commit();
  });

  for (const name of FIELDS) {
    inputs[name].addEventListener('input', () => clearFieldError(name));
    inputs[name].addEventListener('change', () => clearFieldError(name));
  }

  cancel.addEventListener('click', () => close());

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(root, event);
  });

  return {
    openCreate: () => open(null),
    openEdit: (decision: Decision) => open(decision),
    isOpen: () => !root.hidden,
  };
}

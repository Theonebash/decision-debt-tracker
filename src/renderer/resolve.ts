import { todayISO } from '../shared/dates';
import type { Decision, FieldErrors, Resolution } from '../shared/model';
import { validateResolution } from '../shared/validation';
import { errorMessage, requireElement, trapFocus } from './dom';

export interface ResolveDialog {
  open(decision: Decision): void;
  isOpen(): boolean;
}

export interface ResolveOptions {
  onResolved(decision: Decision): void;
}

const FIELDS = ['outcome', 'resolved_on'] as const;
type FieldName = (typeof FIELDS)[number];

export function createResolveDialog(options: ResolveOptions): ResolveDialog {
  const root = requireElement<HTMLElement>('#resolve-dialog');
  const form = requireElement<HTMLFormElement>('#resolve-form');
  const note = requireElement<HTMLElement>('#resolve-note');
  const confirm = requireElement<HTMLButtonElement>('#resolve-confirm');
  const cancel = requireElement<HTMLButtonElement>('#resolve-cancel');

  const inputs = {
    outcome: requireElement<HTMLTextAreaElement>('#f-outcome'),
    resolved_on: requireElement<HTMLInputElement>('#f-resolved-on'),
  };

  let target: Decision | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let busy = false;

  function fieldWrapper(name: FieldName): HTMLElement {
    const wrapper = form.querySelector<HTMLElement>(`.field[data-field="${name}"]`);
    if (!wrapper) throw new Error(`Missing field in the resolve form: ${name}`);
    return wrapper;
  }

  function errorSlot(name: FieldName): HTMLElement {
    const slot = fieldWrapper(name).querySelector<HTMLElement>('.field-error');
    if (!slot) throw new Error(`Missing error slot in the resolve form: ${name}`);
    return slot;
  }

  function clearFieldError(name: FieldName): void {
    fieldWrapper(name).classList.remove('has-error');
    errorSlot(name).textContent = '';
  }

  function showErrors(errors: FieldErrors): void {
    for (const name of FIELDS) clearFieldError(name);
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

  function open(decision: Decision): void {
    target = decision;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    for (const name of FIELDS) clearFieldError(name);
    form.reset();
    inputs.resolved_on.value = todayISO();
    inputs.resolved_on.max = todayISO();
    note.textContent = decision.title;

    root.hidden = false;
    inputs.outcome.focus();
  }

  function close(): void {
    // A commit is already on its way to the database; closing now would misreport it as discarded.
    if (busy) return;

    root.hidden = true;
    target = null;

    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    previouslyFocused = null;
  }

  async function commit(): Promise<void> {
    if (busy || !target) return;

    const resolution: Resolution = {
      outcome: inputs.outcome.value,
      resolved_on: inputs.resolved_on.value,
    };

    const validated = validateResolution(resolution);
    if (!validated.ok) {
      showErrors(validated.errors);
      return;
    }

    busy = true;
    confirm.disabled = true;

    try {
      const result = await window.ddt.resolveDecision(target.id, validated.value);
      if (!result.ok) {
        showErrors(result.errors);
        return;
      }

      const resolved = result.decision;
      busy = false;
      close();
      options.onResolved(resolved);
    } catch (error) {
      note.textContent = errorMessage(error);
    } finally {
      busy = false;
      confirm.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void commit();
  });

  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
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
    open,
    isOpen: () => !root.hidden,
  };
}

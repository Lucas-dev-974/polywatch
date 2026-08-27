import { createSignal, Show } from 'solid-js';
import { validateIntervalJsonMap } from './settings/crypto-algo-settings-types';

export interface JsonIntervalMapFieldProps {
  label: string;
  hint?: string;
  placeholder: string;
  value: Record<string, unknown> | null;
  valueKind: 'number' | 'seconds' | 'exit';
  onChange: (value: Record<string, unknown> | null) => void;
  /** Notifies parent when draft validity changes (C7.5 — block save). */
  onValidityChange?: (valid: boolean) => void;
}

export function JsonIntervalMapField(props: JsonIntervalMapFieldProps) {
  const [parseError, setParseError] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<string | null>(null);

  const displayValue = () => {
    if (draft() != null) return draft()!;
    if (props.value == null) return '';
    if (typeof props.value === 'object' && Object.keys(props.value).length === 0) {
      return '';
    }
    return JSON.stringify(props.value, null, 2);
  };

  function setValidity(valid: boolean) {
    props.onValidityChange?.(valid);
  }

  function handleInput(raw: string) {
    setDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === '') {
      setParseError(null);
      setValidity(true);
      props.onChange(null);
      return;
    }
    const { value, error } = validateIntervalJsonMap(trimmed, props.valueKind);
    if (error) {
      setParseError(error);
      setValidity(false);
      return;
    }
    setParseError(null);
    setDraft(null);
    setValidity(true);
    props.onChange(value as Record<string, unknown> | null);
  }

  function resetToDefaults() {
    setParseError(null);
    setDraft(null);
    setValidity(true);
    props.onChange(null);
  }

  return (
    <div class="form-field">
      <label>{props.label}</label>
      <textarea
        class="input"
        rows={6}
        spellcheck={false}
        placeholder={props.placeholder}
        value={displayValue()}
        onInput={(e) => handleInput(e.currentTarget.value)}
      />
      <Show when={props.hint}>
        <p class="form-hint">{props.hint}</p>
      </Show>
      <Show when={parseError()}>
        <p class="form-error">{parseError()}</p>
      </Show>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        style="margin-top: 0.5rem;"
        onClick={resetToDefaults}
      >
        Réinitialiser aux defaults
      </button>
    </div>
  );
}

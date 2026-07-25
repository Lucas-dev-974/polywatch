import { For } from 'solid-js';
import {
  type ClobCredentialsForm,
  type ClobCredentialsStatus,
  type ClobFieldConfig,
  isCredFieldSaved,
} from '../lib/clob-credentials';
import { CredField } from './CredField';

interface CredsFieldListProps {
  fields: ClobFieldConfig[];
  creds: ClobCredentialsForm;
  existing: ClobCredentialsStatus | null;
  onFieldChange: (key: keyof ClobCredentialsForm, value: string) => void;
}

export function CredsFieldList(props: CredsFieldListProps) {
  return (
    <For each={props.fields}>
      {(field) => (
        <CredField
          label={field.label}
          placeholder={field.placeholder}
          value={props.creds[field.key]}
          type={field.type}
          hintId={field.hintId}
          saved={isCredFieldSaved(props.existing, field.statusKey)}
          onInput={(v) => props.onFieldChange(field.key, v)}
        />
      )}
    </For>
  );
}

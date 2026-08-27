import { createEffect, createSignal, on, Show } from 'solid-js';
import { fetchGlobalConfig, updateGlobalConfig } from '../api';
import type { EnvSettings } from './settings/env-settings-types';
import { Dialog } from './Dialog';
import { SimAutoSnapshotSection } from './settings/settings-fields';

interface Props {
  open: boolean;
  onClose: () => void;
}

type SnapshotSettings = Pick<
  EnvSettings,
  | 'simAutoSnapshotEnabled'
  | 'simAutoSnapshotIntervalSeconds'
  | 'simSnapshotMaxCount'
  | 'simSnapshotRetentionDays'
>;

export function SimSnapshotSettingsDialog(props: Props) {
  const [settings, setSettings] = createSignal<SnapshotSettings | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load() {
    try {
      const config = await fetchGlobalConfig();
      setSettings({
        simAutoSnapshotEnabled: config.simAutoSnapshotEnabled,
        simAutoSnapshotIntervalSeconds: config.simAutoSnapshotIntervalSeconds,
        simSnapshotMaxCount: config.simSnapshotMaxCount,
        simSnapshotRetentionDays: config.simSnapshotRetentionDays,
      });
      setError(null);
    } catch {
      setError('Impossible de charger la configuration.');
    }
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setError(null);
        void load();
      },
    ),
  );

  function patch(patch: Partial<SnapshotSettings>) {
    const current = settings();
    if (!current) return;
    setSettings({ ...current, ...patch });
  }

  async function save() {
    const current = settings();
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      await updateGlobalConfig(current as unknown as Record<string, unknown>);
      props.onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Échec de l'enregistrement : ${err.message}`
          : "Échec de l'enregistrement.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="Configuration des snapshots"
      titleId="sim-snapshot-settings-title"
      class="dialog-settings"
      bodyClass="dialog-body-settings"
    >
      <Show
        when={settings()}
        fallback={<div class="empty-state">Chargement…</div>}
      >
        {(s) => (
          <div class="form-stack">
            <p class="form-hint settings-intro">
              Snapshots automatiques périodiques de l’état simulation (config,
              traders, positions, exécutions).
            </p>
            <SimAutoSnapshotSection
              config={s() as EnvSettings}
              onChange={(changes) => patch(changes)}
            />
            <Show when={error()}>
              <p class="form-error">{error()}</p>
            </Show>
            <div class="dialog-actions">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onClick={() => props.onClose()}
              >
                Annuler
              </button>
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={saving()}
                onClick={() => void save()}
              >
                {saving() ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

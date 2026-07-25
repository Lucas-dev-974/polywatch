import { For } from 'solid-js';

import type { PnlSummary } from '../../lib/position';
import { PositionPnlSummary } from './PositionPnlSummary';

export type PositionTab = 'open' | 'redemption' | 'failed' | 'history';

const COUNT_LABELS: Record<PositionTab, (count: number) => string> = {
  open: (n) => `${n} ouverte${n !== 1 ? 's' : ''}`,
  redemption: (n) => `${n} en attente`,
  failed: (n) => `${n} échouée${n !== 1 ? 's' : ''}`,
  history: (n) => `${n} clôturée${n !== 1 ? 's' : ''}`,
};

export function positionCountLabel(
  tab: PositionTab,
  openCount: number,
  redemptionCount: number,
  failedCount: number,
  closedCount: number,
): string {
  const count =
    tab === 'open'
      ? openCount
      : tab === 'redemption'
        ? redemptionCount
        : tab === 'failed'
          ? failedCount
          : closedCount;
  return COUNT_LABELS[tab](count);
}

const TABS: ReadonlyArray<{ id: PositionTab; label: string }> = [
  { id: 'open', label: 'Ouvertes' },
  { id: 'redemption', label: 'Attente rédemption' },
  { id: 'failed', label: 'Échouées' },
  { id: 'history', label: 'Historique' },
];

interface Props {
  tab: PositionTab;
  summary: PnlSummary;
  mode: 'sim' | 'real';
  onTabChange: (tab: PositionTab) => void;
}

export function PositionTabsBar(props: Props) {
  return (
    <div class="panel-tabs panel-tabs-with-summary">
      <div class="panel-tabs-list">
        <For each={TABS}>
          {(item) => (
            <button
              class={`panel-tab ${props.tab === item.id ? 'active' : ''}`}
              onClick={() => props.onTabChange(item.id)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
      <PositionPnlSummary summary={props.summary} mode={props.mode} />
    </div>
  );
}

import { createSignal, Show } from 'solid-js';
import type { WalletAccountView } from '../../lib/wallet';
import { CollapsiblePanel, useCollapse } from '../CollapsiblePanel';
import { Icon } from '../Icon';
import { WalletHistoryPanel } from '../panels/WalletHistoryPanel';
import { WalletPolywatchExecutions } from './WalletPolywatchExecutions';

type HistoryTab = 'polywatch' | 'wallet';

interface WalletHistorySectionProps {
  accounts: WalletAccountView[];
}

export function WalletHistorySection(props: WalletHistorySectionProps) {
  const [tab, setTab] = createSignal<HistoryTab>('polywatch');
  const [collapsed, setCollapsed] = useCollapse();

  return (
    <section class="panel">
      <div class="panel-header">
        <h2>Historique</h2>
        <div class="event-header-actions">
          <button
            class="panel-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed() ? 'Déplier' : 'Plier'}
          >
            <Icon name={collapsed() ? 'chevron-down' : 'chevron-up'} />
          </button>
        </div>
      </div>

      <CollapsiblePanel collapsed={collapsed()}>
        <div class="panel-tabs">
          <button
            class={`panel-tab ${tab() === 'polywatch' ? 'active' : ''}`}
            onClick={() => setTab('polywatch')}
          >
            Executions Polywatch
          </button>
          <button
            class={`panel-tab ${tab() === 'wallet' ? 'active' : ''}`}
            onClick={() => setTab('wallet')}
          >
            Historique wallet
          </button>
        </div>

        <Show when={tab() === 'polywatch'}>
          <WalletPolywatchExecutions />
        </Show>

        <Show when={tab() === 'wallet'}>
          <div class="panel-body">
            <WalletHistoryPanel accounts={props.accounts} />
          </div>
        </Show>
      </CollapsiblePanel>
    </section>
  );
}

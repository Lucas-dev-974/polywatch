import { Show } from 'solid-js';
import { truncateAddress } from '../lib/address';
import type { WalletAccountView } from '../lib/wallet';

interface PusdTransferSummaryProps {
  account: WalletAccountView;
}

export function PusdTransferSummary(props: PusdTransferSummaryProps) {
  return (
    <div class="pusd-transfer-summary">
      <div class="pusd-transfer-row">
        <span class="pusd-transfer-label">Wallet</span>
        <span>{props.account.label}</span>
      </div>
      <div class="pusd-transfer-row">
        <span class="pusd-transfer-label">Depot Polymarket</span>
        <span class="text-mono">{truncateAddress(props.account.depositAddress)}</span>
      </div>
      <Show when={props.account.eoaAddress}>
        <div class="pusd-transfer-row">
          <span class="pusd-transfer-label">EOA MetaMask</span>
          <span class="text-mono">{truncateAddress(props.account.eoaAddress!)}</span>
        </div>
      </Show>
      <div class="pusd-transfer-row">
        <span class="pusd-transfer-label">Solde disponible</span>
        <span class="text-mono">
          {props.account.pUsdBalance.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })}{' '}
          pUSD
        </span>
      </div>
    </div>
  );
}

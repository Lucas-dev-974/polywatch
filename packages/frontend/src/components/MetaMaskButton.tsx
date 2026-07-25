import { createSignal } from 'solid-js';
import { connectMetaMaskAccount } from '../lib/ethereum';
import { useMetaMaskAvailable } from '../hooks/useMetaMaskAvailable';

interface MetaMaskButtonProps {
  onConnected: (address: string) => void;
}

export function MetaMaskButton(props: MetaMaskButtonProps) {
  const [connecting, setConnecting] = createSignal(false);
  const available = useMetaMaskAvailable();

  async function connect() {
    setConnecting(true);
    try {
      props.onConnected(await connectMetaMaskAccount());
    } catch (err) {
      console.error('MetaMask connection rejected:', err);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <button
      class="btn btn-sm btn-metamask"
      disabled={!available() || connecting()}
      onClick={() => void connect()}
      type="button"
      title={available() ? 'Connecter MetaMask' : 'MetaMask non detecte'}
    >
      <svg class="mm-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M38.2 2.3L22.3 14l2.5-6.3 13.4-5.4z" fill="#E2761B" />
        <path d="M1.8 2.3L17.5 14 15.2 7.7 1.8 2.3z" fill="#E4761B" />
        <path d="M32.6 27.2l-4.4 6.8 9.5 2.6 2.7-9.2-7.8-.2z" fill="#D7C1B3" />
        <path d="M1.6 27.2l2.7 9.2 9.5-2.6-4.4-6.8-7.8.2z" fill="#D7C1B3" />
        <path d="M12.8 17l-2.7 4 9.5.4-.3-10.2L12.8 17z" fill="#233447" />
        <path d="M27.2 17l-6.5-5.8-.2 10.2 9.4-.4-2.7-4z" fill="#233447" />
        <path d="M13.8 34l5.7-2.8-4.9-3.8-5.5.2 4.7 6.4z" fill="#CD6116" />
        <path d="M26.2 34l4.7-6.4-5.5-.2-4.9 3.8 5.7 2.8z" fill="#CD6116" />
        <path d="M15.2 27.8l-4.2 4.2 6.5 1.7-.3-5.9h-2z" fill="#E4751F" />
        <path d="M24.8 27.8h-2l-.3 5.9 6.5-1.7-4.2-4.2z" fill="#E4751F" />
        <path d="M17.7 23l-2.5 4s4.8 1.2 7.5 0l-2.5-4h-2.5z" fill="#233447" />
        <path d="M13.5 5.2l4.7 8.8-1.5-7-3.2-1.8z" fill="#CD6116" />
        <path d="M26.5 5.2l-3.2 1.8-1.5 7 4.7-8.8z" fill="#CD6116" />
      </svg>
      {connecting() ? 'Connexion...' : 'Connecter MetaMask'}
    </button>
  );
}

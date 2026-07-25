const DISPLAY_SYMBOL: Record<string, string> = {
  Bitcoin: 'BTC',
  Ethereum: 'ETH',
  Solana: 'SOL',
  XRP: 'XRP',
  Dogecoin: 'DOGE',
  Cardano: 'ADA',
  Chainlink: 'LINK',
  Polygon: 'MATIC',
  Litecoin: 'LTC',
  Polkadot: 'DOT',
  Avalanche: 'AVAX',
  Uniswap: 'UNI',
  'Shiba Inu': 'SHIB',
};

export function displayAlgoSymbol(name: string | null): string {
  if (!name) return '—';
  return DISPLAY_SYMBOL[name] ?? name;
}

export function formatAlgoPriceCents(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return (value * 100).toFixed(1) + '¢';
}

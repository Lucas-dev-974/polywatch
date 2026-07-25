export function getGammaApiUrl(): string {
  return (
    process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com'
  );
}

export function getClobApiUrl(): string {
  return process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com';
}

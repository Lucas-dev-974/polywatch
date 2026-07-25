export function bridgeHttpErrorBody(err: unknown): { error: string; message: string } {
  const message = err instanceof Error ? err.message : 'bridge_error';
  return { error: 'bridge_error', message };
}

export function mapBridgeQuoteRouteError(
  err: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof Error)) return null;

  if (err.message.startsWith('bridge_min_amount:')) {
    const min = err.message.split(':')[1];
    return {
      status: 400,
      body: { error: 'bridge_min_amount', minCheckoutUsd: Number(min) },
    };
  }
  if (err.message.startsWith('bridge_asset_unsupported:')) {
    return { status: 400, body: { error: err.message } };
  }
  if (err.message === 'bridge_address_missing') {
    return { status: 400, body: { error: 'bridge_address_missing' } };
  }
  return null;
}

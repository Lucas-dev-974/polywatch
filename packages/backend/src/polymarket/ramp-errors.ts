export function mapRampExecutionError(
  err: unknown,
  direction: 'unwrap' | 'wrap' = 'unwrap',
): never {
  if (err instanceof Error) {
    // Our own snake_case codes must not be remapped: `insufficient_balance`
    // contains "insufficient" and would otherwise become on/offramp liquidity.
    if (/^[a-z][a-z0-9_]*$/.test(err.message)) throw err;

    const msg = err.message.toLowerCase();
    if (msg.includes('onlyunpaused')) {
      throw new Error(direction === 'wrap' ? 'onramp_paused' : 'offramp_paused');
    }
    if (msg.includes('insufficient') || msg.includes('exceeds balance')) {
      throw new Error(
        direction === 'wrap'
          ? 'onramp_insufficient_liquidity'
          : 'offramp_insufficient_liquidity',
      );
    }
  }
  throw err;
}

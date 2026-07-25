export function mapRampExecutionError(err: unknown): never {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('onlyunpaused')) throw new Error('offramp_paused');
    if (msg.includes('insufficient') || msg.includes('exceeds balance')) {
      throw new Error('offramp_insufficient_liquidity');
    }
  }
  throw err;
}

import type { BacktestEvent } from '../engine/events.js';
import type { RunContext } from '../engine/runner.js';

/**
 * A domain adapter turns a stream of events into positions and equity via the
 * shared Ledger and FillEngine. Crypto/copy adapters are stubs in v1.
 */
export interface BacktestDomainAdapter {
  handle(event: BacktestEvent, ctx: RunContext): Promise<void>;
}

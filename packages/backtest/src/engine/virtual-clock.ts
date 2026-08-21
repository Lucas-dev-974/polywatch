/**
 * Virtual clock drives the replay. No Date.now() in the engine path — every
 * timestamp comes from the clock, which is advanced by the runner as events
 * are consumed. This guarantees determinism across identical data+params.
 */
export class VirtualClock {
  private t: Date;

  constructor(initial: Date = new Date(0)) {
    this.t = initial;
  }

  now(): Date {
    return this.t;
  }

  nowMs(): number {
    return this.t.getTime();
  }

  /**
   * Advance to a target timestamp. Throws on any backwards regression
   * (no tolerance — exact chronological ordering is required), which
   * catches mis-sorted source data.
   */
  advanceTo(target: Date): void {
    const targetMs = target.getTime();
    if (targetMs < this.t.getTime()) {
      throw new Error(
        `virtual_clock_regression: tried to advance from ${this.t.toISOString()} to ${target.toISOString()}`,
      );
    }
    this.t = target;
  }
}

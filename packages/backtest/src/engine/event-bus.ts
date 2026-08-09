import type { BacktestEvent } from './events.js';

/**
 * Minimal binary min-heap keyed by event timestamp. Deterministic order for
 * equal timestamps (insertion order preserved via a stable counter).
 */
export class EventBus {
  private heap: { at: number; seq: number; event: BacktestEvent }[] = [];
  private seq = 0;

  push(event: BacktestEvent): void {
    const node = { at: event.at.getTime(), seq: this.seq++, event };
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  peek(): BacktestEvent | null {
    return this.heap.length === 0 ? null : this.heap[0]!.event;
  }

  /** Pop the earliest event. Returns null when empty. */
  next(): BacktestEvent | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top.event;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.less(index, parent)) {
        this.swap(index, parent);
        index = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(index: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private less(a: number, b: number): boolean {
    const ha = this.heap[a]!;
    const hb = this.heap[b]!;
    if (ha.at !== hb.at) return ha.at < hb.at;
    return ha.seq < hb.seq;
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = tmp;
  }
}

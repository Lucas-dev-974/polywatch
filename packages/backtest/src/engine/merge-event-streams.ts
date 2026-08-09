import type { BacktestEvent } from './events.js';

interface StreamHead {
  streamId: number;
  seq: number;
  event: BacktestEvent;
  iterator: AsyncIterator<BacktestEvent>;
}

/**
 * K-way merge of async event streams by timestamp. Heap size is bounded by the
 * number of streams (typically 3), not by total event count.
 */
export async function* mergeEventStreams(
  streams: AsyncIterable<BacktestEvent>[],
): AsyncGenerator<BacktestEvent> {
  const heap: StreamHead[] = [];
  let seq = 0;

  const less = (a: StreamHead, b: StreamHead): boolean => {
    const ta = a.event.at.getTime();
    const tb = b.event.at.getTime();
    if (ta !== tb) return ta < tb;
    if (a.streamId !== b.streamId) return a.streamId < b.streamId;
    return a.seq < b.seq;
  };

  const bubbleUp = (index: number) => {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (less(heap[index]!, heap[parent]!)) {
        [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
        index = parent;
      } else {
        break;
      }
    }
  };

  // Must bubbleUp on insert — otherwise heap[0] is just stream 0's head, not the
  // global minimum, and the runner sees a virtual_clock_regression.
  for (let streamId = 0; streamId < streams.length; streamId++) {
    const iterator = streams[streamId]![Symbol.asyncIterator]();
    const first = await iterator.next();
    if (!first.done) {
      heap.push({ streamId, seq: seq++, event: first.value, iterator });
      bubbleUp(heap.length - 1);
    }
  }

  const sinkDown = (index: number) => {
    const n = heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < n && less(heap[left]!, heap[smallest]!)) smallest = left;
      if (right < n && less(heap[right]!, heap[smallest]!)) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
      index = smallest;
    }
  };

  while (heap.length > 0) {
    const top = heap[0]!;
    yield top.event;

    const next = await top.iterator.next();
    if (next.done) {
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        sinkDown(0);
      }
    } else {
      top.event = next.value;
      top.seq = seq++;
      sinkDown(0);
    }
  }
}

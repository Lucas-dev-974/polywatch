import { describe, expect, it } from 'vitest';
import {
  isAutoSnapshotDue,
  latestAutoSnapshotCreatedAtMs,
  parseSnapshotCreatedAtMs,
} from './auto-snapshot-timing.js';

describe('auto-snapshot-timing', () => {
  it('parses Date and ISO string createdAt', () => {
    const d = new Date('2024-06-01T12:00:00.000Z');
    expect(parseSnapshotCreatedAtMs(d)).toBe(d.getTime());
    expect(parseSnapshotCreatedAtMs('2024-06-01T12:00:00.000Z')).toBe(
      d.getTime(),
    );
    expect(parseSnapshotCreatedAtMs(null)).toBeNull();
    expect(parseSnapshotCreatedAtMs('invalid')).toBeNull();
  });

  it('is due when interval elapsed', () => {
    const now = 1_000_000;
    const interval = 3600;
    expect(isAutoSnapshotDue(interval, now - 3600 * 1000, now)).toBe(true);
    expect(isAutoSnapshotDue(interval, now - 3600 * 1000 + 1, now)).toBe(
      false,
    );
  });

  it('is due on first auto snapshot when no prior timestamp', () => {
    expect(isAutoSnapshotDue(3600, null, Date.now())).toBe(true);
  });

  it('rejects invalid interval', () => {
    expect(isAutoSnapshotDue(30, null, Date.now())).toBe(false);
    expect(isAutoSnapshotDue(0, null, Date.now())).toBe(false);
  });

  it('reads latest auto snapshot row', () => {
    const t1 = new Date('2024-01-01T00:00:00.000Z');
    const t2 = new Date('2024-06-01T00:00:00.000Z');
    expect(
      latestAutoSnapshotCreatedAtMs([
        { createdAt: t2 },
        { createdAt: t1 },
      ]),
    ).toBe(t2.getTime());
  });
});

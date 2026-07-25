import { describe, expect, it } from 'vitest';
import {
  computeMoveDetectorRequestsPerMinute,
  countActiveWatchlistTraders,
} from './move-detector-settings.js';

describe('move-detector-settings', () => {
  it('counts traders with any poll flag enabled', () => {
    expect(
      countActiveWatchlistTraders([
        { active: true, simEnabled: false, realEnabled: false },
        { active: false, simEnabled: false, realEnabled: false },
        { active: false, simEnabled: true, realEnabled: false },
      ]),
    ).toBe(2);
  });

  it('computes requests per minute from interval and active traders', () => {
    expect(computeMoveDetectorRequestsPerMinute(30, 2_000)).toBe(900);
    expect(computeMoveDetectorRequestsPerMinute(0, 2_000)).toBe(0);
    expect(computeMoveDetectorRequestsPerMinute(10, 0)).toBe(0);
  });
});

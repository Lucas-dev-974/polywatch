import { describe, expect, it } from 'vitest';
import {
  COPIED_POSITION_REQUIRED_MOVE_EVENT_TYPES,
  requiresOpenCopiedPosition,
} from './relevance.js';

describe('move event relevance', () => {
  it('requires open copied position for size-change and close events', () => {
    for (const type of COPIED_POSITION_REQUIRED_MOVE_EVENT_TYPES) {
      expect(requiresOpenCopiedPosition(type)).toBe(true);
    }
    expect(requiresOpenCopiedPosition('OPENED')).toBe(false);
  });
});

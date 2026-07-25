import { describe, expect, it } from 'vitest';
import {
  coalesceOutcome,
  DEFAULT_OUTCOME_LABEL,
  normalizeOutcome,
  resolveOutcomeLabel,
} from './outcome.js';

describe('outcome helpers', () => {
  it('normalizes trimmed non-empty strings', () => {
    expect(normalizeOutcome(' Down ')).toBe('Down');
    expect(normalizeOutcome('')).toBeUndefined();
    expect(normalizeOutcome('   ')).toBeUndefined();
    expect(normalizeOutcome(null)).toBeUndefined();
  });

  it('coalesces the first non-empty outcome', () => {
    expect(coalesceOutcome(undefined, null, ' Down ', 'Yes')).toBe('Down');
    expect(coalesceOutcome(undefined, '')).toBeUndefined();
  });

  it('resolves the default label when missing', () => {
    expect(resolveOutcomeLabel()).toBe(DEFAULT_OUTCOME_LABEL);
    expect(resolveOutcomeLabel('No')).toBe('No');
  });
});

import { describe, expect, it } from 'vitest';
import { closeExecutionErrorLabel } from './execution';

describe('closeExecutionErrorLabel', () => {
  it('surfaces 502/approval detail after clob_approvals_failed', () => {
    expect(
      closeExecutionErrorLabel(
        'clob_approvals_failed: approval_failed: relayer timeout',
      ),
    ).toBe(
      'approbations CLOB manquantes (approval_failed: relayer timeout)',
    );
  });

  it('keeps the bare approvals label when no detail is present', () => {
    expect(closeExecutionErrorLabel('clob_approvals_failed')).toBe(
      'approbations CLOB manquantes',
    );
  });

  it('maps reservation_released as a never-filled entry', () => {
    expect(closeExecutionErrorLabel('reservation_released')).toBe(
      'entrée jamais remplie (réservation libérée)',
    );
  });

  it('maps no_liquidity', () => {
    expect(closeExecutionErrorLabel('no_liquidity')).toBe('liquidité insuffisante');
  });
});

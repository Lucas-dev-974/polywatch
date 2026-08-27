import { describe, expect, it } from 'vitest';
import { resolveCryptoAlgoStatusBadge } from './algo/CryptoAlgoHeader';

describe('resolveCryptoAlgoStatusBadge', () => {
  it('shows stopped when the process is down', () => {
    expect(resolveCryptoAlgoStatusBadge(false, true).className).toBe('stopped');
    expect(resolveCryptoAlgoStatusBadge(false, false).label).toBe('Arrêté');
  });

  it('shows trading-off when the process is up but kill-switch is off', () => {
    const badge = resolveCryptoAlgoStatusBadge(true, false);
    expect(badge.className).toBe('trading-off');
    expect(badge.label).toBe('En ligne · trading OFF');
  });

  it('shows alive when process is up and trading is enabled', () => {
    const badge = resolveCryptoAlgoStatusBadge(true, true);
    expect(badge.className).toBe('alive');
    expect(badge.label).toBe('En ligne');
  });

  it('defaults to alive while enabled state is still loading', () => {
    expect(resolveCryptoAlgoStatusBadge(true, null).className).toBe('alive');
  });
});

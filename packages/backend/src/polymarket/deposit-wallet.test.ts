import { describe, expect, it, vi } from 'vitest';
import { resolveDepositForCredentials } from './deposit-wallet.js';
import * as proxy from './proxy.js';

describe('resolveDepositForCredentials', () => {
  it('keeps explicit L2 deposit when funder differs from wallet', async () => {
    const gammaSpy = vi.spyOn(proxy, 'detectGammaProxyWallet');
    const proxySpy = vi.spyOn(proxy, 'detectProxyWallet');

    const deposit = await resolveDepositForCredentials(
      '0xb6ce54f3290dae58c4334ae6b326c0aa801645fb',
      '0x351f13F29c847D31D967713C842DEeD2A6E62e9e',
    );

    expect(deposit).toBe('0xb6ce54f3290dae58c4334ae6b326c0aa801645fb');
    expect(gammaSpy).not.toHaveBeenCalled();
    expect(proxySpy).not.toHaveBeenCalled();

    gammaSpy.mockRestore();
    proxySpy.mockRestore();
  });
});

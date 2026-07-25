import { AssetType, type ClobClient } from '@polymarket/clob-client-v2';
import pino from 'pino';

const log = pino({ name: 'clob-cache-sync' });

/**
 * Refreshes the CLOB server-side collateral balance/allowance cache for the
 * configured signature type (POLY_1271 deposit wallets use signatureType 3).
 */
export async function syncDepositWalletCollateralCache(
  clobClient: ClobClient,
): Promise<void> {
  try {
    await clobClient.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    log.info(
      { signatureType: clobClient.signatureType },
      'CLOB collateral balance-allowance cache synced',
    );
  } catch (err) {
    log.warn({ err }, 'CLOB collateral balance-allowance sync failed');
  }
}

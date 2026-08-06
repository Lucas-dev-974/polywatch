import type { DataSource } from '@polywatch/core';
import {
  CopyConfigService,
  CryptoConfigService,
  type CopyConfig,
  type CryptoConfig,
} from '@polywatch/core';

type LegacyE2eOverride = Partial<CryptoConfig & CopyConfig> & {
  /** @deprecated use cryptoAlgoSlBidPoints (0.05 = 5%) */
  simSlPercent?: number;
  /** @deprecated use cryptoAlgoTpBidPoints */
  simTpPercent?: number;
  /** @deprecated use cryptoAlgoTrailingBidPoints */
  simTrailingStopPercent?: number;
  /** @deprecated use cryptoAlgoTrailingActivationBidPoints */
  simTrailingActivationPercent?: number;
  /** @deprecated use simInitialCapitalCrypto on crypto config */
  simInitialCapital?: number;
};

function splitLegacyOverrides(
  overrides?: LegacyE2eOverride,
): { crypto: Partial<CryptoConfig>; copy: Partial<CopyConfig> } {
  const crypto: Partial<CryptoConfig> = {};
  const copy: Partial<CopyConfig> = {};
  if (!overrides) return { crypto, copy };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    switch (key) {
      case 'simSlPercent':
        crypto.cryptoAlgoSlBidPoints = (value as number) / 100;
        copy.simSlBidPoints = (value as number) / 100;
        break;
      case 'simTpPercent':
        crypto.cryptoAlgoTpBidPoints = (value as number) / 100;
        copy.simTpBidPoints = (value as number) / 100;
        break;
      case 'simTrailingStopPercent':
        crypto.cryptoAlgoTrailingBidPoints = (value as number) / 100;
        copy.simTrailingBidPoints = (value as number) / 100;
        break;
      case 'simTrailingActivationPercent':
        crypto.cryptoAlgoTrailingActivationBidPoints = (value as number) / 100;
        copy.simTrailingActivationBidPoints = (value as number) / 100;
        break;
      case 'simInitialCapital':
        crypto.simInitialCapitalCrypto = value as number;
        break;
      default:
        if (key.startsWith('cryptoAlgo') || key === 'simInitialCapitalCrypto') {
          (crypto as Record<string, unknown>)[key] = value;
        } else {
          (copy as Record<string, unknown>)[key] = value;
        }
    }
  }

  return { crypto, copy };
}

/**
 * Configure isolated crypto + copy config for crypto-algo e2e tests.
 */
export async function configureCryptoAlgoRisk(
  ds: DataSource,
  overrides?: LegacyE2eOverride,
): Promise<{ crypto: CryptoConfig; copy: CopyConfig }> {
  const cryptoService = new CryptoConfigService(ds);
  const copyService = new CopyConfigService(ds);

  const cryptoPatch: Partial<CryptoConfig> = {
    cryptoAlgoEnabled: true,
    cryptoAlgoStrategies: JSON.stringify(['naive-momentum']),
    cryptoAlgoSlEnabled: true,
    cryptoAlgoTpEnabled: true,
    cryptoAlgoTrailingEnabled: true,
    cryptoAlgoSlBidPoints: 0.05,
    cryptoAlgoTpBidPoints: 0.15,
    cryptoAlgoTrailingBidPoints: 0.1,
    cryptoAlgoTrailingActivationBidPoints: 0,
    cryptoAlgoPreCloseEnabled: true,
    cryptoAlgoPreCloseSeconds: 60,
    cryptoAlgoPreCloseKeepEnabled: false,
    simInitialCapitalCrypto: 10_000,
    cryptoAlgoMaxPositionSizeUsdc: 200,
    cryptoAlgoMaxExposureUsdc: 1_000,
    cryptoAlgoMaxOpenPositions: 10,
    cryptoAlgoEntryUsdcAmount: 50,
    cryptoAlgoEntryShareCount: 5,
    cryptoAlgoSizingMode: 'fixed_usdc',
  };

  const copyPatch: Partial<CopyConfig> = {
    simSlEnabled: true,
    simTpEnabled: true,
    simTrailingEnabled: true,
    simSlBidPoints: 0.05,
    simTpBidPoints: 0.15,
    simTrailingBidPoints: 0.1,
    simTrailingActivationBidPoints: 0,
    simPreCloseEnabled: true,
    simPreCloseSeconds: 60,
    simPreCloseKeepEnabled: false,
    simMaxPositionSizeUsdc: 200,
    simMaxExposureUsdc: 1_000,
    simMaxOpenPositions: 10,
    simEntryUsdcAmount: 50,
    simEntryShareCount: 5,
    simSizingMode: 'fixed_usdc',
  };

  const legacy = splitLegacyOverrides(overrides);
  const crypto = await cryptoService.updateConfig({ ...cryptoPatch, ...legacy.crypto });
  const copy = await copyService.updateConfig({ ...copyPatch, ...legacy.copy });
  return { crypto, copy };
}

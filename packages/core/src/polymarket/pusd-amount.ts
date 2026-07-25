import { PUSD_DECIMALS } from './trading-wallet.js';

const PUSD_SCALE = 10n ** BigInt(PUSD_DECIMALS);
/** Tolerance for float-backed on-chain balance reads (0.000001 pUSD). */
export const PUSD_BALANCE_EPSILON_RAW = 1n;

export function normalizePusdAmountInput(input: string): string {
  return input.trim().replace(',', '.');
}

export function parsePusdAmount(input: string): bigint {
  const normalized = normalizePusdAmountInput(input);
  if (!/^\d*(\.\d*)?$/.test(normalized) || !normalized || normalized === '.') {
    throw new Error('invalid_pusd_amount');
  }
  const [whole = '0', frac = ''] = normalized.split('.');
  const fracPadded = (frac + '0'.repeat(PUSD_DECIMALS)).slice(0, PUSD_DECIMALS);
  return BigInt(whole) * PUSD_SCALE + BigInt(fracPadded || '0');
}

export function formatPusdAmount(raw: bigint): string {
  const whole = raw / PUSD_SCALE;
  const frac = (raw % PUSD_SCALE)
    .toString()
    .padStart(PUSD_DECIMALS, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function pusdRawToNumber(raw: bigint): number {
  return Number(raw) / Number(PUSD_SCALE);
}

export function amountToRaw6Decimals(amount: number): bigint {
  return parsePusdAmount(amount.toFixed(PUSD_DECIMALS));
}

export function parsePusdAmountApi(raw: string | number): number {
  if (typeof raw === 'string') return pusdRawToNumber(parsePusdAmount(raw));
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('invalid_pusd_amount');
  return Number(raw.toFixed(PUSD_DECIMALS));
}

export function hasSufficientPusdBalance(balance: number, amountRaw: bigint): boolean {
    return amountToRaw6Decimals(balance) + PUSD_BALANCE_EPSILON_RAW >= amountRaw;
}

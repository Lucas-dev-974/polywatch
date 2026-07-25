export const CONDITION_ID_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function isValidConditionId(value: string): boolean {
  return CONDITION_ID_PATTERN.test(value);
}

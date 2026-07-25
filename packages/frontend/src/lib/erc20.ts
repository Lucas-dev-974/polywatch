/** ERC-20 `transfer(address,uint256)` selector. */
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';

/** ABI-encode an ERC-20 `transfer(recipient, amountRaw)` calldata. */
export function encodeErc20Transfer(recipient: string, amountRaw: bigint): string {
  const addr = recipient.toLowerCase().replace('0x', '').padStart(64, '0');
  const amt = amountRaw.toString(16).padStart(64, '0');
  return ERC20_TRANSFER_SELECTOR + addr + amt;
}

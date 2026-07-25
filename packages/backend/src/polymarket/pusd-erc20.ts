import { ethers } from 'ethers';
import { PUSD_TOKEN_ADDRESS } from '@polywatch/core';

export const PUSD_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const PUSD_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
];

const transferIface = new ethers.Interface(PUSD_TRANSFER_ABI);

export function encodePusdTransferCalldata(
  recipient: string,
  amountRaw: bigint,
): string {
  return transferIface.encodeFunctionData('transfer', [recipient, amountRaw]);
}

export { PUSD_TOKEN_ADDRESS };

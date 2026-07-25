import { ethers } from 'ethers';
import { PUSD_DECIMALS, PUSD_TOKEN_ADDRESS } from '@polywatch/core';

const wallet = process.argv[2] ?? process.env.INSPECT_WALLET_ADDRESS;
if (!wallet) {
  console.error('Usage: node inspect-deposit-wallet.mjs <wallet-address>');
  console.error('Or set INSPECT_WALLET_ADDRESS in the environment.');
  process.exit(1);
}
const rpc = process.env.POLYGON_RPC_URL ?? 'https://polygon-bor-rpc.publicnode.com';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const provider = new ethers.JsonRpcProvider(
  rpc,
  { name: 'polygon', chainId: 137 },
  { staticNetwork: true },
);
const token = new ethers.Contract(PUSD_TOKEN_ADDRESS, ERC20_ABI, provider);
const bal = await token.balanceOf(wallet);

console.log(JSON.stringify({
  wallet,
  pUsd: Number(ethers.formatUnits(bal, PUSD_DECIMALS)),
}));

export interface DepositWalletTypedDataV4 {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: 'Batch';
  message: {
    wallet: string;
    nonce: string;
    deadline: string;
    calls: { target: string; value: string; data: string }[];
  };
}

export function depositWalletBatchMessage(typedData: DepositWalletTypedDataV4) {
  return {
    wallet: typedData.message.wallet,
    nonce: BigInt(typedData.message.nonce),
    deadline: BigInt(typedData.message.deadline),
    calls: typedData.message.calls.map((call) => ({
      target: call.target,
      value: BigInt(call.value),
      data: call.data,
    })),
  };
}

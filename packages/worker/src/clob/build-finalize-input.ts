import {
  computeTakerFee,
  type FinalizeInput,
  type PlatformFeeParams,
} from '@polywatch/core';

export function buildFilledFinalizeInput(
  orderSignalId: string,
  fillQuantity: number,
  fillPrice: number,
  platformFeeParams: PlatformFeeParams,
  clobOrderId: string,
): FinalizeInput {
  return {
    orderSignalId,
    status: 'filled',
    fillPrice,
    fillQuantity,
    fees: computeTakerFee(fillQuantity, fillPrice, platformFeeParams),
    clobOrderId,
  };
}

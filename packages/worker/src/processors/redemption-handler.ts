import type { DataSource } from 'typeorm';
import {
  CopiedPositionService,
  ExecutionService,
  getRedemptionPayoff,
  hashRedemptionOrderSignalId,
  isMarketRedeemable,
  marketLifecycleFromEntity,
  Market,
  amountToRaw6Decimals,
  resolveWinningOutcome,
} from '@polywatch/core';
import type { ExecutionResult } from '@polywatch/core';
import pino from 'pino';
import type { RedisQueue } from '../queue/redis-queue.js';
import { postBackendJson } from '../backend-client.js';
import { safeInterval } from '../helpers.js';

const log = pino({ name: 'redemption' });

export class RedemptionHandler {
  private positionService: CopiedPositionService;
  private executionService: ExecutionService;

  constructor(
    private readonly ds: DataSource,
    private readonly resultsQueue: RedisQueue<ExecutionResult>,
  ) {
    this.positionService = new CopiedPositionService(ds);
    this.executionService = new ExecutionService(ds);
  }

  async processAll(): Promise<void> {
    const pending = await this.positionService.loadPendingResolution();
    for (const pos of pending) {
      await this.redeem(
        pos.id,
        pos.conditionId,
        pos.assetId,
        pos.quantity,
        pos.mode,
      );
    }

    // Clean up failed positions whose market has resolved.
    // These positions consumed cash on entry but never sold (e.g. pre-close
    // on an illiquid book). Redemption credits the correct payoff per share.
    const failed = await this.positionService.loadFailed();
    for (const pos of failed) {
      await this.redeem(
        pos.id,
        pos.conditionId,
        pos.assetId,
        pos.quantity,
        pos.mode,
      );
    }
  }

  async redeem(
    copiedPositionId: number,
    conditionId: string,
    assetId: string,
    quantity: number,
    mode: string,
  ): Promise<void> {
    const market = await this.ds.getRepository(Market).findOne({
      where: { conditionId },
    });
    if (!market?.winningTokenId) {
      log.warn({ copiedPositionId }, 'winning token unknown');
      return;
    }

    if (!isMarketRedeemable(marketLifecycleFromEntity(market))) {
      return;
    }

    // Correct payoff: 1 if the position's assetId matches winningTokenId, else 0
    const payoffPerShare = getRedemptionPayoff(market.winningTokenId, assetId);
    const orderSignalId = hashRedemptionOrderSignalId(copiedPositionId);

    // Resolve winning outcome only for real winning positions
    let winningOutcome: 'YES' | 'NO' | null = null;
    if (mode === 'real' && payoffPerShare > 0) {
      winningOutcome = resolveWinningOutcome(
        market.winningTokenId,
        market.tokenIdYes,
        market.tokenIdNo,
      );
      if (!winningOutcome) {
        log.warn(
          { copiedPositionId, winningTokenId: market.winningTokenId },
          'winning outcome could not be resolved from market token ids',
        );
        return;
      }
    }

    const claimed = await this.executionService.claimUnlessFilled({
      orderSignalId,
      copiedPositionId,
      mode: mode as 'sim' | 'real',
      side: 'SELL',
      reason: 'REDEMPTION',
      requestedQty: quantity,
      orderType: 'FAK',
    });
    if (!claimed) return;

    // Real winning position: submit on-chain redemption via relayer
    if (mode === 'real' && payoffPerShare > 0 && winningOutcome) {
      const result = await this.redeemOnChain(
        copiedPositionId,
        conditionId,
        assetId,
        winningOutcome,
        quantity,
        market.negRisk ?? false,
        orderSignalId,
      );
      await this.resultsQueue.enqueue(result);
      return;
    }

    // Sim mode: credit the payoff directly.
    // Real losing position: no on-chain redemption needed (payoff is 0).
    const noPayout = payoffPerShare === 0;
    await this.resultsQueue.enqueue({
      orderSignalId,
      mode: mode as 'sim' | 'real',
      status: noPayout ? 'no_payout' : 'filled',
      fillPrice: payoffPerShare,
      fillQuantity: quantity,
      fees: 0,
      executedAt: new Date(),
    });

    log.info({ copiedPositionId, payoffPerShare }, 'redemption enqueued');
  }

  private async redeemOnChain(
    copiedPositionId: number,
    conditionId: string,
    assetId: string,
    winningOutcome: 'YES' | 'NO',
    quantity: number,
    negRisk: boolean,
    orderSignalId: string,
  ): Promise<ExecutionResult> {
    try {
      const quantityRaw = amountToRaw6Decimals(quantity).toString();
      const res = await postBackendJson('/api/internal/redeem', {
        conditionId,
        winningOutcome,
        quantityRaw,
        negRisk,
        assetId,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const detail = body.error ?? `HTTP ${res.status}`;
        log.warn(
          { copiedPositionId, status: res.status, error: body.error },
          'on-chain redemption request failed',
        );
        return this.failedRedemption(orderSignalId, detail);
      }

      const body = (await res.json()) as {
        txHash: string;
        success: boolean;
        amountRedeemedRaw: string;
        error?: string;
        wrappedToPusd?: boolean;
        wrapTxHash?: string;
        wrapError?: string;
      };

      // Shares already redeemed on-chain (previous attempt / desync) — close
      // as filled so we stop the zero-payout retry loop.
      if (body.error === 'no_ctf_balance') {
        log.info(
          { copiedPositionId },
          'no CTF balance — treating as already redeemed',
        );
        return {
          orderSignalId,
          mode: 'real',
          status: 'filled',
          fillPrice: 1.0,
          fillQuantity: quantity,
          fees: 0,
          executedAt: new Date(),
        };
      }

      if (!body.success || body.amountRedeemedRaw === '0') {
        const detail =
          !body.success
            ? (body.error ?? 'transaction reverted')
            : 'zero_payout';
        log.warn(
          {
            copiedPositionId,
            error: body.error,
            amountRedeemedRaw: body.amountRedeemedRaw,
            txHash: body.txHash,
          },
          'on-chain redemption failed or zero payout',
        );
        return this.failedRedemption(orderSignalId, detail);
      }

      log.info(
        {
          copiedPositionId,
          txHash: body.txHash,
          amountRedeemedRaw: body.amountRedeemedRaw,
          wrappedToPusd: body.wrappedToPusd,
          wrapTxHash: body.wrapTxHash,
          wrapError: body.wrapError,
        },
        'on-chain redemption completed',
      );

      // fillPrice is always 1 for a winning position that redeemed on-chain
      return {
        orderSignalId,
        mode: 'real',
        status: 'filled',
        fillPrice: 1.0,
        fillQuantity: quantity,
        fees: 0,
        txHash: body.txHash,
        executedAt: new Date(),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn({ err, copiedPositionId }, 'on-chain redemption call failed');
      return this.failedRedemption(orderSignalId, detail);
    }
  }

  private failedRedemption(
    orderSignalId: string,
    detail?: string,
  ): ExecutionResult {
    return {
      orderSignalId,
      mode: 'real',
      status: 'failed',
      fillPrice: 0,
      fillQuantity: 0,
      fees: 0,
      error: detail ? `redemption_failed: ${detail}` : 'redemption_failed',
      executedAt: new Date(),
    };
  }

  startLoop(intervalMs = 15_000): NodeJS.Timeout {
    return safeInterval(() => this.processAll(), intervalMs, 'redemption');
  }
}
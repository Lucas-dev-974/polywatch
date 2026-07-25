import { Side, OrderType } from '@polymarket/clob-client-v2';
import type { CreateOrderOptions } from '@polymarket/clob-client-v2';
import type { OrderSignal, ExecutionResult } from '@polywatch/core';
import { computeTakerFee, ExecutionService, RiskService, resolveSimExecutionTunables } from '@polywatch/core';
import type { DataSource } from 'typeorm';
import type { PolymarketConnectionManager } from '../polymarket/connection-manager.js';
import { failedExecution } from './execution-result.js';
import { parseFillResponse } from './parse-fill-response.js';
import { prepareFakMarketOrder } from './prepare-fak-order.js';
import { withTimeout } from './with-timeout.js';
import { loadTradingContextResult } from './trading-context.js';
import { recordLatencySample } from '../execution/latency-calibrator.js';
import { recordShadowFill } from '../execution/shadow-fill-recorder.js';
import { computeSlippagePercent } from '../execution/slippage-guard.js';
import pino from 'pino';
import { CLOB_ORDER_TIMEOUT_MS } from '../constants.js';

export { resolveTickSizeCached, roundToTick } from './tick-size.js';

const log = pino({ name: 'real-executor' });

function normalizeError(err: unknown): string {
  const msg = (err as Error).message ?? '';
  if (msg === 'clob_order_timeout') return 'clob_order_timeout';
  if (msg.includes('INSUFFICIENT_BALANCE')) return 'insufficient_balance';
  if (msg.includes('INSUFFICIENT_ALLOWANCE')) return 'insufficient_allowance';
  if (msg.includes('MINIMUM_ORDER_SIZE')) return 'below_min_order_size';
  return 'clob_order_failed';
}

export class RealExecutor {
  private executionService: ExecutionService | null;

  constructor(private readonly ds?: DataSource) {
    this.executionService = ds ? new ExecutionService(ds) : null;
  }

  async execute(
    signal: OrderSignal,
    connectionManager: PolymarketConnectionManager,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult | null> {
    if (abortSignal?.aborted) return null;

    const tradingResult = await loadTradingContextResult();
    if (!tradingResult.ok) {
      return failedExecution(signal, tradingResult.error);
    }
    const trading = tradingResult.context;

    log.info(
      {
        signalId: signal.id,
        assetId: signal.assetId,
        side: signal.side,
        quantity: signal.quantity,
        depositAddress: trading.depositAddress,
        signatureType: trading.clobClient.signatureType,
        funderAddress: trading.clobClient.funderAddress,
      },
      'real order placement on deposit wallet (CLOB V2 POLY_1271)',
    );

    const preparedResult = await prepareFakMarketOrder(signal, connectionManager, {
      ds: this.ds,
      getTickSize: (tokenID) => trading.clobClient.getTickSize(tokenID),
      getClobMarketInfo: (conditionId) =>
        trading.clobClient.getClobMarketInfo(conditionId),
    });
    if (!preparedResult.ok) {
      return preparedResult.result;
    }
    const { prepared } = preparedResult;
    const { limitPrice, tickSize, negRisk, platformFeeParams, entryBidVwap } =
      prepared;

    // --- Build and post FAK market order (C1) ---
    const clobSide = signal.side === 'BUY' ? Side.BUY : Side.SELL;
    // BUY amounts are collateral (6 decimals max) — strip float residue.
    const marketAmount =
      signal.side === 'BUY'
        ? Number((signal.quantity * limitPrice).toFixed(6))
        : signal.quantity;

    const options: CreateOrderOptions = { tickSize };
    if (negRisk) options.negRisk = true;

    let tunables = null as ReturnType<typeof resolveSimExecutionTunables> | null;
    if (this.ds) {
      const risk = await new RiskService(this.ds).getConfig();
      tunables = resolveSimExecutionTunables(risk);
    }

    const clobOrderType =
      signal.orderType === 'FOK' ? OrderType.FOK : OrderType.FAK;

    try {
      const postStartedAt = Date.now();
      const response: any = await withTimeout(
        trading.clobClient.createAndPostMarketOrder(
          {
            tokenID: signal.assetId,
            price: limitPrice,
            amount: marketAmount,
            side: clobSide,
            orderType: clobOrderType,
          },
          options,
          clobOrderType,
        ),
        CLOB_ORDER_TIMEOUT_MS,
        'clob_order_timeout',
        abortSignal,
      );
      const rttMs = Date.now() - postStartedAt;

      if (this.ds && tunables?.recordLatencySamples) {
        recordLatencySample(this.ds, signal.id, signal.side, rttMs).catch((err) =>
          log.warn({ err, signalId: signal.id }, 'latency sample insert failed'),
        );
      }

      if (abortSignal?.aborted) return null;

      const rawOrderId = String(response?.orderID ?? response?.id ?? '');
      if (rawOrderId && this.executionService) {
        try {
          await this.executionService.recordPlacingClobOrderId(signal.id, rawOrderId);
        } catch (err) {
          log.warn({ err, signalId: signal.id }, 'failed to record clob order id');
        }
      }

      // --- Parse fill result (C6) ---
      const parsed = parseFillResponse(
        response,
        signal.side,
        limitPrice,
        signal.quantity,
      );

      if (parsed.type === 'delayed') {
        log.info(
          { signalId: signal.id, status: parsed.status, clobOrderId: rawOrderId },
          'real order delayed — awaiting WS/getOrder reconciliation',
        );
        return null;
      }

      if (parsed.type === 'not_matched') {
        log.warn(
          { signalId: signal.id, status: parsed.status, response },
          'real order not matched',
        );
        return failedExecution(signal, 'order_not_matched');
      }

      if (parsed.type === 'invalid') {
        log.error(
          { signalId: signal.id, status: parsed.status, reason: parsed.reason, response },
          'real order fill parse failed',
        );
        return failedExecution(signal, parsed.reason);
      }

      const fill = parsed.fill;
      const fees = computeTakerFee(
        fill.fillQuantity,
        fill.actualFillPrice,
        platformFeeParams,
      );

      log.info(
        {
          signalId: signal.id,
          clobOrderId: fill.orderId,
          fillQuantity: fill.fillQuantity,
          fillPrice: fill.actualFillPrice,
          fees,
        },
        'real order filled',
      );

      if (this.ds && tunables?.shadowLoggingEnabled) {
        const book = connectionManager.getOrderBook(signal.assetId);
        recordShadowFill(
          this.ds,
          signal,
          limitPrice,
          fill.actualFillPrice,
          fill.fillQuantity,
          book,
        ).catch((err) =>
          log.warn({ err, signalId: signal.id }, 'shadow fill insert failed'),
        );
      }

      return {
        orderSignalId: signal.id,
        mode: 'real',
        status: 'filled',
        fillPrice: fill.actualFillPrice,
        fillQuantity: fill.fillQuantity,
        fees,
        entryBidVwap,
        clobOrderId: fill.orderId,
        referenceVwap: signal.referenceVwap,
        slippagePercent:
          signal.referenceVwap != null && signal.referenceVwap > 0
            ? computeSlippagePercent(fill.actualFillPrice, signal.referenceVwap)
            : undefined,
        executedAt: new Date(),
      };
    } catch (err) {
      const code = normalizeError(err);
      if (code === 'clob_order_timeout') {
        log.warn({ signalId: signal.id }, 'real order timed out — awaiting reconciliation');
        return null;
      }
      log.warn({ err, signalId: signal.id }, 'real order failed');
      return failedExecution(signal, code);
    }
  }
}

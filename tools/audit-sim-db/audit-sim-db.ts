/**
 * Standalone audit tool — simulation mode PostgreSQL ledger.
 * Does NOT modify project code; reads the database directly.
 *
 * Usage (from repo root):
 *   npx tsx tools/audit-sim-db/audit-sim-db.ts
 *   npx tsx tools/audit-sim-db/audit-sim-db.ts --json
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config as dotenvConfig } from 'dotenv';

// ── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');

function findMonorepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8') as string) as {
          name?: string;
          workspaces?: unknown;
        };
        if (pkg.name === 'polywatch' && pkg.workspaces) return dir;
      } catch {
        /* ignore */
      }
    }
    dir = dirname(dir);
  }
  throw new Error('Polywatch monorepo root not found');
}

const root = findMonorepoRoot();
dotenvConfig({ path: resolve(root, '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL must be set in .env or environment');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

// ── Accounting mirrors (@polywatch/core simulation/accounting.ts) ───────────

function computeBuyCashDebit(
  fillPrice: number,
  fillQuantity: number,
  fees: number,
): number {
  return fillPrice * fillQuantity + fees;
}

function computeSellSettlement(input: {
  isRedemption: boolean;
  fillPrice: number;
  fillQuantity: number;
  inputFees: number;
  entryPrice: number;
  entryFeesRemaining: number;
  entryQuantityRemaining: number;
}) {
  const feeAlloc =
    input.entryQuantityRemaining > 0
      ? input.entryFeesRemaining *
        (input.fillQuantity / input.entryQuantityRemaining)
      : 0;
  const exitFees = input.isRedemption ? 0 : input.inputFees;
  const proceeds = input.fillPrice * input.fillQuantity;
  return {
    feeAlloc,
    exitFees,
    realizedPnl:
      proceeds -
      input.entryPrice * input.fillQuantity -
      exitFees -
      feeAlloc,
    cashCredit: proceeds - exitFees,
  };
}

// ── Mark mirrors (@polywatch/core positions/mark.ts + market/lifecycle.ts) ──

function normalizeTokenId(id: string): string {
  const s = id.trim().toLowerCase();
  return s.startsWith('0x') ? s : `0x${s}`;
}

function isMarketSettled(m: {
  resolved: number;
  winning_token_id: string | null;
  closed: number;
  accepting_orders: number | null;
}): boolean {
  if (!m.winning_token_id) return false;
  if (m.resolved) return true;
  return m.closed === 1 && m.accepting_orders === 0;
}

function getRedemptionPayoff(winningTokenId: string, assetId: string): 0 | 1 {
  return normalizeTokenId(winningTokenId) === normalizeTokenId(assetId) ? 1 : 0;
}

function getPositionMarkPrice(
  pos: {
    asset_id: string;
    executable_bid_vwap: number | null;
    entry_bid_vwap: number;
    entry_price: number;
  },
  market: {
    resolved: number;
    winning_token_id: string | null;
    closed: number;
    accepting_orders: number | null;
  } | null,
): number {
  if (market && isMarketSettled(market) && market.winning_token_id) {
    return getRedemptionPayoff(market.winning_token_id, pos.asset_id);
  }
  if (pos.executable_bid_vwap != null && pos.executable_bid_vwap > 0) {
    return pos.executable_bid_vwap;
  }
  return pos.entry_bid_vwap ?? pos.entry_price;
}

function unrealizedPnl(
  mark: number,
  entryPrice: number,
  quantity: number,
  entryFeesRemaining = 0,
): number {
  return mark * quantity - entryPrice * quantity - entryFeesRemaining;
}

// ── Types ───────────────────────────────────────────────────────────────────

type PositionRow = {
  id: number;
  condition_id: string;
  asset_id: string;
  quantity: number;
  entry_price: number;
  entry_bid_vwap: number;
  entry_fees: number;
  entry_quantity_remaining: number | null;
  entry_fees_remaining: number;
  executable_bid_vwap: number | null;
  unrealized_pnl: number;
  realized_pnl: number;
  status: string;
  mode: string;
  close_reason: string | null;
  opened_at: string | null;
  closed_at: string | null;
};

type ExecutionRow = {
  id: number;
  copied_position_id: number;
  mode: string;
  side: string;
  reason: string | null;
  fill_price: number | null;
  fill_quantity: number | null;
  fees: number;
  realized_pnl: number;
  status: string;
  executed_at: string | null;
};

type MarketRow = {
  condition_id: string;
  resolved: number;
  winning_token_id: string | null;
  closed: number;
  accepting_orders: number | null;
  question: string | null;
};

type AuditReport = {
  meta: { database: string; auditedAt: string };
  config: { simInitialCapital: number; token: string };
  counts: {
    positions: number;
    byStatus: Record<string, number>;
    executions: number;
    filledExecutions: number;
    failedExecutions: number;
    placingExecutions: number;
  };
  balance: {
    storedCash: number;
    positionsValue: number;
    equity: number;
    formula: string;
  };
  cashReplay: {
    netCashDeltaFromExecutions: number;
    inferredInitialCapital: number;
    configInitialCapital: number;
    initialCapitalDelta: number;
    cashMatchesExecutions: boolean;
  };
  pnl: {
    closedPositions: number;
    closedRealizedSum: number;
    openUnrlStored: number;
    openUnrlComputed: number;
    openUnrlDelta: number;
    sellExecRealizedSum: number;
    sellExecVsClosedPosDelta: number;
    totalPnlStored: number;
    totalPnlComputed: number;
    openEntryFeesRemaining: number;
    openInvestedCost: number;
    openEconomicUnrl: number;
    totalEconomicPnl: number;
    equityVsEconomicPnlDelta: number;
    expectedEquityFromInferredInitial: number;
    expectedEquityFromConfigInitial: number;
    equityVsInferredInitialDelta: number;
    equityVsConfigInitialDelta: number;
  };
  uiMismatch: {
    note: string;
    uiOpenTabCount: number;
    equityOpenLikeCount: number;
    hiddenFromOpenTab: Array<{
      id: number;
      status: string;
      quantity: number;
      unrealizedPnl: number;
    }>;
    hiddenPositionsValueInEquity: number;
    uiOpenTabUnrlSum: number;
    equityOpenLikeUnrlStored: number;
    pnlSummaryGap: number;
  };
  issues: {
    cashRealizedPnlMismatch: string[];
    closedPositionRealizedMismatch: Array<{ id: number; stored: number; fromExecs: number }>;
    pendingNotInEquity: Array<{ id: number; status: string }>;
    otherStatuses: Array<{ id: number; status: string }>;
    failedExecutions: Array<{
      id: number;
      posId: number;
      side: string;
      status: string;
      reason: string | null;
    }>;
  };
  openPositions: Array<{
    id: number;
    status: string;
    qty: number;
    mark: number;
    value: number;
    storedUnrl: number;
    computedUnrl: number;
    question: string;
  }>;
  closedPositions: Array<{
    id: number;
    realizedPnl: number;
    closeReason: string | null;
    closedAt: string | null;
  }>;
};

const OPEN_LIKE = new Set(['open', 'closing', 'pending_resolution']);
const FILLED = new Set(['filled', 'partial']);

function fmt(n: number, d = 2): string {
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const arr = m.get(k) ?? [];
    arr.push(item);
    m.set(k, arr);
  }
  return m;
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  return Number(v);
}

async function buildReport(client: pg.PoolClient, dbUrl: string): Promise<AuditReport> {
  const balanceRes = await client.query(
    'SELECT amount, token FROM simulation_balances LIMIT 1',
  );
  const balance = balanceRes.rows[0] as { amount: number; token: string } | undefined;

  const riskRes = await client.query(
    'SELECT sim_initial_capital FROM risk_config LIMIT 1',
  );
  const risk = riskRes.rows[0] as { sim_initial_capital: number } | undefined;

  const allSimPositionsRes = await client.query(
    `SELECT id, condition_id, asset_id, quantity, entry_price, entry_bid_vwap,
            entry_fees, entry_quantity_remaining, entry_fees_remaining,
            executable_bid_vwap, unrealized_pnl, realized_pnl, status, mode,
            close_reason, opened_at, closed_at
     FROM copied_positions WHERE mode = 'sim' ORDER BY id`,
  );
  const allSimPositions = allSimPositionsRes.rows as PositionRow[];

  const simExecutionsRes = await client.query(
    `SELECT id, copied_position_id, mode, side, reason, fill_price, fill_quantity,
            fees, realized_pnl, status, executed_at
     FROM executions WHERE mode = 'sim'
     ORDER BY COALESCE(executed_at, '1970-01-01'), id`,
  );
  const simExecutions = simExecutionsRes.rows as ExecutionRow[];

  const marketsRes = await client.query(
    `SELECT condition_id, resolved, winning_token_id, closed, accepting_orders, question
     FROM markets`,
  );
  const markets = new Map<string, MarketRow>();
  for (const m of marketsRes.rows as MarketRow[]) {
    markets.set(m.condition_id, m);
  }

  const storedCash = balance ? toNumber(balance.amount) : 0;
  const simInitialCapital = risk ? toNumber(risk.sim_initial_capital) : 10_000;

  const byStatus = groupBy(allSimPositions, (p) => p.status);
  const openLike = allSimPositions.filter((p) => OPEN_LIKE.has(p.status));
  const closed = allSimPositions.filter((p) => p.status === 'closed');
  const pending = allSimPositions.filter((p) => p.status === 'pending');
  const other = allSimPositions.filter(
    (p) => !OPEN_LIKE.has(p.status) && p.status !== 'closed' && p.status !== 'pending',
  );

  let positionsValue = 0;
  const openDetails: AuditReport['openPositions'] = [];

  for (const p of openLike) {
    const market = markets.get(p.condition_id) ?? null;
    const mark = getPositionMarkPrice(p, market);
    const value = p.quantity * mark;
    const computedUnrl = unrealizedPnl(
      mark,
      p.entry_price,
      p.quantity,
      p.entry_fees_remaining ?? 0,
    );
    positionsValue += value;
    openDetails.push({
      id: p.id,
      status: p.status,
      qty: p.quantity,
      mark,
      value,
      storedUnrl: p.unrealized_pnl,
      computedUnrl,
      question: market?.question?.slice(0, 50) ?? p.condition_id.slice(0, 12),
    });
  }

  const equity = storedCash + positionsValue;

  const positionState = new Map<
    number,
    {
      entryPrice: number;
      entryFeesRemaining: number;
      entryQuantityRemaining: number;
    }
  >();

  let netCashDelta = 0;
  const cashIssues: string[] = [];

  for (const ex of simExecutions) {
    if (!FILLED.has(ex.status)) continue;
    const price = toNumber(ex.fill_price);
    const qty = toNumber(ex.fill_quantity);

    if (ex.side === 'BUY') {
      netCashDelta -= computeBuyCashDebit(price, qty, ex.fees);
      const st = positionState.get(ex.copied_position_id);
      if (!st) {
        positionState.set(ex.copied_position_id, {
          entryPrice: price,
          entryFeesRemaining: ex.fees,
          entryQuantityRemaining: qty,
        });
      } else {
        const oldQty = st.entryQuantityRemaining;
        st.entryPrice =
          (oldQty * st.entryPrice + qty * price) / (oldQty + qty);
        st.entryFeesRemaining += ex.fees;
        st.entryQuantityRemaining += qty;
      }
    } else if (ex.side === 'SELL') {
      const st = positionState.get(ex.copied_position_id);
      const qtyRemaining = st?.entryQuantityRemaining ?? qty;
      const settlement = computeSellSettlement({
        isRedemption: ex.reason === 'REDEMPTION',
        fillPrice: price,
        fillQuantity: qty,
        inputFees: ex.fees,
        entryPrice: st?.entryPrice ?? 0,
        entryFeesRemaining: st?.entryFeesRemaining ?? 0,
        entryQuantityRemaining: qtyRemaining,
      });
      netCashDelta += settlement.cashCredit;

      if (Math.abs(settlement.realizedPnl - ex.realized_pnl) > 0.02) {
        cashIssues.push(
          `Exec #${ex.id} pos #${ex.copied_position_id}: stored=${fmt(ex.realized_pnl)} computed=${fmt(settlement.realizedPnl)}`,
        );
      }

      if (st) {
        st.entryFeesRemaining -= settlement.feeAlloc;
        st.entryQuantityRemaining = Math.max(0, qtyRemaining - qty);
      }
    }
  }

  const inferredInitialCapital = storedCash - netCashDelta;

  const closedRealizedSum = closed.reduce((s, p) => s + p.realized_pnl, 0);
  const openUnrlStored = openLike.reduce((s, p) => s + p.unrealized_pnl, 0);
  const openUnrlComputed = openDetails.reduce((s, p) => s + p.computedUnrl, 0);

  // Economic unrealized includes entry fees still locked in open positions.
  let openEntryFeesRemaining = 0;
  let openInvestedCost = 0;
  let openEconomicUnrl = 0;
  for (const p of openLike) {
    const feesRem = p.entry_fees_remaining ?? 0;
    const invested = p.quantity * p.entry_price + feesRem;
    const detail = openDetails.find((d) => d.id === p.id);
    const markValue = detail?.value ?? 0;
    openEntryFeesRemaining += feesRem;
    openInvestedCost += invested;
    openEconomicUnrl += markValue - invested;
  }

  const sellExecPnlSum = simExecutions
    .filter((e) => e.side === 'SELL' && FILLED.has(e.status))
    .reduce((s, e) => s + e.realized_pnl, 0);

  const posRealizedMismatch = closed.filter((p) => {
    const sum = simExecutions
      .filter(
        (e) =>
          e.copied_position_id === p.id &&
          e.side === 'SELL' &&
          FILLED.has(e.status),
      )
      .reduce((s, e) => s + e.realized_pnl, 0);
    return Math.abs(sum - p.realized_pnl) > 0.02;
  });

  const totalPnlStored = closedRealizedSum + openUnrlStored;
  const totalPnlComputed = closedRealizedSum + openUnrlComputed;
  const expectedEquityFromInitial = inferredInitialCapital + totalPnlComputed;

  const uiOpenOnly = allSimPositions.filter((p) => p.status === 'open');
  const uiOpenUnrl = uiOpenOnly.reduce((s, p) => s + p.unrealized_pnl, 0);
  const hiddenFromUi = openLike.filter((p) => p.status !== 'open');
  let hiddenPositionsValue = 0;
  for (const p of hiddenFromUi) {
    const market = markets.get(p.condition_id) ?? null;
    hiddenPositionsValue += p.quantity * getPositionMarkPrice(p, market);
  }

  const failedExecs = simExecutions.filter((e) => e.status === 'failed');
  const placingExecs = simExecutions.filter((e) => e.status === 'placing');

  return {
    meta: { database: dbUrl.replace(/:[^:@/]+@/, ':***@'), auditedAt: new Date().toISOString() },
    config: { simInitialCapital, token: balance?.token ?? 'pUSD' },
    counts: {
      positions: allSimPositions.length,
      byStatus: Object.fromEntries(
        [...byStatus.entries()].map(([k, v]) => [k, v.length]),
      ),
      executions: simExecutions.length,
      filledExecutions: simExecutions.filter((e) => FILLED.has(e.status)).length,
      failedExecutions: failedExecs.length,
      placingExecutions: placingExecs.length,
    },
    balance: {
      storedCash,
      positionsValue,
      equity,
      formula: 'equity = cash + positionsValue (open | closing | pending_resolution)',
    },
    cashReplay: {
      netCashDeltaFromExecutions: netCashDelta,
      inferredInitialCapital,
      configInitialCapital: simInitialCapital,
      initialCapitalDelta: inferredInitialCapital - simInitialCapital,
      cashMatchesExecutions:
        Math.abs(storedCash - (inferredInitialCapital + netCashDelta)) < 0.01,
    },
    pnl: {
      closedPositions: closed.length,
      closedRealizedSum,
      openUnrlStored,
      openUnrlComputed,
      openUnrlDelta: openUnrlComputed - openUnrlStored,
      sellExecRealizedSum: sellExecPnlSum,
      sellExecVsClosedPosDelta: sellExecPnlSum - closedRealizedSum,
      totalPnlStored,
      totalPnlComputed,
      openEntryFeesRemaining,
      openInvestedCost,
      openEconomicUnrl,
      totalEconomicPnl: closedRealizedSum + openEconomicUnrl,
      equityVsEconomicPnlDelta:
        equity - (inferredInitialCapital + closedRealizedSum + openEconomicUnrl),
      expectedEquityFromInferredInitial: expectedEquityFromInitial,
      expectedEquityFromConfigInitial: simInitialCapital + totalPnlComputed,
      equityVsInferredInitialDelta: equity - expectedEquityFromInitial,
      equityVsConfigInitialDelta:
        equity - (simInitialCapital + totalPnlComputed),
    },
    uiMismatch: {
      note: 'SimHero equity includes closing + pending_resolution; PositionCard open tab only status=open',
      uiOpenTabCount: uiOpenOnly.length,
      equityOpenLikeCount: openLike.length,
      hiddenFromOpenTab: hiddenFromUi.map((p) => ({
        id: p.id,
        status: p.status,
        quantity: p.quantity,
        unrealizedPnl: p.unrealized_pnl,
      })),
      hiddenPositionsValueInEquity: hiddenPositionsValue,
      uiOpenTabUnrlSum: uiOpenUnrl,
      equityOpenLikeUnrlStored: openUnrlStored,
      pnlSummaryGap: openUnrlStored - uiOpenUnrl,
    },
    issues: {
      cashRealizedPnlMismatch: cashIssues,
      closedPositionRealizedMismatch: posRealizedMismatch.map((p) => ({
        id: p.id,
        stored: p.realized_pnl,
        fromExecs: simExecutions
          .filter(
            (e) =>
              e.copied_position_id === p.id &&
              e.side === 'SELL' &&
              FILLED.has(e.status),
          )
          .reduce((s, e) => s + e.realized_pnl, 0),
      })),
      pendingNotInEquity: pending.map((p) => ({ id: p.id, status: p.status })),
      otherStatuses: other.map((p) => ({ id: p.id, status: p.status })),
      failedExecutions: failedExecs.slice(0, 20).map((e) => ({
        id: e.id,
        posId: e.copied_position_id,
        side: e.side,
        status: e.status,
        reason: e.reason,
      })),
    },
    openPositions: openDetails,
    closedPositions: closed.map((p) => ({
      id: p.id,
      realizedPnl: p.realized_pnl,
      closeReason: p.close_reason,
      closedAt: p.closed_at,
    })),
  };
}

function printReport(report: AuditReport): void {
  const line = '═'.repeat(72);
  console.log(`\n${line}`);
  console.log('  POLYWATCH — Audit simulation (PostgreSQL)');
  console.log(line);
  console.log(`  DB     : ${report.meta.database}`);
  console.log(`  Date   : ${report.meta.auditedAt}`);
  console.log('');

  console.log('── Capital (backend / SimHero) ──');
  console.log(
    `  Cash stocké          : ${fmt(report.balance.storedCash)} ${report.config.token}`,
  );
  console.log(
    `  Valeur positions     : ${fmt(report.balance.positionsValue)} ${report.config.token}`,
  );
  console.log(
    `  Equity (capital UI)  : ${fmt(report.balance.equity)} ${report.config.token}`,
  );
  console.log(`  Formule              : ${report.balance.formula}`);
  console.log('');

  console.log('── Positions sim ──');
  console.log(`  Total                : ${report.counts.positions}`);
  console.log(`  Par statut           : ${JSON.stringify(report.counts.byStatus)}`);
  console.log('');

  console.log('── PnL ──');
  console.log(
    `  Réalisé (fermées)    : ${fmt(report.pnl.closedRealizedSum)} (${report.pnl.closedPositions} pos)`,
  );
  console.log(`  Non réalisé (stored) : ${fmt(report.pnl.openUnrlStored)}`);
  console.log(`  Non réalisé (recalc) : ${fmt(report.pnl.openUnrlComputed)}`);
  console.log(`  Écart unrl stored/recalc: ${fmt(report.pnl.openUnrlDelta)}`);
  console.log(`  PnL total (stored)   : ${fmt(report.pnl.totalPnlStored)}`);
  console.log(`  PnL total (recalc)   : ${fmt(report.pnl.totalPnlComputed)}`);
  console.log(
    `  PnL économique       : ${fmt(report.pnl.totalEconomicPnl)} (réalisé + unrl incl. frais entrée)`,
  );
  console.log(
    `  Frais entrée ouverts : ${fmt(report.pnl.openEntryFeesRemaining)} (non dans unrl stocké)`,
  );
  console.log('');

  console.log('── Conservation capital ──');
  console.log(`  Capital config       : ${fmt(report.cashReplay.configInitialCapital)}`);
  console.log(`  Capital inféré (exec): ${fmt(report.cashReplay.inferredInitialCapital)}`);
  console.log(`  Δ config vs inféré   : ${fmt(report.cashReplay.initialCapitalDelta)}`);
  console.log(
    `  Cash ↔ exécutions OK : ${report.cashReplay.cashMatchesExecutions ? '✅ oui' : '❌ NON'}`,
  );
  console.log(
    `  Equity vs inféré+PnL : ${fmt(report.pnl.equityVsInferredInitialDelta)} (écart attendu ≈ -frais entrée ouverts)`,
  );
  console.log(
    `  Equity vs économique : ${fmt(report.pnl.equityVsEconomicPnlDelta)} (≈0 attendu)`,
  );
  console.log(
    `  Equity vs config+PnL : ${fmt(report.pnl.equityVsConfigInitialDelta)} (≈0 si reset au montant config)`,
  );
  console.log('');

  console.log('── Écart UI potentiel ──');
  console.log(`  Onglet "ouvertes"    : ${report.uiMismatch.uiOpenTabCount} (status=open)`);
  console.log(`  Dans equity          : ${report.uiMismatch.equityOpenLikeCount} (open+closing+pending_resolution)`);
  if (report.uiMismatch.hiddenFromOpenTab.length > 0) {
    console.log(
      `  ⚠ Cachées de l'UI    : ${report.uiMismatch.hiddenFromOpenTab.map((x) => `#${x.id}(${x.status})`).join(', ')}`,
    );
    console.log(
      `  Valeur dans equity   : ${fmt(report.uiMismatch.hiddenPositionsValueInEquity)} (hors résumé PnL UI)`,
    );
  }
  console.log(`  Écart PnL résumé UI  : ${fmt(report.uiMismatch.pnlSummaryGap)}`);
  console.log('');

  const hasIssues =
    !report.cashReplay.cashMatchesExecutions ||
    Math.abs(report.pnl.equityVsEconomicPnlDelta) > 0.05 ||
    Math.abs(report.pnl.openUnrlDelta) > 0.05 ||
    report.issues.cashRealizedPnlMismatch.length > 0 ||
    report.issues.closedPositionRealizedMismatch.length > 0 ||
    report.uiMismatch.hiddenFromOpenTab.length > 0;

  console.log('── Anomalies ──');
  for (const m of report.issues.cashRealizedPnlMismatch) {
    console.log(`  • Exec PnL: ${m}`);
  }
  if (report.issues.closedPositionRealizedMismatch.length) {
    console.log('  • Position fermée ≠ exec SELL:');
    console.log(`    ${JSON.stringify(report.issues.closedPositionRealizedMismatch)}`);
  }
  if (report.issues.pendingNotInEquity.length) {
    console.log(`  • Pending hors equity: ${JSON.stringify(report.issues.pendingNotInEquity)}`);
  }
  if (report.issues.otherStatuses.length) {
    console.log(`  • Autres statuts: ${JSON.stringify(report.issues.otherStatuses)}`);
  }
  if (report.issues.failedExecutions.length) {
    console.log(`  • Exec failed: ${JSON.stringify(report.issues.failedExecutions)}`);
  }
  if (!hasIssues) {
    console.log('  Aucune anomalie majeure détectée.');
  }
  console.log('');

  if (report.openPositions.length) {
    console.log('── Positions ouvertes (mark recalculé) ──');
    for (const row of report.openPositions) {
      const unrlFlag =
        Math.abs(row.storedUnrl - row.computedUnrl) > 0.05 ? ' ⚠' : '';
      console.log(
        `  #${row.id} [${row.status}] qty=${fmt(row.qty, 4)} mark=${fmt(row.mark, 4)} ` +
          `val=${fmt(row.value)} unrl=${fmt(row.computedUnrl)} (stored ${fmt(row.storedUnrl)})${unrlFlag}`,
      );
    }
  }

  console.log(`\n${line}\n`);
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const report = await buildReport(client, databaseUrl!);
    if (jsonOut) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printReport(report);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
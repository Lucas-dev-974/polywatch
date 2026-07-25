/**
 * SL Conformity Audit — CommonJS version (avoids ESM/CJS resolution issues)
 *
 * 1. Pour chaque position fermée (status=closed), compare sl_percent de la
 *    position vs sl_percent du risk_config pour le mode correspondant.
 * 2. Identifie les positions où sl_percent ne correspond pas à la config.
 * 3. Pour les positions fermées avec perte (realized_pnl < 0) mais
 *    close_reason != 'SL', vérifie via market_position_ticks si le SL
 *    aurait dû trigger.
 * 4. Vérifie les positions en mode real : sl_percent devrait être null car
 *    real_sl_tp_enabled=false.
 */
'use strict';

// Load .env
require('dotenv/config');

const { DataSource } = require('typeorm');
const {
  RiskConfig,
  CopiedPosition,
  MarketPositionTick,
} = require('../packages/core/dist/index.js');
const fs = require('fs');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://polywatch:polywatch@localhost:5432/polywatch';

const ds = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [RiskConfig, CopiedPosition, MarketPositionTick],
  synchronize: false,
});

async function main() {
  await ds.initialize();
  console.log('DataSource initialise');

  const riskRepo = ds.getRepository(RiskConfig);
  const posRepo = ds.getRepository(CopiedPosition);
  const tickRepo = ds.getRepository(MarketPositionTick);

  // --- Charger la config risk ---
  const risk = await riskRepo.findOne({ where: {}, order: { id: 'ASC' } });
  if (!risk) {
    console.error('Aucune ligne risk_config trouvee');
    process.exit(1);
  }

  console.log('\n=== RISK_CONFIG ===');
  console.log(`sim_sl_tp_enabled: ${risk.simSlTpEnabled}, sim_sl_percent: ${risk.simSlPercent}`);
  console.log(`real_sl_tp_enabled: ${risk.realSlTpEnabled}, real_sl_percent: ${risk.realSlPercent}`);
  console.log(`crypto_algo_sl_percent: ${risk.cryptoAlgoSlPercent}, crypto_algo_sl_bid_points: ${risk.cryptoAlgoSlBidPoints}`);

  // SL attendu par mode selon getModeExitParams
  const expectedSimSl = risk.simSlTpEnabled ? risk.simSlPercent : undefined;
  const expectedRealSl = risk.realSlTpEnabled ? risk.realSlPercent : undefined;

  console.log(`\nSL attendu (getModeExitParams):`);
  console.log(`  sim: ${expectedSimSl} (sl_tp_enabled=${risk.simSlTpEnabled})`);
  console.log(`  real: ${expectedRealSl} (sl_tp_enabled=${risk.realSlTpEnabled})`);

  // --- 1 & 2: Conformite sl_percent sur positions fermees ---
  const closedPositions = await posRepo.find({
    where: { status: 'closed' },
    order: { id: 'ASC' },
  });

  console.log(`\n=== POSITIONS FERMEES: ${closedPositions.length} ===`);

  const conformityIssues = [];

  for (const pos of closedPositions) {
    const mode = pos.mode;
    const configSl = mode === 'sim' ? expectedSimSl : expectedRealSl;
    const slTpEnabled = mode === 'sim' ? risk.simSlTpEnabled : risk.realSlTpEnabled;

    // Cas 1: sl_tp_enabled=true mais pos.slPercent=null -> incoherent
    if (slTpEnabled && configSl != null && configSl > 0 && pos.slPercent == null) {
      conformityIssues.push({
        positionId: pos.id,
        mode,
        posSlPercent: pos.slPercent,
        configSlPercent: configSl,
        slTpEnabled,
        issue: `sl_tp_enabled=true mais pos.sl_percent=null (attendu: ${configSl})`,
        closeReason: pos.closeReason,
        realizedPnl: pos.realizedPnl,
      });
    }

    // Cas 2: sl_tp_enabled=true, pos.slPercent != configSl (et non null)
    if (slTpEnabled && configSl != null && configSl > 0 && pos.slPercent != null) {
      if (Math.abs(pos.slPercent - configSl) > 0.01) {
        conformityIssues.push({
          positionId: pos.id,
          mode,
          posSlPercent: pos.slPercent,
          configSlPercent: configSl,
          slTpEnabled,
          issue: `sl_percent mismatch: pos=${pos.slPercent} vs config=${configSl}`,
          closeReason: pos.closeReason,
          realizedPnl: pos.realizedPnl,
        });
      }
    }

    // Cas 3: sl_tp_enabled=false mais pos.slPercent != null -> incoherent
    if (!slTpEnabled && pos.slPercent != null) {
      conformityIssues.push({
        positionId: pos.id,
        mode,
        posSlPercent: pos.slPercent,
        configSlPercent: configSl,
        slTpEnabled,
        issue: `sl_tp_enabled=false mais pos.sl_percent=${pos.slPercent} (attendu: null)`,
        closeReason: pos.closeReason,
        realizedPnl: pos.realizedPnl,
      });
    }
  }

  console.log(`\n=== CONFORMITE SL_PERCENT (${conformityIssues.length} anomalies) ===`);
  for (const issue of conformityIssues) {
    console.log(
      `  #${issue.positionId} [${issue.mode}] ${issue.issue} | closeReason=${issue.closeReason} | pnl=${issue.realizedPnl}`,
    );
  }

  // --- 3: Missed SL ---
  const lossNotSL = closedPositions.filter(
    (p) => p.realizedPnl < 0 && p.closeReason !== 'SL',
  );

  console.log(
    `\n=== POSITIONS AVEC PERTE ET close_reason != SL: ${lossNotSL.length} ===`,
  );

  const missedSLs = [];

  for (const pos of lossNotSL) {
    if (pos.slPercent == null || pos.slPercent <= 0) {
      continue;
    }

    const slThreshold = Math.abs(pos.slPercent);

    const ticks = await tickRepo.find({
      where: { copiedPositionId: pos.id },
      order: { createdAt: 'ASC' },
    });

    if (ticks.length === 0) {
      continue;
    }

    let minTriggerPnl = null;
    let minClosurePnl = null;
    let breachTickAt = null;
    let breachType = null;

    for (const tick of ticks) {
      const bid =
        tick.executableBidVwap ?? tick.bestBid ?? tick.lastTradePrice;
      if (bid == null || bid <= 0) continue;
      if (pos.entryBidVwap <= 0 || pos.entryPrice <= 0) continue;

      const triggerPnl =
        ((bid - pos.entryBidVwap) / pos.entryBidVwap) * 100;
      const closurePnl =
        ((bid - pos.entryPrice) / pos.entryPrice) * 100;

      if (minTriggerPnl == null || triggerPnl < minTriggerPnl) {
        minTriggerPnl = triggerPnl;
      }
      if (minClosurePnl == null || closurePnl < minClosurePnl) {
        minClosurePnl = closurePnl;
      }

      const triggerBreach = triggerPnl <= -slThreshold;
      const closureBreach = closurePnl <= -slThreshold;

      if (triggerBreach || closureBreach) {
        breachTickAt = tick.createdAt;
        if (triggerBreach && closureBreach) breachType = 'both';
        else if (triggerBreach) breachType = 'trigger';
        else breachType = 'closure';
        break;
      }
    }

    if (
      breachType != null &&
      ((minTriggerPnl != null && minTriggerPnl <= -slThreshold) ||
        (minClosurePnl != null && minClosurePnl <= -slThreshold))
    ) {
      missedSLs.push({
        positionId: pos.id,
        mode: pos.mode,
        slPercent: pos.slPercent,
        closeReason: pos.closeReason,
        realizedPnl: pos.realizedPnl,
        minTriggerPnl,
        minClosurePnl,
        breachTickAt,
        breachType,
      });
    }
  }

  console.log(`\n=== MISSED SL (${missedSLs.length} positions) ===`);
  for (const m of missedSLs) {
    console.log(
      `  #${m.positionId} [${m.mode}] sl=${m.slPercent}% closeReason=${m.closeReason} pnl=${m.realizedPnl} | minTrigger=${m.minTriggerPnl?.toFixed(2)}% minClosure=${m.minClosurePnl?.toFixed(2)}% | breach=${m.breachType} at ${m.breachTickAt?.toISOString()}`,
    );
  }

  // --- 4: Verification mode real ---
  const realClosed = closedPositions.filter((p) => p.mode === 'real');
  const realWithSl = realClosed.filter((p) => p.slPercent != null);
  const realWithoutSl = realClosed.filter((p) => p.slPercent == null);

  const realCheck = {
    totalRealClosed: realClosed.length,
    withSlPercent: realWithSl.length,
    withoutSlPercent: realWithoutSl.length,
    withSlTpEnabledTrue: risk.realSlTpEnabled ? realClosed.length : 0,
    details: realClosed.map((p) => ({
      positionId: p.id,
      slPercent: p.slPercent,
      closeReason: p.closeReason,
      realizedPnl: p.realizedPnl,
    })),
  };

  console.log(`\n=== VERIFICATION MODE REAL ===`);
  console.log(`real_sl_tp_enabled: ${risk.realSlTpEnabled}`);
  console.log(`Positions real fermees: ${realCheck.totalRealClosed}`);
  console.log(`  Avec sl_percent non-null: ${realCheck.withSlPercent}`);
  console.log(`  Avec sl_percent=null: ${realCheck.withoutSlPercent}`);
  if (risk.realSlTpEnabled === false) {
    console.log(
      `  -> Attendu: TOUTES devraient avoir sl_percent=null (SL desactive)`,
    );
    if (realCheck.withSlPercent > 0) {
      console.log(
        `  ATTENTION ${realCheck.withSlPercent} positions real ont un sl_percent non-null alors que real_sl_tp_enabled=false !`,
      );
      for (const d of realCheck.details.filter((d) => d.slPercent != null)) {
        console.log(
          `    #${d.positionId} sl=${d.slPercent} closeReason=${d.closeReason} pnl=${d.realizedPnl}`,
        );
      }
    } else {
      console.log(`  OK Conforme: toutes les positions real ont sl_percent=null`);
    }
  }

  // --- Resume final ---
  console.log(`\n========================================`);
  console.log(`RESUME DE L'AUDIT SL`);
  console.log(`========================================`);
  console.log(`Positions fermees auditees: ${closedPositions.length}`);
  console.log(`  - sim: ${closedPositions.filter((p) => p.mode === 'sim').length}`);
  console.log(`  - real: ${closedPositions.filter((p) => p.mode === 'real').length}`);
  console.log(`Anomalies de conformite sl_percent: ${conformityIssues.length}`);
  console.log(`Missed SL (breach detecte mais close_reason != SL): ${missedSLs.length}`);
  console.log(`Positions real avec SL non-null (devrait etre null): ${realCheck.withSlPercent}`);

  // Export JSON
  const report = {
    auditDate: new Date().toISOString(),
    riskConfig: {
      sim_sl_tp_enabled: risk.simSlTpEnabled,
      sim_sl_percent: risk.simSlPercent,
      sim_tp_percent: risk.simTpPercent,
      real_sl_tp_enabled: risk.realSlTpEnabled,
      real_sl_percent: risk.realSlPercent,
      real_tp_percent: risk.realTpPercent,
      crypto_algo_sl_percent: risk.cryptoAlgoSlPercent,
      crypto_algo_sl_bid_points: risk.cryptoAlgoSlBidPoints,
    },
    expectedSl: { sim: expectedSimSl, real: expectedRealSl },
    stats: {
      totalClosed: closedPositions.length,
      simClosed: closedPositions.filter((p) => p.mode === 'sim').length,
      realClosed: realClosed.length,
      conformityIssues: conformityIssues.length,
      missedSLs: missedSLs.length,
      realWithSlPercent: realCheck.withSlPercent,
    },
    conformityIssues,
    missedSLs,
    realModeCheck: realCheck,
  };

  const reportPath = 'audits/sl-conformity-audit-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRapport JSON ecrit: ${reportPath}`);

  await ds.destroy();
  console.log('Audit termine');
}

main().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
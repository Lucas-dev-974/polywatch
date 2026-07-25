#!/usr/bin/env tsx
/**
 * Dry-run script for real trading validation.
 * Verifies all prerequisites before enabling real trading.
 *
 * Usage: npm run dry-run:real
 * Or:    npx tsx scripts/dry-run-real-trading.ts
 */

import { config } from 'dotenv';
config();

import { DataSource } from 'typeorm';
import { createClient } from 'redis';
import {
  canEnableRealTrading,
  isInsecureSecret,
} from '../packages/core/src/config/secrets.js';

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

const checks: CheckResult[] = [];

async function getDataSource(): Promise<DataSource> {
  const { createDataSource } = await import(
    '../packages/core/src/data-source.js'
  );
  return createDataSource();
}

async function runChecks(): Promise<void> {
  console.log('\n🔍 Polywatch Real Trading Dry-Run\n');
  console.log('═'.repeat(50));

  // Check 1: Secrets
  console.log('\n📋 Check 1: Secrets\n');
  const serviceToken = process.env.SERVICE_TOKEN ?? '';
  const masterKey = process.env.MASTER_ENCRYPTION_KEY ?? '';

  const secretsOk = canEnableRealTrading({
    serviceToken,
    masterEncryptionKey: masterKey,
  });

  checks.push({
    name: 'Secrets non-défaut',
    passed: secretsOk,
    message: secretsOk
      ? '✅ Secrets valides'
      : '❌ Secrets par défaut détectés',
    details: secretsOk
      ? undefined
      : `MASTER_ENCRYPTION_KEY et/ou SERVICE_TOKEN utilisent des valeurs par défaut.\n` +
        `Exécutez: npm run generate-secrets`,
  });

  if (!secretsOk) {
    console.log(`   ❌ MASTER_ENCRYPTION_KEY: ${isInsecureSecret(masterKey) ? 'INSECURE' : 'OK'}`);
    console.log(`   ❌ SERVICE_TOKEN: ${isInsecureSecret(serviceToken) ? 'INSECURE' : 'OK'}`);
    console.log(`\n   → Exécutez: npm run generate-secrets\n`);
  } else {
    console.log('   ✅ MASTER_ENCRYPTION_KEY: OK');
    console.log('   ✅ SERVICE_TOKEN: OK');
  }

  // Check 2: Database connection
  console.log('\n📋 Check 2: Base de données\n');
  try {
    const ds = await getDataSource();
    await ds.initialize();
    await ds.query('SELECT 1');
    await ds.destroy();
    checks.push({
      name: 'Connexion DB',
      passed: true,
      message: '✅ Connexion PostgreSQL OK',
    });
    console.log('   ✅ Connexion PostgreSQL OK');
  } catch (err) {
    checks.push({
      name: 'Connexion DB',
      passed: false,
      message: `❌ Erreur connexion DB: ${err}`,
    });
    console.log(`   ❌ Erreur: ${err}\n`);
  }

  // Check 3: Redis connection
  console.log('\n📋 Check 3: Redis\n');
  try {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.ping();
    await redis.disconnect();
    checks.push({
      name: 'Connexion Redis',
      passed: true,
      message: '✅ Connexion Redis OK',
    });
    console.log('   ✅ Connexion Redis OK');
  } catch (err) {
    checks.push({
      name: 'Connexion Redis',
      passed: false,
      message: `❌ Erreur Redis: ${err}`,
    });
    console.log(`   ❌ Erreur: ${err}\n`);
  }

  // Check 4: Risk config
  console.log('\n📋 Check 4: Configuration risque\n');
  try {
    const ds = await getDataSource();
    await ds.initialize();
    const result = await ds.query(
      'SELECT real_trading_enabled, real_entry_usdc_amount FROM risk_config LIMIT 1'
    );
    await ds.destroy();

    if (result.length === 0) {
      checks.push({
        name: 'Configuration risque',
        passed: false,
        message: '❌ Aucune configuration trouvée',
      });
      console.log('   ❌ Aucune configuration trouvée');
    } else {
      const { real_trading_enabled, real_entry_usdc_amount } = result[0];
      checks.push({
        name: 'Configuration risque',
        passed: true,
        message: `real_trading_enabled=${real_trading_enabled}, real_entry_usdc_amount=${real_entry_usdc_amount}`,
        details: real_trading_enabled
          ? '⚠️ Le trading réel EST ACTIVÉ — assurez-vous que c\'est intentionnel'
          : '✅ Trading réel désactivé (par défaut)',
      });
      console.log(`   ✅ real_trading_enabled: ${real_trading_enabled}`);
      console.log(`   ✅ real_entry_usdc_amount: ${real_entry_usdc_amount} USDC`);
      if (real_trading_enabled) {
        console.log('   ⚠️  ATTENTION: Le trading réel est ACTIVÉ\n');
      }
    }
  } catch (err) {
    checks.push({
      name: 'Configuration risque',
      passed: false,
      message: `❌ Erreur lecture config: ${err}`,
    });
    console.log(`   ❌ Erreur: ${err}\n`);
  }

  // Check 5: CLOB Credentials
  console.log('\n📋 Check 5: Credentials CLOB\n');
  try {
    const ds = await getDataSource();
    await ds.initialize();
    const result = await ds.query(
      "SELECT COUNT(*) as count FROM clob_credentials WHERE mode = 'real'"
    );
    await ds.destroy();

    const count = parseInt(result[0].count, 10);
    const hasCredentials = count > 0;
    checks.push({
      name: 'Credentials CLOB',
      passed: hasCredentials,
      message: hasCredentials
        ? `✅ ${count} credential(s) CLOB configuré(s)`
        : '❌ Aucun credential CLOB configuré',
      details: hasCredentials
        ? undefined
        : 'Configurez les credentials CLOB via l\'API ou l\'interface',
    });
    console.log(
      hasCredentials
        ? `   ✅ ${count} credential(s) CLOB configuré(s)`
        : '   ❌ Aucun credential CLOB'
    );
  } catch (err) {
    // Table might not exist yet
    checks.push({
      name: 'Credentials CLOB',
      passed: false,
      message: `⚠️ Impossible de vérifier: ${err}`,
    });
    console.log(`   ⚠️  Impossible de vérifier: ${err}\n`);
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 RÉSUMÉ\n');

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;

  for (const check of checks) {
    console.log(`   ${check.passed ? '✅' : '❌'} ${check.name}`);
    if (check.details) {
      console.log(`      ${check.details.split('\n').join('\n      ')}`);
    }
  }

  console.log(`\n   Total: ${passed}/${checks.length} checks passés\n`);

  if (failed > 0) {
    console.log(
      '❌ Dry-run ÉCHEC — Corrigez les erreurs avant d\'activer le trading réel\n'
    );
    process.exit(1);
  } else {
    console.log('✅ Dry-run RÉUSSI — Prêt pour le trading réel\n');
    console.log('⚠️  Pour activer le trading réel:');
    console.log('   1. Configurez les credentials CLOB');
    console.log('   2. Vérifiez les approvals on-chain');
    console.log('   3. Activez real_trading_enabled dans risk_config');
    console.log('   4. Démarrez le worker: npm run dev -w @polywatch/worker\n');
    process.exit(0);
  }
}

runChecks().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
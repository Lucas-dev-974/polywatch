# PATCH — Configuration du cleanup des Price Ticks depuis l'UI

**Date :** 2026-07-06
**Version cible :** Polywatch v1.1
**Auteur :** Audit documentation — second pass
**Statut :** ✅ Implémenté (2026-07-06)

---

## 1. Résumé

Actuellement, le cleanup des vieux `AlgoPriceTick` (ticks de prix UP/DOWN enregistrés à 1 Hz) est **codé en dur** dans `packages/crypto-algo/src/index.ts` :

```typescript
// Lignes 314-319
const priceTickCleanupTimer = safeInterval(
  () => priceTickRecorder.cleanupOldTicks(),
  3_600_000, // 1h — intervalle fixe
  'crypto-algo:price-tick-cleanup',
);
```

L'utilisateur ne peut ni **désactiver** le cleanup, ni **configurer l'intervalle**. Ce patch ajoute deux champs dans `RiskConfig` pour rendre ces paramètres pilotables depuis l'UI (onglet "Crypto-Algo" → "General").

---

## 2. Modifications détaillées

### 2.1 Entité `RiskConfig` — 2 nouvelles colonnes

**Fichier :** `packages/core/src/entities/RiskConfig.ts`

Ajouter après la ligne ~306 (`cryptoAlgoEnabled`) :

```typescript
/** Enable periodic cleanup of old algo price ticks. Default: true. */
@Column({ type: 'boolean', name: 'crypto_algo_price_tick_cleanup_enabled', default: true })
cryptoAlgoPriceTickCleanupEnabled!: boolean;

/** Interval between price tick cleanup cycles (minutes). Default: 60. */
@Column({ type: 'integer', name: 'crypto_algo_price_tick_cleanup_interval_minutes', default: 60 })
cryptoAlgoPriceTickCleanupIntervalMinutes!: number;
```

**Justification :**
- `cryptoAlgoPriceTickCleanupEnabled` : toggle ON/OFF — permet de désactiver le cleanup si l'utilisateur veut conserver tous les ticks (debug, analyse historique)
- `cryptoAlgoPriceTickCleanupIntervalMinutes` : intervalle en minutes (défaut 60 = 1h, valeur actuelle). L'utilisateur peut réduire (30 min) ou augmenter (6h) selon ses besoins

---

### 2.2 Migration TypeORM — Nouveau fichier

**Fichier :** `packages/core/src/migrations/AddCryptoAlgoPriceTickCleanupConfig1700000000026.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCryptoAlgoPriceTickCleanupConfig1700000000026
  implements MigrationInterface
{
  name = 'AddCryptoAlgoPriceTickCleanupConfig1700000000026';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN crypto_algo_price_tick_cleanup_enabled boolean NOT NULL DEFAULT true;
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        ADD COLUMN crypto_algo_price_tick_cleanup_interval_minutes integer NOT NULL DEFAULT 60;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN crypto_algo_price_tick_cleanup_interval_minutes;
    `);
    await queryRunner.query(`
      ALTER TABLE risk_config
        DROP COLUMN crypto_algo_price_tick_cleanup_enabled;
    `);
  }
}
```

---

### 2.3 Schéma de validation backend — 2 nouvelles entrées

**Fichier :** `packages/backend/src/routes/config.ts`

Ajouter dans `riskConfigUpdateSchema` (après `cryptoAlgoEnabled` ligne 137) :

```typescript
cryptoAlgoPriceTickCleanupEnabled: z.boolean(),
cryptoAlgoPriceTickCleanupIntervalMinutes: z.number().int().min(1).max(1440), // 1 min → 24h
```

**Justification :** L'intervalle min est 1 minute (pas de sens en dessous), max 1440 minutes (24h — au-delà, la rétention 24h rendrait le cleanup inefficace).

---

### 2.4 Frontend — Type `CryptoAlgoSettings`

**Fichier :** `packages/frontend/src/components/crypto-algo-settings-types.ts`

Ajouter dans le `Pick<>` (après `cryptoAlgoEnabled` ligne 5) :

```typescript
  | 'cryptoAlgoPriceTickCleanupEnabled'
  | 'cryptoAlgoPriceTickCleanupIntervalMinutes'
```

Ajouter dans `pickCryptoAlgoFields` (après `cryptoAlgoEnabled` ligne 27) :

```typescript
    cryptoAlgoPriceTickCleanupEnabled: config.cryptoAlgoPriceTickCleanupEnabled,
    cryptoAlgoPriceTickCleanupIntervalMinutes: config.cryptoAlgoPriceTickCleanupIntervalMinutes,
```

---

### 2.5 Frontend — UI dans l'onglet General

**Fichier :** `packages/frontend/src/components/CryptoAlgoSettingsGeneralTab.tsx`

Ajouter après le bloc "Stratégies activées" (ligne 48) :

```tsx
<ToggleField
  label="Nettoyage automatique des ticks de prix"
  checked={props.config.cryptoAlgoPriceTickCleanupEnabled}
  hint="Supprime périodiquement les anciens ticks de prix (AlgoPriceTick) pour limiter l'utilisation disque."
  onChange={(checked) => props.onChange({ cryptoAlgoPriceTickCleanupEnabled: checked })}
/>
{props.config.cryptoAlgoPriceTickCleanupEnabled && (
  <div class="form-field">
    <label for="cleanup-interval">Intervalle de nettoyage (minutes)</label>
    <input
      id="cleanup-interval"
      type="number"
      min={1}
      max={1440}
      value={props.config.cryptoAlgoPriceTickCleanupIntervalMinutes}
      onChange={(e) =>
        props.onChange({
          cryptoAlgoPriceTickCleanupIntervalMinutes: Math.max(
            1,
            Math.min(1440, Number(e.currentTarget.value) || 60),
          ),
        })
      }
    />
    <p class="form-hint">
      Les ticks de plus de 24h sont supprimés. Intervalle recommandé : 60 min (1h).
    </p>
  </div>
)}
```

**Note :** Le champ n'apparaît que si le toggle est activé (cleanup enabled).

---

### 2.6 Crypto-algo — Lecture de la config et pilotage du timer

**Fichier :** `packages/crypto-algo/src/index.ts`

Remplacer les lignes 314-319 (timer fixe) par :

```typescript
// 19c. Price tick cleanup: configurable via RiskConfig
const risk = await riskService.getConfig();
let priceTickCleanupTimer: NodeJS.Timeout | null = null;

if (risk.cryptoAlgoPriceTickCleanupEnabled) {
  const intervalMs = (risk.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60) * 60 * 1000;
  priceTickCleanupTimer = safeInterval(
    () => priceTickRecorder.cleanupOldTicks(),
    intervalMs,
    'crypto-algo:price-tick-cleanup',
  );
  log.info(
    { intervalMinutes: risk.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60 },
    'price tick cleanup started',
  );
} else {
  log.info('price tick cleanup disabled via risk config');
}
```

**Ajouter dans le shutdown** (ligne ~388-418) :

```typescript
if (priceTickCleanupTimer) {
  clearInterval(priceTickCleanupTimer);
  priceTickCleanupTimer = null;
}
```

**Ajouter dans le handler `config-changed`** (ligne ~352-383) pour reconfigurer le timer au vol :

```typescript
// Reconfigurer le cleanup timer si les paramètres ont changé
try {
  const refreshed = await riskService.getConfig();
  if (priceTickCleanupTimer) {
    clearInterval(priceTickCleanupTimer);
    priceTickCleanupTimer = null;
  }
  if (refreshed.cryptoAlgoPriceTickCleanupEnabled) {
    const intervalMs = (refreshed.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60) * 60 * 1000;
    priceTickCleanupTimer = safeInterval(
      () => priceTickRecorder.cleanupOldTicks(),
      intervalMs,
      'crypto-algo:price-tick-cleanup',
    );
    log.info({ intervalMinutes: refreshed.cryptoAlgoPriceTickCleanupIntervalMinutes ?? 60 }, 'price tick cleanup reconfigured');
  } else {
    log.info('price tick cleanup disabled via config-changed');
  }
} catch (err) {
  log.warn({ err }, 'failed to reconfigure price tick cleanup on config-changed');
}
```

---

### 2.7 `risk-config-api.ts` — Aucune modification nécessaire

Le type `RiskConfigApi` utilise `Omit<RiskConfig, 'simAllowedMarketTags' | 'realAllowedMarketTags' | 'cryptoAlgoStrategies'>`. Les nouveaux champs ne sont pas exclus → ils passent automatiquement dans l'API.

La fonction `toRiskConfigEntityUpdate` utilise un spread `{ ...rest }` — les nouveaux champs passent automatiquement.

---

## 3. Fichiers modifiés (récapitulatif)

| # | Fichier | Type | Modification |
|---|---------|------|-------------|
| 1 | `packages/core/src/entities/RiskConfig.ts` | 🔵 Entité | +2 colonnes |
| 2 | `packages/core/src/migrations/AddCryptoAlgoPriceTickCleanupConfig1700000000026.ts` | 🟢 Migration | Nouveau fichier |
| 3 | `packages/backend/src/routes/config.ts` | 🟡 Backend | +2 entrées Zod |
| 4 | `packages/frontend/src/components/crypto-algo-settings-types.ts` | 🟠 Frontend | +2 champs type |
| 5 | `packages/frontend/src/components/CryptoAlgoSettingsGeneralTab.tsx` | 🟠 Frontend | UI toggle + input |
| 6 | `packages/crypto-algo/src/index.ts` | 🔴 Crypto-algo | Timer piloté par config |

---

## 4. Tests & vérification

| Test | Commande | Résultat attendu |
|------|----------|------------------|
| Build core | `npm run build -w @polywatch/core` | ✅ Compile |
| Build backend | `npm run build -w @polywatch/backend` | ✅ Compile |
| Build frontend | `npm run build -w @polywatch/frontend` | ✅ Compile |
| Build crypto-algo | `npm run build -w @polywatch/crypto-algo` | ✅ Compile |
| Tests core | `npm run test -w @polywatch/core` | ✅ 411+ pass |
| Migration | `npm run migrate` | ✅ Colonnes ajoutées |
| UI | Naviguer Crypto-Algo → General | ✅ Toggle + input visibles |
| Cleanup actif | `cryptoAlgoPriceTickCleanupEnabled=true`, interval=60 | ✅ Timer 1h |
| Cleanup désactivé | `cryptoAlgoPriceTickCleanupEnabled=false` | ✅ Pas de timer |
| Reconfig via UI | Changer interval → 30, sauver | ✅ Timer recréé à 30 min |

---

## 5. Risques & mitigations

| Risque | Mitigation |
|--------|-----------|
| Intervalle trop court (1 min) → surcharge DB | Validation Zod min=1, mais recommandation UI ≥ 30 min |
| Cleanup désactivé → DB gonflée (1 tick/s × 24h × N marchés) | La rétention 24h reste codée en dur dans `CLEANUP_MAX_AGE_MS` — même désactivé, les ticks ne dépassent pas 24h si le cleanup tourne au moins une fois |
| Migration sur base existante | `DEFAULT true` / `DEFAULT 60` — rétrocompatible, aucun impact |
| Changement de config perdu au restart | Non — les valeurs sont persistées en DB via `RiskConfig` |

---

## 6. Documentation à mettre à jour

- `docs/configuration.md` — Ajouter les 2 nouvelles variables (même si elles sont dans RiskConfig, pas dans .env)
- `docs/crypto-algo.md` §7 — Mentionner que le cleanup est configurable depuis l'UI
- `docs/code/07-crypto-algo.md` — Idem

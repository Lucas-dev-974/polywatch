# PATCH : Filtre courbe descendante (entry crypto-algo)

**Date** : 2026-07-21  
**Contexte** : Éviter d'acheter un token déjà en chute (couteau qui tombe) alors que la bande de prix ne regarde qu'un snapshot instantané.

## Comportement

Quand `cryptoAlgoCurveFilterEnabled = true` :

1. Après résolution du candidat YES/NO et validation liquidité du **token cible**, mesurer le delta mid sur `cryptoAlgoCurveLookbackMs` (défaut 10 s).
2. Série = mids WS bilatéraux du token acheté (Up pour YES, Down pour NO).
3. Si `delta < -cryptoAlgoCurveMinDelta` (défaut −0,01) → abstention `curve_descending`.
4. Flat (`|delta| ≤ minDelta`) ou montée → gate OK (autres filtres inchangés).
5. Historique insuffisant (`< 3` points ou span `< 50 %` lookback) → fail-open.

Défaut : filtre **désactivé** (`cryptoAlgoCurveFilterEnabled = false`).

## Paramètres UI (dialog Crypto Algo → Général)

| Paramètre | Défaut | Rôle |
|-----------|--------|------|
| `cryptoAlgoCurveFilterEnabled` | `false` | Feature flag |
| `cryptoAlgoCurveLookbackMs` | `10000` | Fenêtre (1 000 – 60 000 ms) |
| `cryptoAlgoCurveMinDelta` | `0.01` | Seuil descente (0,001 – 0,20) |

Constantes code (non configurables) : `CURVE_MIN_POINTS=3`, `CURVE_SAMPLE_INTERVAL_MS=500`, `CURVE_BUFFER_MAX_MS=60000`.

## Fichiers modifiés

| Package | Fichiers |
|---------|----------|
| core | `RiskConfig`, migration `0061`, `crypto-algo-tunables.ts`, `config-fingerprint.ts`, `sim-mode-fields.ts` |
| crypto-algo | `mid-history-buffer.ts`, `curve-descending-gate.ts`, `price-feed.ts`, `naive-momentum.strategy.ts`, `strategy.ts`, `strategy-runner.ts`, tests |
| backend | `routes/config.ts` (Zod) |
| frontend | `CryptoAlgoSettingsGeneralTab.tsx`, `crypto-algo-settings-types.ts`, `env-settings-types.ts`, `snapshot-config-diff.ts` |
| docs | `crypto-algo.md`, `configuration.md`, `code/07-crypto-algo.md` |

## Migration

```sql
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_curve_filter_enabled boolean;
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_curve_lookback_ms integer;
ALTER TABLE risk_config ADD COLUMN IF NOT EXISTS crypto_algo_curve_min_delta real;
```

Commande : `npm run migration:run -w packages/core`

## Correctifs (2026-07-22)

Durcissement post-audit : plafond lookback 60 s + clamp runtime, clear buffer au disconnect, rate-limit logs insufficient. Voir [`2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md`](./2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md).

## Non inclus (v1)

- Régression linéaire / EMA
- Fail-closed historique obligatoire
- Gate dans le pipeline d'entrée (abstain en stratégie pour traçabilité ticks)

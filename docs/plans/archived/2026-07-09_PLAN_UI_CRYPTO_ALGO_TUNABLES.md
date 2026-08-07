# Plan — UI paramétrage constantes crypto-algo

**Date** : 2026-07-09  
**Dernière mise à jour** : 2026-07-09  
**Statut** : Implémenté  
**Migration** : `AddCryptoAlgoTunables1700000000040`  
**Tags** : `crypto-algo`, `risk-config`, `ui`, `tunables`, `naive-momentum`  
**Références** :
- Plan Cursor : `ui_config_constantes_crypto-algo_adff133c.plan.md`
- Plans prérequis : `2026-07-09_PLAN_FIX_STRATEGY_SPREAD_GAMMA_TOKEN_MIXUP.md`, `2026-07-09_PLAN_FIX_PIPELINE_STALENESS_OBSERVABILITE.md`

---

## Objectif

Exposer les constantes hardcodées de la pipeline crypto-algo (stratégie naive-momentum, tables par intervalle, fraîcheur données) via `RiskConfig` et les onglets du dialog CryptoAlgo, avec éditeur JSON pour les tables par intervalle.

## Décisions

- **Q1-A** : tout dans `RiskConfig` / dialog CryptoAlgo (pas Strategy Builder pour l'instant).
- **Q2-C** : tables par intervalle = JSON éditable, merge partiel ; `null` / `{}` = defaults code.

## Pattern null = défaut code

Identique aux champs algo existants (`cryptoAlgoSlBidPoints`, etc.) : colonne `null` → resolver retourne la constante code ; valeur explicite → override.

## Hors scope (reste en code)

`MAX_GAMMA_CACHE_SIZE`, janitors, heartbeat, `MIN_PERCENT_CHANGE`, `MIN_ORDER_*`.

## Strategy Builder (futur)

La spec Strategy Builder pourra surcharger ces tunables au niveau stratégie ; cette livraison pose la source de vérité globale `RiskConfig`.

---

## Implémentation réalisée

### 1. Schéma RiskConfig

Migration `AddCryptoAlgoTunables1700000000040` — 17 scalaires + 4 colonnes JSON (`crypto_algo_spread_abs_by_interval`, `exit_defaults_by_interval`, `pre_close_seconds_by_interval`, `time_exit_seconds_by_interval`).

### 2. Couche résolution

`packages/core/src/risk/crypto-algo-tunables.ts` :
- `resolveNaiveMomentumConfig`, `resolveSpreadAbsByInterval`, `resolveExitDefaultsByInterval`, `resolvePreCloseSecondsByInterval`, `resolveTimeExitSecondsByInterval`
- `resolveGammaCacheTtlMs`, `resolveWsDebounceMs`, `resolvePollMs`, `resolveTickIntervalMs`, `resolveTickRetentionHours`, `resolvePriceTickRefQty`, etc.
- `validateCryptoAlgoTunablesUpdate` pour PATCH API

### 3. Branchement runtime

| Composant | Changement |
|-----------|------------|
| `naive-momentum.strategy.ts` | `setConfig()` + spread abs via table mergée |
| `strategy-runner.ts` | `applyRiskTunables()`, TTL Gamma / stale factor depuis risk, `reconfigurePollMs()` |
| `crypto-algo-exit.ts` | Tables intervalle + buffer + lastCloseableBid via resolvers |
| `price-feed.ts` | `setDebounceMs()` |
| `price-tick-recorder.ts` | `configure()` (intervalle, rétention, refQty) |
| `crypto-algo/index.ts` | `applyCryptoAlgoRiskTunables()` au boot + `config-changed` |

### 4. API / DTO

- `PUT /risk-config` : validation Zod + `validateCryptoAlgoTunablesUpdate`
- `risk-config-api.ts` : parse/sérialise les 4 maps JSON
- Frontend : `env-settings-types.ts`, `crypto-algo-settings-types.ts`

### 5. UI

- **Général** : scalaires stratégie + fraîcheur/timing + JSON `spread_abs_by_interval`
- **Sortie** : overrides globaux + JSON `exit_defaults_by_interval`
- **Sortie forcée** : JSON pre-close/time-exit + buffer + lastCloseableBid max age
- Composant `JsonIntervalMapField.tsx`

### 6. Docs & tests

- `docs/crypto-algo.md` — section tunables RiskConfig
- `crypto-algo-tunables.test.ts` (merge, validation, TTL, threshold)
- `naive-momentum.strategy.test.ts` — cas `setConfig` threshold override

---

## Tests validés

- core : `crypto-algo-tunables.test.ts`, `crypto-algo-exit.test.ts`, `risk-config-api.test.ts`
- crypto-algo : `naive-momentum.strategy.test.ts` (19 tests)

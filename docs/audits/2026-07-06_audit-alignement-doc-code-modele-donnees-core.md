# Rapport d'Audit : Alignement Documentation ↔ Code Source

**Périmètre** : Modèle de Données & Core (Polywatch v1.1)
**Date** : 2026-07-06
**Version cible** : Polywatch v1.1
**Protocole** : 4 étapes (Setup → Doc→Code → Code→Doc → Synthèse)

---

## Résumé Exécutif

| Statut | Constats |
|--------|----------|
| ✅ Aligné | 5 vérifications |
| ⚠️ Divergence mineure | 4 constats |
| ❌ Divergence | 6 constats |

**Taux d'alignement global** : ~47 % (5/15 vérifications clés totalement alignées)

---

## 1. Comptage des Entités

### 1.1 22 entités annoncées

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/modele-donnees.md` (tableau lignes 10-33) | 22 entités listées | ✅ Aligné |
| `docs/code/03-core.md` (ligne 11) | 22 entités TypeORM | ✅ Aligné |
| Code : `packages/core/src/entities/*.ts` (sans index.ts) | 22 fichiers | ✅ Aligné |

**Verdict** : ✅ Aligné — le compte est exact.

---

## 2. Comptage des Migrations

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/code/03-core.md` (ligne 28) | 24 migrations TypeORM | ❌ Divergence |
| Code : `packages/core/src/migrations/*.ts` | 26 fichiers | |
| Code : `data-source.ts` (lignes 56-83) | 26 migrations enregistrées | |

**Verdict** : ❌ **Divergence** — la doc annonce 24 migrations, le code en contient 26. Les 2 migrations manquantes dans la doc sont :
- `AddCryptoAlgoTimeExit1700000000023.ts`
- `AddCryptoAlgoExitDefaults1700000000024.ts`
- `AddCryptoAlgoBidAbsoluteSlTp1700000000025.ts`

(En réalité 3 manquantes si on part de 24, mais le compte exact est 26.)

---

## 3. AlgoPriceTick — Présence dans les deux docs

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/modele-donnees.md` (ligne 29, §174-183) | Présent | ✅ Aligné |
| `docs/code/03-core.md` (ligne 52) | Présent | ✅ Aligné |
| Code : `AlgoPriceTick.ts` | Existe | ✅ Aligné |

**Verdict** : ✅ Aligné.

---

## 4. synchronize: true — Désactivation en production

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/modele-donnees.md` (lignes 5-6) | "synchronize: false sauf dev ou ALLOW_SYNCHRONIZE_PROD" | ✅ Aligné |
| Code : `data-source.ts` (lignes 114-119) | `resolveSynchronize` retourne `false` si `NODE_ENV=production` sans `ALLOW_SYNCHRONIZE_PROD` | ✅ Aligné |

**Verdict** : ✅ Aligné.

---

## 5. Champs RiskConfig — Alignement Doc ↔ Entité

### 5.1 Champs documentés dans `modele-donnees.md` (lignes 58-96)

| Champ documenté | Existe dans l'entité ? | Constat |
|-----------------|----------------------|---------|
| `maxOpenPositions` | ❌ N'existe pas — les champs réels sont `simMaxOpenPositions` / `realMaxOpenPositions` | ❌ Divergence |
| `maxExposureUsdc` (limite globale) | ✅ Existe (ligne 15) | ✅ |
| `maxDailyLossUsdc` (limite globale) | ✅ Existe (ligne 18) | ✅ |
| `maxPositionSizeUsdc` | ✅ Existe (ligne 21) | ✅ |
| `maxSlippagePercent` | ✅ Existe (ligne 24) | ✅ |
| `exitSlippageGuardPercent` | ✅ Existe (ligne 53) | ✅ |
| `simMinBidToAskRatio` / `realMinBidToAskRatio` | ✅ Existent (lignes 28-32) | ✅ |
| `simMomentumFilterEnabled` / `realMomentumFilterEnabled` | ✅ Existent (lignes 39-51) | ✅ |
| `realTradingEnabled` | ✅ Existe (ligne 65) | ✅ |
| `killSwitchAction` | ✅ Existe (ligne 62) | ✅ |
| `simKillSwitchAction` / `realKillSwitchAction` | ✅ Existent (lignes 187-191) | ✅ |
| `sizingMode` (sim/real) | ✅ Existent (lignes 72, 97) | ✅ |
| `copyRatio` (sim/real) | ✅ Existent (lignes 75, 100) | ✅ |
| `entryUsdcAmount` (sim/real) | ✅ Existent (lignes 78, 103) | ✅ |
| `simInitialCapital` | ✅ Existe (ligne 90) | ✅ |
| `kellyFraction` (sim/real) | ✅ Existent (lignes 81, 106) | ✅ |
| `riskBudgetUsdc` (sim/real) | ✅ Existent (lignes 84, 109) | ✅ |
| `defaultWinProbability` (sim/real) | ✅ Existent (lignes 87, 112) | ✅ |
| `slPercent` / `tpPercent` (sim/real) | ✅ Existent (lignes 115-134) | ✅ |
| `slTpEnabled` (sim/real) | ✅ Existent (lignes 145-149) | ✅ |
| `trailingEnabled` (sim/real) | ✅ Existent (lignes 121, 136) | ✅ |
| `trailingStopPercent` (sim/real) | ✅ Existent (lignes 124, 139) | ✅ |
| `trailingActivationPercent` (sim/real) | ✅ Existent (lignes 127, 142) | ✅ |
| `preCloseEnabled` | ✅ Existe (ligne 157) | ✅ |
| `preCloseSeconds` | ✅ Existe (ligne 56) | ✅ |
| `preCloseHoldIfWinning` | ✅ Existe (ligne 59) | ✅ |
| `copyIncreaseEnabled` / `copyDecreaseEnabled` | ✅ Existent (lignes 160-164) | ✅ |
| `simCopyIncreaseEnabled` / `realCopyIncreaseEnabled` | ✅ Existent (lignes 193-197) | ✅ |
| `simCopyDecreaseEnabled` / `realCopyDecreaseEnabled` | ✅ Existent (lignes 199-203) | ✅ |
| `maxIncreasesPerPosition` | ✅ Existe (ligne 166) | ✅ |
| `simMaxIncreasesPerPosition` / `realMaxIncreasesPerPosition` | ✅ Existent (lignes 205-209) | ✅ |
| `simCopyIncreaseSlProximityEnabled` / `realCopyIncreaseSlProximityEnabled` | ✅ Existent (lignes 215-227) | ✅ |
| `simCopyIncreaseSlProximityPercent` / `realCopyIncreaseSlProximityPercent` | ✅ Existent (lignes 234-246) | ✅ |
| `simAllowedMarketTags` / `realAllowedMarketTags` | ✅ Existent (lignes 272-276) | ✅ |
| `simSignalScoreSizingEnabled` / `realSignalScoreSizingEnabled` | ✅ Existent (lignes 279-283) | ✅ |
| `simAutoSnapshotEnabled` | ✅ Existe (ligne 285) | ✅ |
| `simAutoSnapshotIntervalSeconds` | ✅ Existe (ligne 289) | ✅ |
| `simSnapshotMaxCount` | ✅ Existe (ligne 293) | ✅ |
| `simSnapshotRetentionDays` | ✅ Existe (ligne 297) | ✅ |
| `moveDetectorIntervalMs` | ✅ Existe (ligne 301) | ✅ |

### 5.2 Champs de l'entité absents de `modele-donnees.md`

| Champ dans l'entité | Ligne | Documenté ? | Constat |
|---------------------|-------|-------------|---------|
| `simMaxOpenPositions` / `realMaxOpenPositions` | 9, 12 | ❌ (la doc mentionne `maxOpenPositions` sans variante sim/real) | ❌ Divergence |
| `simMaxExposureUsdc` / `realMaxExposureUsdc` | 175, 178 | ❌ | ❌ Divergence |
| `simMaxDailyLossUsdc` / `realMaxDailyLossUsdc` | 181, 184 | ❌ | ❌ Divergence |
| `simMaxPositionSizeUsdc` / `realMaxPositionSizeUsdc` | 169, 172 | ❌ | ❌ Divergence |
| `simSlCloseMaxRetries` / `realSlCloseMaxRetries` | 151, 154 | ❌ | ❌ Divergence |
| `simPreCloseEnabled` / `realPreCloseEnabled` | 248, 251 | ❌ | ❌ Divergence |
| `simPreCloseSeconds` / `realPreCloseSeconds` | 254, 257 | ❌ | ❌ Divergence |
| `simMinTimeToClose` / `realMinTimeToClose` | 260, 263 | ❌ | ❌ Divergence |
| `simPreCloseHoldIfWinning` / `realPreCloseHoldIfWinning` | 266, 269 | ❌ | ❌ Divergence |
| `simCopyTradingEnabled` | 68 | ❌ | ❌ Divergence |
| `realCashOverride` | 397 | ❌ | ❌ Divergence |
| `cryptoAlgoEnabled` → `cryptoAlgoMinTimeToClose` (18 champs) | 304-406 | ❌ dans `modele-donnees.md` | ❌ Divergence |

### 5.3 Champs crypto-algo dans `03-core.md`

`03-core.md` (ligne 37) mentionne partiellement les champs crypto-algo :
- ✅ `cryptoAlgoEnabled`, `cryptoAlgoStrategies`, `cryptoAlgoSlPercent`, `cryptoAlgoTpPercent`, `cryptoAlgoTrailingStopPercent`, `cryptoAlgoTrailingActivationPercent`, `cryptoAlgoSlBidPoints`, `cryptoAlgoTpBidPoints`, `cryptoAlgoPreCloseEnabled`, `cryptoAlgoPreCloseSeconds`, `cryptoAlgoPreCloseHoldIfWinning`, `cryptoAlgoMinTimeToClose`
- ❌ Manquants : `cryptoAlgoPreCloseWinConfidenceBid`, `cryptoAlgoTimeExitEnabled`, `cryptoAlgoTimeExitSeconds`, `cryptoAlgoTimeExitWinConfidenceBid`, `cryptoAlgoTimeExitMaxRetries`, `cryptoAlgoTimeExitLastTradeMaxAgeSeconds`

**Verdict** : ⚠️ **Divergence mineure** pour `03-core.md` (12/18 champs crypto-algo documentés), ❌ **Divergence** pour `modele-donnees.md` (0/18 champs crypto-algo documentés).

---

## 6. Services — 18 services listés

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/code/03-core.md` (ligne 22) | 18 services métiers | ⚠️ Divergence mineure |
| `docs/code/03-core.md` (tableau lignes 147-164) | 18 services listés | |
| Code : `packages/core/src/services/*.ts` (sans .test.ts, sans index.ts) | 23 fichiers | |

Les 5 fichiers supplémentaires non listés comme services métiers :
- `algo-surveillance.types.ts` — types et interfaces (non un service)
- `algo-surveillance-positions.ts` — fonction utilitaire
- `crypto-algo-runtime-status.ts` — fonction utilitaire
- `algo-services.ts` — factory
- `algo-surveillance-helpers.ts` — helpers

**Verdict** : ⚠️ **Divergence mineure** — le décompte "18 services" est correct si on exclut les utilitaires/types/factories, mais le code contient 23 fichiers dans le répertoire services/. La doc devrait clarifier que seuls 18 sont des services métiers.

---

## 7. Nouvelles entités (E2e*, MarketPositionTick, IntegrationSettings)

| Entité | `modele-donnees.md` | `03-core.md` | Code | Constat |
|--------|---------------------|--------------|------|---------|
| `E2eTestRun` | ✅ Ligne 32 | ✅ Ligne 55 | ✅ Existe | ✅ Aligné |
| `E2eRunPosition` | ✅ Ligne 33 | ✅ Ligne 56 | ✅ Existe | ✅ Aligné |
| `MarketPositionTick` | ✅ Ligne 31, §189-204 | ✅ Ligne 54 | ✅ Existe | ✅ Aligné |
| `IntegrationSettings` | ✅ Ligne 30, §185-186 | ✅ Ligne 53 | ✅ Existe | ✅ Aligné |

**Verdict** : ✅ Aligné — toutes les nouvelles entités sont documentées dans les deux docs.

---

## 8. Relations Conceptuelles (Diagramme)

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/modele-donnees.md` (lignes 37-45) | Diagramme relations | ⚠️ Divergence mineure |

Le diagramme montre les relations entre : User, WatchlistEntry, CopiedPosition, Market, Execution, PositionReservation, TraderSnapshot, TraderSnapshotSeq, MoveEventEntity.

**Entités absentes du diagramme** : AlgoMarketSelection, AlgoAutoTrackRule, AlgoSurveillanceSnapshot, AlgoPriceTick, MarketPositionTick, IntegrationSettings, E2eTestRun, E2eRunPosition, SimulationBalance, SimulationStateSnapshot, ClobCredentials, WalletAccount.

**Verdict** : ⚠️ **Divergence mineure** — les relations décrites restent valides, mais le diagramme est très incomplet (11 entités sur 22 manquantes). Il devrait être mis à jour pour inclure toutes les entités.

---

## 9. Champs CopiedPosition — Divergences Doc ↔ Code

### 9.1 Champs documentés dans `modele-donnees.md` (lignes 116-125)

| Champ documenté | Existe dans l'entité ? | Constat |
|-----------------|----------------------|---------|
| `watchlistId` | ✅ Ligne 13 | ✅ |
| `conditionId` | ✅ Ligne 19 | ✅ |
| `assetId` | ✅ Ligne 22 | ✅ |
| `outcome` | ✅ Ligne 25 | ✅ |
| `side` | ✅ Ligne 28 | ✅ |
| `mode` | ✅ Ligne 92 | ✅ |
| `quantity` | ✅ Ligne 31 | ✅ |
| `entryPrice` | ✅ Ligne 34 | ✅ |
| `entryBidVwap` | ✅ Ligne 37 | ✅ |
| `entryFees` | ✅ Ligne 40 | ✅ |
| `entryQuantityRemaining` | ✅ Ligne 43 | ✅ |
| `entryFeesRemaining` | ✅ Ligne 46 | ✅ |
| `executableBidVwap` | ✅ Ligne 49 | ✅ |
| `unrealizedPnl` | ✅ Ligne 58 | ✅ |
| `realizedPnl` | ✅ Ligne 61 | ✅ |
| `peakPnlPercent` | ❌ N'existe pas — le champ réel est `peakClosurePnlPercent` | ❌ Divergence |
| `lastValidTriggerPnlPercent` | ❌ N'existe pas dans l'entité | ❌ Divergence |
| `liquidityStatus` | ✅ Ligne 71 | ✅ |
| `slPercent` | ✅ Ligne 77 | ✅ |
| `tpPercent` | ✅ Ligne 80 | ✅ |
| `trailingStopPercent` | ✅ Ligne 83 | ✅ |
| `trailingActivationPercent` | ✅ Ligne 86 | ✅ |
| `status` | ✅ Ligne 89 | ✅ |
| `openedAt` | ✅ Ligne 95 | ✅ |
| `closedAt` | ✅ Ligne 98 | ✅ |
| `closeReason` | ✅ Ligne 101 | ✅ |
| `increaseCount` | ✅ Ligne 107 | ✅ |
| `closingAttemptSeq` | ✅ Ligne 68 | ✅ (mais absent de la doc) |

### 9.2 Champs de l'entité CopiedPosition absents de `modele-donnees.md`

| Champ | Ligne | Constat |
|-------|-------|---------|
| `moveEventId` | 16 | ❌ Absent |
| `lastCloseableBidVwap` | 53 | ❌ Absent |
| `lastCloseableBidAt` | 56 | ❌ Absent |
| `peakClosurePnlPercent` | 65 | ❌ Absent (la doc mentionne `peakPnlPercent` qui n'existe pas) |
| `closingAttemptSeq` | 68 | ❌ Absent |
| `bookUpdatedAt` | 74 | ❌ Absent |
| `closingStartedAt` | 104 | ❌ Absent |
| `reason` | 110 | ❌ Absent |
| `slBidPoints` | 114 | ❌ Absent |
| `tpBidPoints` | 118 | ❌ Absent |

### 9.3 `03-core.md` mentionne `peakPnlPercent` (marché)

`03-core.md` ligne 43 mentionne `peakPnlPercent` (marché) et `peakClosurePnlPercent` (clôture). Le champ `peakPnlPercent` n'existe pas dans l'entité — seul `peakClosurePnlPercent` existe.

**Verdict** : ❌ **Divergence** — `peakPnlPercent` et `lastValidTriggerPnlPercent` sont documentés mais n'existent pas dans l'entité. `peakClosurePnlPercent` existe dans l'entité mais est absent de `modele-donnees.md`.

---

## 10. Market — Champ `takerBaseFee`

| Source | Valeur | Constat |
|--------|--------|---------|
| `docs/code/03-core.md` (ligne 48) | Mentionne `takerBaseFee` | ❌ Divergence |
| Code : `Market.ts` | Pas de champ `takerBaseFee` — les champs réels sont `feeRate` et `feeExponent` | |

**Verdict** : ❌ **Divergence** — `takerBaseFee` n'existe pas dans l'entité Market. Les champs réels sont `feeRate` (CLOB `fd.r`) et `feeExponent` (CLOB `fd.e`).

---

## Synthèse des Écarts

### ❌ Divergences (6)

| # | Fichier(s) | Ligne(s) | Problème | Correction |
|---|-----------|----------|----------|------------|
| D1 | `03-core.md` | 28 | Annonce 24 migrations, le code en contient 26 | Mettre à jour le compte à 26 |
| D2 | `modele-donnees.md` | 59 | Mentionne `maxOpenPositions` (sans variante sim/real) — ce champ n'existe pas dans RiskConfig | Remplacer par `simMaxOpenPositions` / `realMaxOpenPositions` |
| D3 | `modele-donnees.md` | 121 | Mentionne `peakPnlPercent` et `lastValidTriggerPnlPercent` — ces champs n'existent pas dans CopiedPosition | Remplacer `peakPnlPercent` par `peakClosurePnlPercent` ; supprimer `lastValidTriggerPnlPercent` |
| D4 | `03-core.md` | 43 | Mentionne `peakPnlPercent` (marché) — ce champ n'existe pas dans CopiedPosition | Remplacer par `peakClosurePnlPercent` |
| D5 | `03-core.md` | 48 | Mentionne `takerBaseFee` pour Market — ce champ n'existe pas | Remplacer par `feeRate` / `feeExponent` |
| D6 | `modele-donnees.md` | §58-96 | Aucun des 18 champs crypto-algo de RiskConfig n'est documenté | Ajouter la section crypto-algo dans la doc RiskConfig |

### ⚠️ Divergences mineures (4)

| # | Fichier(s) | Problème | Correction |
|---|-----------|----------|------------|
| M1 | `03-core.md` | 18 services listés mais 23 fichiers dans services/ (5 utilitaires non comptés) | Clarifier que 18 sont des services métiers, ou lister les 5 fichiers supplémentaires |
| M2 | `modele-donnees.md` | Diagramme relations très incomplet (11/22 entités manquantes) | Mettre à jour le diagramme avec toutes les entités |
| M3 | `modele-donnees.md` | 10 champs de CopiedPosition absents de la doc (moveEventId, lastCloseableBidVwap, peakClosurePnlPercent, closingAttemptSeq, bookUpdatedAt, closingStartedAt, reason, slBidPoints, tpBidPoints, lastCloseableBidAt) | Ajouter les champs manquants |
| M4 | `modele-donnees.md` | 12 champs RiskConfig en variante sim/real absents (simMaxOpenPositions, realMaxOpenPositions, simMaxExposureUsdc, realMaxExposureUsdc, simMaxDailyLossUsdc, realMaxDailyLossUsdc, simMaxPositionSizeUsdc, realMaxPositionSizeUsdc, simSlCloseMaxRetries, realSlCloseMaxRetries, simPreCloseEnabled, realPreCloseEnabled, simPreCloseSeconds, realPreCloseSeconds, simMinTimeToClose, realMinTimeToClose, simPreCloseHoldIfWinning, realPreCloseHoldIfWinning, simCopyTradingEnabled, realCashOverride) | Ajouter les variantes sim/real manquantes |

### ✅ Points alignés (5)

1. **Comptage entités** : 22 entités — doc et code alignés
2. **AlgoPriceTick** : présent dans les deux docs et dans le code
3. **synchronize: false en production** : doc et code parfaitement alignés
4. **Nouvelles entités (E2e*, MarketPositionTick, IntegrationSettings)** : toutes documentées
5. **Champs RiskConfig documentés dans modele-donnees.md** : 35/37 champs listés existent dans l'entité (seuls `maxOpenPositions` et les crypto-algo posent problème)

---

## Fichiers Sources Consultés

### Documentation
- `docs/modele-donnees.md` (225 lignes)
- `docs/code/03-core.md` (168 lignes)

### Code
- `packages/core/src/entities/` (22 fichiers d'entité)
- `packages/core/src/entities/RiskConfig.ts` (407 lignes)
- `packages/core/src/entities/CopiedPosition.ts` (119 lignes)
- `packages/core/src/entities/Market.ts` (64 lignes)
- `packages/core/src/entities/index.ts` (32 lignes)
- `packages/core/src/migrations/` (26 fichiers)
- `packages/core/src/services/` (23 fichiers + 11 .test.ts)
- `packages/core/src/services/index.ts` (98 lignes)
- `packages/core/src/risk/` (12 fichiers)
- `packages/core/src/database/data-source.ts` (206 lignes)

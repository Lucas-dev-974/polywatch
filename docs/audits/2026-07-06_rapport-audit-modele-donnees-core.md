# Rapport d'Audit — Alignement Documentation ↔ Code Source
## Périmètre : Modèle de Données & Core (Polywatch v1.1)

**Date :** 2026-07-06  
**Auditeur :** Hermes Agent  
**Périmètre doc :** `docs/modele-donnees.md` (225 lignes), `docs/code/03-core.md` (168 lignes)  
**Périmètre code :** `packages/core/src/entities/`, `migrations/`, `services/`, `risk/`, `database/data-source.ts`

---

## Résumé Exécutif

| Métrique | Doc | Code | Statut |
|----------|-----|------|--------|
| Entités TypeORM | 22 | 22 | ✅ |
| Migrations TypeORM | 24 | 26 | ❌ (−2) |
| Services métier listés | 18 | 18 | ✅ |
| Fichiers services (total) | — | 34 (dont tests) | ℹ️ |
| Fichiers risk/ | — | 12 (dont tests) | ℹ️ |

**Bilan :** 3 anomalies bloquantes, 7 écarts mineurs, 4 omissions documentation.

---

## 1. Vérifications Clés

### 1.1 Comptage entités — ✅ ALIGNÉ
- **Doc :** 22 entités listées (tableau `modele-donnees.md` lignes 10–33, tableau `03-core.md` lignes 33–56)
- **Code :** 22 fichiers `*.ts` dans `packages/core/src/entities/` (hors index, tests)
- **DataSource :** 22 entités enregistrées dans `data-source.ts` lignes 85–108
- **Correspondance :** 22/22 — chaque entité documentée existe dans le code et vice versa

### 1.2 Comptage migrations — ❌ ANOMALIE (doc dit 24, code = 26)
- **Doc :** `03-core.md` ligne 28 : « 24 migrations TypeORM »
- **Code :** 26 fichiers dans `packages/core/src/migrations/`
- **DataSource :** 26 migrations enregistrées dans `data-source.ts` lignes 56–83
- **2 migrations non comptabilisées dans la doc :**
  - `AddCryptoAlgoTimeExit1700000000023` (time-exit hard deadline)
  - `AddCryptoAlgoExitDefaults1700000000024` (valeurs par défaut exit crypto-algo)
  - `AddCryptoAlgoBidAbsoluteSlTp1700000000025` (SL/TP en bid points absolus)
- **Recommandation :** Mettre à jour le compteur dans `03-core.md` de 24 → 26

### 1.3 AlgoPriceTick — ✅ PRÉSENT DANS LES DEUX DOCS
- `modele-donnees.md` : ligne 29 (tableau) + section dédiée lignes 174–183
- `03-core.md` : ligne 52 (tableau entités)
- **Aligné**

### 1.4 synchronize: true — ✅ ALIGNÉ
- **Doc :** `modele-donnees.md` ligne 6 : « `synchronize: false` sauf dev ou `ALLOW_SYNCHRONIZE_PROD` »
- **Code :** `data-source.ts` lignes 114–119 — `resolveSynchronize()` désactive en production sauf si `ALLOW_SYNCHRONIZE_PROD` est défini
- **Aligné**

### 1.5 Champs RiskConfig — ⚠️ ÉCARTS DOCUMENTATION
- **Doc `modele-donnees.md`** (lignes 58–96) : couvre les champs core (limites, sizing, sorties, pré-clôture, copie, snapshots, polling)
- **Doc `03-core.md`** (ligne 37) : couvre les champs core + crypto-algo
- **Champs crypto-algo NON documentés dans `modele-donnees.md` :**
  - `cryptoAlgoEnabled`, `cryptoAlgoStrategies`
  - `cryptoAlgoSlPercent`, `cryptoAlgoTpPercent`
  - `cryptoAlgoTrailingStopPercent`, `cryptoAlgoTrailingActivationPercent`
  - `cryptoAlgoPreCloseEnabled`, `cryptoAlgoPreCloseSeconds`, `cryptoAlgoPreCloseHoldIfWinning`
  - `cryptoAlgoPreCloseWinConfidenceBid`
  - `cryptoAlgoTimeExitEnabled`, `cryptoAlgoTimeExitSeconds`, `cryptoAlgoTimeExitWinConfidenceBid`, `cryptoAlgoTimeExitMaxRetries`, `cryptoAlgoTimeExitLastTradeMaxAgeSeconds`
  - `cryptoAlgoSlBidPoints`, `cryptoAlgoTpBidPoints`
  - `cryptoAlgoMinTimeToClose`
  - `realCashOverride`
  - `simSlCloseMaxRetries`, `realSlCloseMaxRetries`
  - `simCopyTradingEnabled`
  - `simPreCloseEnabled`, `realPreCloseEnabled`, `simPreCloseSeconds`, `realPreCloseSeconds`, `simPreCloseHoldIfWinning`, `realPreCloseHoldIfWinning`
  - `simMinTimeToClose`, `realMinTimeToClose`
  - `simMaxPositionSizeUsdc`, `realMaxPositionSizeUsdc`, `simMaxExposureUsdc`, `realMaxExposureUsdc`, `simMaxDailyLossUsdc`, `realMaxDailyLossUsdc`
  - `simKillSwitchAction`, `realKillSwitchAction`
  - `simCopyIncreaseEnabled`, `realCopyIncreaseEnabled`, `simCopyDecreaseEnabled`, `realCopyDecreaseEnabled`
  - `simMaxIncreasesPerPosition`, `realMaxIncreasesPerPosition`
  - `simSignalScoreSizingEnabled`, `realSignalScoreSizingEnabled`
  - `simAutoSnapshotEnabled`, `simAutoSnapshotIntervalSeconds`, `simSnapshotMaxCount`, `simSnapshotRetentionDays`
  - `moveDetectorIntervalMs`
- **Note :** Les champs `sim*`/`real*` sont documentés de façon conceptuelle (par catégorie) dans `modele-donnees.md` mais pas exhaustivement. La doc `03-core.md` mentionne les paramètres crypto-algo clés.

### 1.6 Services — ✅ ALIGNÉ
- **Doc :** 18 services listés dans `03-core.md` lignes 145–163
- **Code :** 18 services métier identifiés (fichiers `*.service.ts` + `CopiedPositionPresenter`)
- **Fichiers auxiliaires non listés (normaux) :** `algo-services.ts` (factory), `algo-surveillance.types.ts`, `algo-surveillance-positions.ts`, `crypto-algo-runtime-status.ts`
- **Aligné**

### 1.7 Nouvelles entités (E2e*, MarketPositionTick, IntegrationSettings) — ✅ DOCUMENTÉES
- `E2eTestRun` : ✅ `modele-donnees.md` ligne 32, `03-core.md` ligne 55
- `E2eRunPosition` : ✅ `modele-donnees.md` ligne 33, `03-core.md` ligne 56
- `MarketPositionTick` : ✅ `modele-donnees.md` lignes 31, 188–204, `03-core.md` ligne 54
- `IntegrationSettings` : ✅ `modele-donnees.md` lignes 30, 185–186, `03-core.md` ligne 53

### 1.8 Relations conceptuelles — ⚠️ INCOMPLÈTES
- **Doc :** Diagramme `modele-donnees.md` lignes 37–45
- **Entités manquantes dans le diagramme :** `AlgoMarketSelection`, `AlgoAutoTrackRule`, `AlgoSurveillanceSnapshot`, `AlgoPriceTick`, `MarketPositionTick`, `IntegrationSettings`, `E2eTestRun`, `E2eRunPosition`, `SimulationStateSnapshot`, `SimulationBalance`
- **Recommandation :** Ajouter les relations algo et E2E au diagramme

---

## 2. Anomalies Bloquantes

### 🔴 A1 — `peakPnlPercent` documenté mais inexistant dans le code
- **Fichier :** `docs/modele-donnees.md` ligne 121
- **Texte :** « `peakPnlPercent` (marché), `peakClosurePnlPercent` (clôture) »
- **Code :** `CopiedPosition.ts` — seul `peakClosurePnlPercent` existe (ligne 65)
- **Impact :** Un développeur lisant la doc chercherait une colonne `peakPnlPercent` qui n'existe pas
- **Action :** Supprimer `peakPnlPercent` de la doc ou l'ajouter à l'entité

### 🔴 A2 — Comptage migrations erroné (24 vs 26)
- **Fichier :** `docs/code/03-core.md` ligne 28
- **Texte :** « 24 migrations TypeORM »
- **Code :** 26 fichiers de migration
- **Impact :** Désinformation sur le périmètre des migrations
- **Action :** Mettre à jour le compteur à 26

### 🔴 A3 — AlgoPriceTick : champs enrichis massivement sous-documentés
- **Fichier :** `docs/modele-donnees.md` lignes 174–183
- **Texte :** « Métriques enrichies optionnelles : spread, liquidité, exposition positions algo, PnL non réalisé, staleness, etc. »
- **Code :** `AlgoPriceTick.ts` — **30+ champs** (upBid, upAsk, downBid, downAsk, upSpreadPct, downSpreadPct, upAskVwap, downAskVwap, upLiquidityStatus, downLiquidityStatus, priceGap, secondsUntilEnd, bookStalenessMs, wsHealthy, upBidSize, upAskSize, downBidSize, downAskSize, upLastTradePrice, downLastTradePrice, upLastTradeSize, downLastTradeSize, upDelta1s, downDelta1s, openPositionsCount, openExposureUsd, unrealizedPnl, lastSignalOutcome, lastSignalConfidence, lastSignalStrategyId, signalAgeMs)
- **Impact :** La doc ne reflète pas la richesse réelle de l'entité
- **Action :** Documenter exhaustivement les champs enrichis ou ajouter une référence vers le fichier source

---

## 3. Écarts Mineurs

### ⚠️ M1 — CopiedPosition : champs non documentés dans `modele-donnees.md`
| Champ | Présent dans 03-core.md ? |
|-------|--------------------------|
| `lastCloseableBidVwap` / `lastCloseableBidAt` | ❌ Non |
| `slBidPoints` / `tpBidPoints` | ✅ Oui (ligne 43) |
| `closingStartedAt` | ❌ Non |
| `bookUpdatedAt` | ❌ Non |
| `reason` | ❌ Non |
| `peakClosurePnlPercent` | ✅ Oui (ligne 43) |

### ⚠️ M2 — Execution : champs non documentés
- `referenceVwap` — non documenté dans `modele-donnees.md`
- `version` (optimistic lock) — non documenté

### ⚠️ M3 — MoveEventEntity : champs non documentés
- `traderAvgPrice` — non documenté
- `snapshotSeq` — non documenté
- `skipReasons` — non documenté

### ⚠️ M4 — SimulationStateSnapshot : colonnes agrégées non listées
- `amount`, `token`, `positionsValue`, `openPnlSum`, `closedPnlSum`, `baselineCapital`, `positionCount`, `openPositionCount`, `closedPositionCount`, `executionCount`, `traderCount`, `tradersLabel` — non listés individuellement

### ⚠️ M5 — ClobCredentials : champs non documentés
- `builderApiKeyEnc`, `builderSecretEnc`, `builderPassphraseEnc`, `relayerUrl`, `funderAddress`

### ⚠️ M6 — WalletAccount : champs non documentés
- `label`, `sortOrder`

### ⚠️ M7 — SimulationBalance : champ non documenté
- `baselineCapital`

---

## 4. Omissions Documentation

### 📝 O1 — Relations diagramme incomplet
- **Fichier :** `modele-donnees.md` lignes 37–45
- **Manque :** Toutes les entités Algo*, E2E*, MarketPositionTick, IntegrationSettings, SimulationStateSnapshot, SimulationBalance
- **Recommandation :** Étendre le diagramme ou ajouter un second diagramme pour les entités annexes

### 📝 O2 — `03-core.md` ne liste pas les fichiers `risk/`
- **Fichier :** `03-core.md` lignes 84–116
- **Code :** 6 fichiers dans `packages/core/src/risk/` (policy.ts, exit-decision.ts, crypto-algo-exit.ts, crypto-algo-helpers.ts, risk-config-api.ts, sim-mode-fields.ts)
- **Recommandation :** Ajouter une section ou une note sur l'arborescence risk/

### 📝 O3 — `03-core.md` ne mentionne pas `algo-surveillance-positions.ts`
- Service utilitaire `loadAlgoPositionsByConditionIds` non listé
- **Recommandation :** Ajouter une mention dans la section Services ou Arborescence

### 📝 O4 — `03-core.md` ne mentionne pas `crypto-algo-runtime-status.ts`
- Types et parsing du statut runtime crypto-algo
- **Recommandation :** Ajouter une mention

---

## 5. Vérifications Complémentaires

### 5.1 DataSource — entités enregistrées
- **22 entités** dans `data-source.ts` lignes 85–108
- Correspondance exacte avec les 22 fichiers entities/ ✅

### 5.2 DataSource — migrations enregistrées
- **26 migrations** dans `data-source.ts` lignes 56–83
- Correspondance exacte avec les 26 fichiers migrations/ ✅

### 5.3 Types partagés (`types/index.ts`)
- `CopiedPositionStatus` : 7 valeurs (`pending`, `open`, `closing`, `closed`, `failed`, `pending_resolution`, `cancelled`) — aligné avec la doc `modele-donnees.md` ligne 128 ✅
- `ExecutionStatus` : 7 valeurs — doc `modele-donnees.md` ligne 135 mentionne `placing`, `partial`, `filled`, `failed` mais pas `live_on_clob`, `cancelled`, `no_payout` ⚠️
- `SizingMode` : 5 valeurs — aligné ✅
- `OrderReason` : 14 valeurs — non documenté dans `modele-donnees.md` ⚠️

### 5.4 Fichiers Redis (modele-donnees.md lignes 208–218)
- 8 files Redis documentées
- Correspondance avec les files utilisées dans le code — non vérifié (hors périmètre code core)

---

## 6. Plan d'Action Recommandé

| Priorité | Action | Fichier(s) | Effort |
|----------|--------|------------|--------|
| **P0** | Corriger `peakPnlPercent` → `peakClosurePnlPercent` | `modele-donnees.md:121` | 5 min |
| **P0** | Mettre à jour compteur migrations 24→26 | `03-core.md:28` | 2 min |
| **P1** | Documenter les champs enrichis AlgoPriceTick | `modele-donnees.md:174-183` | 30 min |
| **P1** | Documenter les champs crypto-algo RiskConfig manquants | `modele-donnees.md:58-96` | 20 min |
| **P2** | Ajouter les champs CopiedPosition manquants | `modele-donnees.md:116-125` | 15 min |
| **P2** | Compléter le diagramme de relations | `modele-donnees.md:37-45` | 20 min |
| **P3** | Documenter les champs mineurs (Execution, MoveEvent, etc.) | `modele-donnees.md` | 30 min |
| **P3** | Ajouter arborescence risk/ dans 03-core.md | `03-core.md` | 10 min |

---

## Légende

| Symbole | Signification |
|---------|---------------|
| ✅ | Aligné |
| ❌ | Anomalie (désalignement avéré) |
| ⚠️ | Écart mineur (champ non documenté) |
| ℹ️ | Information / note |
| 🔴 | Bloquant |

# Brainstorm — Retrait de `slPercent` / `tpPercent` au profit des bid points uniquement

**Date** : 2026-07-08
**Version** : v1-6
**Contexte** : Audit de l'indicateur SL/TP dans le dialog "Cours marché" pour les positions crypto.

---

## 1. Constat initial

L'audit du dialog "Cours marché" a révélé une **incohérence** entre le frontend et le backend :

- **Frontend** (graphique) : n'affichait que les seuils basés sur `slBidPoints` / `tpBidPoints`
- **Backend** (évaluation des sorties) : évaluait **les deux** modes — bid points ET pourcentages (`slPercent` / `tpPercent`)

Cela signifiait que le graphique pouvait montrer un seuil différent de celui réellement utilisé par le moteur de sortie, induisant l'utilisateur en erreur.

## 2. Analyse d'impact

### Copy trading
- N'utilisait **déjà que** les bid points (`slBidPoints` / `tpBidPoints`)
- `resolveCopyEntryExitParams()` retournait explicitement `slPercent: undefined, tpPercent: undefined`
- **Aucun impact** — le copy trading était déjà en bid points uniquement

### Crypto algo
- Utilisait **les deux** modes :
  - `slBidPoints` / `tpBidPoints` pour les marchés binaires (intervalle reconnu)
  - `slPercent` / `tpPercent` pour les marchés non binaires (fallback mode)
- La résolution se faisait via `pickAlgoExitThreshold()` avec chaîne : override → interval default → mode default

### Décision
**Standardiser sur les bid points uniquement** pour tous les types de trading. Les pourcentages sont inadaptés aux marchés binaires Polymarket (fourchette de prix [0, 1]).

## 3. Implémentation

### 3.1 Retrait de `slPercent` / `tpPercent` dans la logique métier

**Fichiers modifiés** :

| Fichier | Modifications |
|---|---|
| `packages/core/src/risk/crypto-algo-exit.ts` | Retrait de `slPercent`/`tpPercent` de `CRYPTO_INTERVAL_EXIT_DEFAULTS` et `AlgoEntryExitParams`. Suppression de `pickAlgoExitThreshold()`. |
| `packages/core/src/risk/crypto-algo-helpers.ts` | Retrait de `slPercent`/`tpPercent` de `CryptoAlgoExitParams` et `getCryptoAlgoExitParams()`. |
| `packages/core/src/risk/policy.ts` | Retrait de `slPercent`/`tpPercent` de `ModeExitParams`, `CopyEntryExitParams`, `getModeExitParams()`, `resolveCopyEntryExitParams()`, `evaluateSlTpTrailing()`. |
| `packages/core/src/entities/CopiedPosition.ts` | Retrait des colonnes `slPercent`/`tpPercent`. |
| `packages/core/src/services/reservation.service.ts` | Retrait de `slPercent`/`tpPercent` de `ReserveInput`. |

### 3.2 Retrait dans les workers

| Fichier | Modifications |
|---|---|
| `packages/worker/src/processors/strategy/position-exit-evaluator.ts` | Retrait de `slPercent`/`tpPercent` du `slTpInput`. |
| `packages/worker/src/processors/strategy/position-branches.ts` | Retrait du calcul de seuil basé sur `slPercent`. |
| `packages/worker/src/processors/copy/copy-entry-pipeline.ts` | Retrait du calcul `stopDistance` basé sur `slPercent`. |

### 3.3 Retrait dans le pipeline crypto-algo

| Fichier | Modifications |
|---|---|
| `packages/crypto-algo/src/processors/algo-entry-pipeline.ts` | Retrait de `slPercent`/`tpPercent` de l'appel `reservationService.reserve()`. |

### 3.4 Retrait dans le frontend

| Fichier | Modifications |
|---|---|
| `packages/frontend/src/lib/position.ts` | Retrait de `slPercent`/`tpPercent` de l'interface `Position` et de `computeSlDistance()`. |
| `packages/frontend/src/lib/updown-price-chart.ts` | Retrait du fallback percent dans `computePositionLevelThresholds()`. |
| `packages/frontend/src/lib/position-market-chart.ts` | Retrait du mapping percent. |
| `packages/frontend/src/components/UpDownPriceChart.tsx` | Retrait des props percent. |
| `packages/frontend/src/components/OpenPositionRowPnl.tsx` | Retrait du mode percent. |
| `packages/frontend/src/components/MarketChartDialog.tsx` | Retrait du percent des `positionLevels`. |
| `packages/frontend/src/components/MarketChartDialogHost.tsx` | Retrait des props percent. |
| `packages/frontend/src/components/PositionMarketChartTrigger.tsx` | Retrait des props percent. |
| `packages/frontend/src/components/AlgoMarketChartTrigger.tsx` | Retrait des props percent. |
| `packages/frontend/src/components/CryptoAlgoSettingsExitTab.tsx` | Retrait des champs UI `cryptoAlgoSlPercent`/`cryptoAlgoTpPercent`. |
| `packages/frontend/src/components/crypto-algo-settings-types.ts` | Retrait de `cryptoAlgoSlPercent`/`cryptoAlgoTpPercent` du type `CryptoAlgoSettings`. |

### 3.5 Mise à jour des tests

12 fichiers de test mis à jour pour retirer `slPercent`/`tpPercent` des données de test et assertions.

## 4. Bugs détectés et corrigés lors de la vérification finale

### Bug #1 (régression majeure) — Fallback trailing stop perdu
- **Fichier** : `packages/core/src/risk/crypto-algo-exit.ts`
- **Problème** : La suppression de `pickAlgoExitThreshold()` a aussi supprimé le fallback du trailing stop. Quand `cryptoAlgoTrailingStopPercent` était `null` (valeur par défaut), le trailing retournait `null` au lieu de retomber sur l'interval default (ex. 18% pour 5m) puis le mode default.
- **Impact** : Toute nouvelle position crypto-algo sans override explicite perdait son trailing stop.
- **Correction** : Création de `pickAlgoPercentThreshold()` qui restaure la chaîne de fallback : override (0 = désactivé) → interval default → mode default → null.

### Bug #2 (tests cassés) — Positions sans `slBidPoints`
- **Fichier** : `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts`
- **Problème** : 6 tests attendaient un signal `SL` mais `makePos()` ne settait pas `slBidPoints`. Avant le patch, le SL se déclenchait via le fallback `slPercent`.
- **Correction** : Ajout de `slBidPoints: 0.10` et `tpBidPoints: 0.12` dans `makePos()`.

### Bug #3 (test cassé) — `slTpInput` sans `entryBidVwap`
- **Fichier** : `packages/core/src/risk/exit-decision.test.ts`
- **Problème** : Le test "prefers SL over pre-close on the same tick" ne passait pas `entryBidVwap` dans `slTpInput`. Sans `entryBidVwap`, `evaluateSlTpTrailing()` ne peut pas calculer le seuil absolu.
- **Correction** : Ajout de `entryBidVwap: 0.5` dans le `slTpInput` du test.

## 5. Résultat final

| Vérification | Statut |
|---|---|
| `packages/core` — compilation `tsc --noEmit` | OK |
| `packages/worker` — compilation `tsc --noEmit` | OK |
| `packages/crypto-algo` — compilation `tsc --noEmit` | OK |
| `packages/frontend` — compilation `tsc --noEmit` | Erreurs préexistantes uniquement (aucune liée au patch) |
| `packages/core` — tests | **442/442 passed** |
| `packages/worker` — tests | **129/129 passed** |
| `packages/frontend` — tests | **63/63 passed** |
| `packages/crypto-algo` — tests | **29/29 passed** |

## 6. Dette technique restante

Les champs suivants existent toujours dans le code mais ne sont **plus lus** par la logique active :

- `simSlPercent` / `simTpPercent` (colonnes DB `RiskConfig`, validation API, types frontend)
- `realSlPercent` / `realTpPercent` (colonnes DB `RiskConfig`, validation API, types frontend)
- `cryptoAlgoSlPercent` / `cryptoAlgoTpPercent` (colonnes DB `RiskConfig`, validation API, types frontend)

Ces champs sont écrits en base et validés par l'API, mais jamais consommés. Un retrait complet (migration DB, types, validation, UI) est à prévoir dans un patch ultérieur.

## 7. Références

- [Audit initial SL/TP copy trading](../v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md)
- [Plan patch sorties copy bid points](../v1-3/2026-07-07_plan_affichage_entry_sl_tp_graph.md)
- [Patch sorties copy bid points conservative mark](../v1-4/2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md)

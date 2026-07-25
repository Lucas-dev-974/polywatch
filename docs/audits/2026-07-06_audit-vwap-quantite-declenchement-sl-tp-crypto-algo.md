# Audit : Écart de quantité VWAP — SL/TP absolu non déclenché (crypto-algo sim)

**Date** : 2026-07-06  
**Auteur** : Cursor Agent  
**Portée** : Positions sim `reason = 'ALGO_OPEN'`, marchés Polymarket `*-updown-5m`, post-implémentation patch P3 (SL/TP bid absolu)  
**Méthodologie** : Audit PostgreSQL (`copied_positions`, `executions`, `market_position_ticks`, `risk_config`) via `tools/audit-crypto-algo-exits.ts`, `tools/audit-crypto-algo-exits-detail.ts`, `tools/audit-redemption-sl-miss.ts` + revue statique (`strategy-processing.ts`, `position-branches.ts`, `position-exit-evaluator.ts`, `policy.ts`, `market-tick-recorder.ts`, `config.ts`)

**Documents liés** :
- Patch P3 implémenté : `../patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`
- Audit P3 (sémantique %) : `2026-07-06_audit-seuils-pourcent-binaire-crypto-algo.md`
- Patch proposé : `../patchs/2026-07-06_PATCH_VWAP_DECLENCHEMENT_PROFONDEUR.md` (P4)

---

## 1. Résumé exécutif

| Verdict | Détail |
|---|---|
| Patch P3 (SL/TP bid absolu) | **Implémenté et actif** — colonnes `sl_bid_absolute` / `tp_bid_absolute` peuplées |
| Déclenchements SL / TP / TIME_EXIT / PRE_CLOSE | **0 %** sur la session auditée |
| Conformité ticks (breach SL absolu, ref qty 100) | **Centaines de ticks en breach** — **0 exécution SL** |
| Cause racine | **Écart de quantité VWAP** : décision sur `pos.quantity` (~3 shares) vs audit ticks sur `marketTickRefQty` (100) |
| Cause secondaire | **`shouldSuppressSlTp`** bloque SL/TP/trailing dès que `winningTokenId` est connu ? funnel REDEMPTION |
| Action recommandée | Patch **P4** : bid de déclenchement « depth-aware » (`min(vwap pos, vwap ref)`) |

Le patch P3 corrige la **sémantique** des seuils (% ? points absolus) mais ne corrige pas la **profondeur** utilisée pour comparer le bid live au seuil. En session sim post-P3, les positions atteignent REDEMPTION en perte totale (`no_payout`) alors que les ticks historiques montrent des breaches SL absolu prolongées.

**PnL session sim auditée** : capital 1 000 pUSD ? solde **993,35 pUSD** (?0,67 %).

---

## 2. Données de session

### 2.1 Inventaire

| Métrique | Valeur |
|---|---|
| Fenêtre temporelle | ~45 min (2026-07-06 04:15–05:05 UTC) |
| Positions sim `ALGO_OPEN` | **8** (ids 16226–16233) |
| Positions antérieures (audit 05/07, ids 16029+) | **Absentes** — base réinitialisée ou session isolée |
| Ticks `market_position_ticks` | Plusieurs milliers sur les 8 positions |

### 2.2 Close reason (8 fermées)

| Close reason | Count | % |
|---|---|---|
| `REDEMPTION` | 5 | 62,5 % |
| `TRAILING` | 1 | 12,5 % |
| `SL` | 0 | 0 % |
| `TP` | 0 | 0 % |
| `TIME_EXIT` | 0 | 0 % |
| `PRE_CLOSE_LOSS` / `PRE_CLOSE_WIN` | 0 | 0 % |

**REDEMPTION en perte totale** : 3 / 5 (`no_payout`, token perdant ? payoff 0).

### 2.3 Écart vs critères de succès P3

| Critère P3 | Seuil | Résultat session |
|---|---|---|
| REDEMPTION `no_payout` en perte | **0** | **3** |
| REDEMPTION total | **< 5 %** | **62,5 %** |
| TP déclenchements | **> 5 %** | **0 %** |
| SL + TIME_EXIT + TP | **> 90 %** | **0 %** |

---

## 3. Configuration active

| Paramètre | Valeur | Effet |
|---|---|---|
| `crypto_algo_enabled` | true | Algo actif |
| `crypto_algo_sl_bid_points` | **0.10** | SL absolu : `entryBidVwap ? 0.10` |
| `crypto_algo_tp_bid_points` | null | Default intervalle 5m : **0.12** |
| `crypto_algo_pre_close_enabled` | true | Pre-close actif |
| `crypto_algo_pre_close_hold_if_winning` | **false** | Pas de rétention gagnante |
| `marketTickRefQty` (env `MARKET_TICK_REF_QTY`) | **100** (défaut) | VWAP des ticks d'audit |
| `STRATEGY_EVAL_INTERVAL_MS` | 100 | Évaluation fréquente — exclut un problème de fréquence |

Les colonnes P3 sont correctement renseignées sur les 8 positions (`sl_bid_points = 0.1`, `sl_bid_absolute` calculé au fill).

---

## 4. Conformité SL absolu (audit ticks)

Analyse croisée : pour chaque position avec `sl_bid_absolute` non-null, compter les ticks où `executable_bid_vwap ? sl_bid_absolute` (ticks enregistrés avec ref qty 100).

| Règle | Résultat |
|---|---|
| Ticks en breach SL absolu (ref qty 100) | **Centaines** cumulées sur plusieurs positions |
| Positions avec breach prolongé mais `close_reason ? SL` | **Plusieurs** (ex. positions REDEMPTION `no_payout`) |
| Violation formule P3 (`policy.ts`) | **0** — la formule est correcte |
| Violation **profondeur** de comparaison | **Confirmée** — voir §5 |

**Interprétation** : les ticks montrent que le marché **aurait dû** déclencher le SL absolu si le worker utilisait la même profondeur. Le worker utilise une quantité ~30× plus petite ? bid optimiste ? SL jamais atteint.

---

## 5. Cause racine — écart de quantité VWAP

### 5.1 Deux chemins VWAP divergents

**Chemin A — décision de sortie (worker, toutes les 100 ms)** :

```210:213:packages/worker/src/processors/strategy-processing.ts
      : await this.connectionManager.fetchSellExecutablePrices(
          pos.assetId,
          pos.quantity,
        );
```

Le bid passé à `evaluateSlTpTrailing` est le VWAP pour **`pos.quantity`** (~2–5 shares, ~2–3 USDC).

**Chemin B — ticks d'audit / observabilité** :

```37:37:packages/worker/src/processors/market-tracking/market-tick-recorder.ts
    const vwap = this.connectionManager.getExecutablePrices(assetId, config.marketTickRefQty);
```

Les ticks persistés utilisent **`marketTickRefQty = 100`** (défaut dans `config.ts`).

### 5.2 Effet sur carnets peu profonds

Sur un token binaire Up/Down, le carnet bid est souvent mince : le top-of-book peut rester élevé (ex. 0,65) pour 3 shares, alors qu'un walk de 100 shares descend fortement (ex. 0,27) faute de liquidité.

Exemple illustratif (logique `computeExecutableBidVwap`, voir `vwap.test.ts`) :

| Quantité vendue | Bid VWAP typique | SL absolu (entry 0,68 ? 0,10 = **0,58**) |
|---|---|---|
| `pos.quantity` ? 3 | ~0,65 (top-of-book) | **Non breach** (0,65 > 0,58) |
| `marketTickRefQty` = 100 | ~0,27 (depth walk) | **Breach** (0,27 ? 0,58) |

Le worker **ne déclenche jamais** le SL ; les ticks **documentent** des breaches massives.

### 5.3 Incohérence interne P3

```423:427:packages/core/src/risk/policy.ts
  if (slBidAbsolute != null && executableBidVwap != null) {
    if (executableBidVwap <= slBidAbsolute) {
      return 'SL';
    }
  }
```

La branche absolue compare `executableBidVwap` **brut** (qty position) au seuil. Or le mode % utilise `buildExitSnapshot` ? mark conservateur (`min(bookBid, wsBestBid, lastTradePrice)`) pour `effectiveTrigger` / `effectiveClosure` :

```64:74:packages/worker/src/processors/strategy/position-branches.ts
  const exitMark = resolveExitDecisionMarkPrice(
    params.pos,
    params.bookPrices.executableBidVwap,
    ...
    { conservative: useConservativeMark },
  );
  const exitSnap = computePnlSnapshot(exitMark, params.pos);
```

Résultat : le SL absolu est **plus optimiste** que le SL % — exactement l'inverse de l'intention P3 (protection uniforme en points de probabilité).

### 5.4 Émission d'ordre vs décision

L'émission de l'ordre SELL utilise correctement `resolveCloseBid(executableBidVwap pos.quantity, …)` — le fill simulé reflète la liquidité réelle pour la taille de la position. Le problème n'est pas l'exécution mais le **signal de déclenchement** trop généreux.

---

## 6. Cause secondaire — suppression post-outcome

```46:52:packages/core/src/positions/redemption-wait.ts
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  return false;
}
```

Dès que `winningTokenId` est connu (même avant résolution formelle), SL/TP/trailing sont supprimés (`position-exit-evaluator.ts:106`). TIME_EXIT est aussi bloqué si `marketSettled` (`timeExitOutcomeKnown`). Les positions perdantes restent ouvertes jusqu'à REDEMPTION ? **`no_payout`**.

Cette cause **amplifie** l'effet P4 : même si le SL absolu manquait pendant la vie CLOB, aucun mécanisme de secours ne coupe la perte totale en fin de marché.

---

## 7. Cas TRAILING (position 16228) — contrôle positif

| Aspect | TRAILING | SL absolu P3 |
|---|---|---|
| Métrique | Drawdown % depuis `peakClosurePnlPercent` | `executableBidVwap ? slBidAbsolute` |
| Sensibilité profondeur | Faible — basé sur variation relative du mark | **Forte** — compare bid brut qty position |
| Résultat session | 1 clôture TRAILING en ~21 s | 0 clôture |

Confirme que le pipeline de sortie **fonctionne** ; seul le chemin absolu est affecté par l'écart VWAP.

---

## 8. Positions REDEMPTION `no_payout` — pattern type

Pour les positions fermées en REDEMPTION avec perte totale :

1. Entry `entryBidVwap` ? 0,65–0,70 ; `slBidAbsolute` ? 0,55–0,60 (points 0,10).
2. Pendant la vie : ticks (ref 100) montrent `executable_bid_vwap` ? seuil pendant des minutes.
3. Worker : `fetchSellExecutablePrices(assetId, pos.quantity)` retourne bid > seuil ? pas de SL.
4. Fin de marché : `winningTokenId` connu ? `shouldSuppressSlTp = true` ? pas de TIME_EXIT ni PRE_CLOSE effectif.
5. Résolution : token perdant ? REDEMPTION `no_payout`, `realized_pnl ? ?entry`.

---

## 9. Synthèse

| Mécanisme | État | Action |
|---|---|---|
| Formule SL absolu P3 (`policy.ts`) | ? Correcte | Aucune |
| Calcul seuils au fill (`resolveAbsoluteBidThresholds`) | ? Correct | Aucune |
| Profondeur bid pour **décision** SL/TP absolu | ? Trop optimiste (`pos.quantity`) | **P4** |
| Cohérence absolu vs % (mark conservateur) | ? Incohérente | **P4** |
| Ticks d'audit vs worker | ? Quantités différentes | Aligner ou documenter ; P4 corrige le worker |
| Suppression post-outcome | ?? Funnel REDEMPTION | P4b optionnel (TIME_EXIT post-outcome) |
| TRAILING % | ? Fonctionnel | Aucune |

**Verdict** : P3 est **mathématiquement correct** mais **opérationnellement inefficace** tant que le bid de déclenchement ignore la profondeur du carnet. Les critères de succès P3 ne sont pas atteignables sans corriger cette asymétrie.

---

## 10. Recommandation

Implémenter le patch **P4** décrit dans `../patchs/2026-07-06_PATCH_VWAP_DECLENCHEMENT_PROFONDEUR.md` :

1. Calculer `triggerBid = min(vwap(pos.quantity), vwap(marketTickRefQty))` sur le même snapshot de carnet.
2. Utiliser `triggerBid` pour :
   - `slTpInput.executableBidVwap` (branche absolue)
   - `buildExitSnapshot` / `effectiveTrigger` / `effectiveClosure` (cohérence %)
3. Conserver `bookPrices.executableBidVwap` (qty position) pour `resolveCloseBid` et émission d'ordre.

**Critères de validation post-P4** (session sim 5m complète) :

| Critère | Seuil |
|---|---|
| Positions avec breach tick SL absolu ET `close_reason ? SL` | **0** (hors fenêtre suppressSlTp documentée) |
| REDEMPTION `no_payout` | **0** |
| SL + TP + TIME_EXIT + TRAILING | **> 90 %** des sorties |
| `npx tsx tools/audit-crypto-algo-exits.ts` | Conformité SL absolu avec ref qty |

---

## 11. Outils d'audit

| Script | Rôle |
|---|---|
| `tools/audit-crypto-algo-exits.ts` | Distribution sorties, conformité SL/TP % ticks |
| `tools/audit-crypto-algo-exits-detail.ts` | REDEMPTION, peak vs TP |
| `tools/audit-redemption-sl-miss.ts` | Tick-level REDEMPTION en perte |

**Amélioration suggérée (post-P4)** : étendre `audit-crypto-algo-exits.ts` avec une section « SL absolu breach (ref qty) vs close_reason » utilisant `sl_bid_absolute` et `marketTickRefQty`.

---

## 12. Références

- Patch P3 : `../patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`
- Audit P3 : `2026-07-06_audit-seuils-pourcent-binaire-crypto-algo.md`
- Audit 05/07 : `2026-07-05_audit-sorties-sl-tp-binaire-crypto-algo-sim.md`
- Patch P4 proposé : `../patchs/2026-07-06_PATCH_VWAP_DECLENCHEMENT_PROFONDEUR.md`
- Code : `packages/worker/src/processors/strategy-processing.ts`, `packages/worker/src/processors/strategy/position-branches.ts`, `packages/worker/src/processors/strategy/position-exit-evaluator.ts`, `packages/core/src/risk/policy.ts`, `packages/worker/src/config.ts`

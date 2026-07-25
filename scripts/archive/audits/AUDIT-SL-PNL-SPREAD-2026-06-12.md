# Audit — SL, PnL clôture vs marché, spread bid/ask

**Date** : 12 juin 2026 (mis à jour 13 juin 2026)
**Périmètre** : `packages/core` (pricing, risk/policy), `packages/worker` (strategy-processing, copy-processor, executor), `packages/frontend` (affichage PnL), configuration `RiskConfig`
**Contexte** : incident sim — position ouverte affichant ~**−99 %** en « clôture » avec SL configuré à **−80 %** sans déclenchement ; enquête BDD + analyse code
**Méthode** : reproduction UI, audit SQLite (`copied_positions`, `executions`, `risk_config`), lecture des pipelines entrée / mark-to-market / sortie
**Statut correctifs** : filtre **bid/ask à l'entrée** implémenté le 12/06/2026 ; **SL/TP/trailing hybrides** implémentés le 13/06/2026 ; **carnet illiquide** corrigé le 13/06/2026

---

## 1. Synthèse exécutive

| Question | Réponse |
|---|---|
| Le SL à −80 % était-il « cassé » ? | **Non** — il a fonctionné selon la spec code : base **marché** (bid vs bid d'entrée), pas **clôture** (bid vs prix payé) |
| Pourquoi −99 % affiché sans SL ? | **Spread d'entrée extrême** : achat ask ~0,99, bid ~0,01 → perte clôture immédiate, **mouvement marché = 0 %** |
| Correctif entrée déployé ? | **Oui** — `simMinBidToAskRatio` / `realMinBidToAskRatio` (défaut **0,9**, `0` = off) dans `CopyProcessor` |
| Correctif sorties hybrides déployé ? | **Oui** (13/06/2026) — SL hybride OR, TP hybride AND, trailing sur peakClosure, pré-clôture hybride OR |
| Correctif carnet illiquide déployé ? | **Oui** (13/06/2026) — évaluation SL/TP sur dernier mark DB, émission close avec fallback bid, ticks PnL persistés |

**Verdict** : décalage **specification ↔ intuition utilisateur** résolu. Les sorties hybrides (clôture **OU** marché) alignent le SL/TP/trailing sur la perte économique réelle. Le carnet illiquide n'est plus un angle mort pour le SL.

---

## 2. Incident de référence (BDD)

### Position #3444 (swisstony, sim, toujours `open` au moment de l'audit)

| Champ | Valeur |
|---|---|
| Marché | Uruguay vs. Cabo Verde: Cabo Verde O/U 2.5 |
| Outcome | Under |
| `entry_price` (ask payé) | **0,99** |
| `entry_bid_vwap` | **0,01** |
| `executable_bid_vwap` | **0,01** (puis ~0,02) |
| `unrealized_pnl` | **≈ −0,99 pUSD** sur ~1,00 investi |
| `sl_percent` | **80** |
| `peak_pnl_percent` | **+100 %** (bid passé de 0,01 → 0,02) |
| `closing_attempt_seq` | **0** (aucune tentative de clôture) |
| Exécutions | **1× BUY** `COPY_OPEN` filled @ 0,99 — **aucun SELL** |

**Ratios calculés au moment de l'audit**

| Métrique | Formule | Valeur |
|---|---|---|
| **Clôture** (UI) | `(bid − entryPrice) / entryPrice` | **≈ −98,99 %** |
| **Marché** (SL) | `(bid − entryBidVwap) / entryBidVwap` | **0 %** (bid ≈ bid d'entrée) |
| Spread entrée | `entryBidVwap / entryPrice` | **≈ 1 %** |

**Conclusion incident** : la perte existait **dès l'ouverture** (spread), pas après une chute du pari. Le SL à −80 % sur « marché » n'a **jamais** été franchi. **Corrigé** : le SL hybride OR aurait déclenché sur `closure ≤ −80 %`.

### Positions similaires observées (legacy, pré-filtre)

| ID | Marché (extrait) | entry_price | entry_bid | Clôture approx. | Marché approx. | SL 80 % ? |
|---|---|---|---|---|---|---|
| 3444 | Uruguay O/U 2.5 | 0,99 | 0,01 | −99 % | 0 % | Non |
| 3437 | Spain O/U 2.5 | 0,99 | 0,18 | −72 % | +56 % | Non |
| 3403 | Qatar O/U 2.5 | 0,99 | 0,16 | −82 % | +12 % | Non |

Ces positions auraient été **bloquées à l'entrée** avec `minBidToAskRatio = 0,9`. Avec le SL hybride OR, #3403 aurait également déclenché un SL.

---

## 3. Modèle de PnL — deux métriques, un seul bid live

À la **clôture** (vente), seul le **bid exécutable** compte pour le prix de sortie. L'**ask** n'intervient pas dans le mark-to-market ni dans l'exécution SELL.

Les deux colonnes UI utilisent le **même bid actuel** ; elles diffèrent par la **référence** :

| UI | Code | Formule | Rôle |
|---|---|---|---|
| Montant + **clôture** % | `displayPnlPercent` / `unrealizedPnl` | bid vs **`entryPrice`** (ask payé) + frais dans le montant | PnL **économique** si vente maintenant |
| **marché** % | `triggerPnlPercent` | bid vs **`entryBidVwap`** | Base **marché** pour SL/TP/trailing (complémentée par closure) |

**Fichiers**

- Calcul : `packages/core/src/pricing/vwap.ts` — `triggerPnlPercent`, `displayPnlPercent`, `unrealizedPnl`, `closurePnlPercent`
- Évaluation : `packages/worker/src/processors/strategy-processing.ts` — `publishPositionPnl`, `evaluateCloseLogic`
- SL : `packages/core/src/risk/policy.ts` — `evaluateSlTpTrailing`
- Affichage : `packages/frontend/src/components/position/OpenPositionRowPnl.tsx`

**Documentation originale** (intentionnelle) : le trigger « élimine le spread » pour mesurer le pur mouvement de marché — voir `docs/code/03-core.md`, `docs/code/02-pipeline-copy-trading.md`.

**Évolution** : les sorties hybrides utilisent maintenant les **deux** métriques (trigger + closure) pour décider du déclenchement.

---

## 4. Chaîne de sortie automatique (état après correctifs 13/06/2026)

```
StrategyProcessing (~100 ms + tick carnet)
  bidVwap exécutable (qty position)
  trigger = triggerPnlPercent(bid, entryBidVwap)
  closure = closurePnlPercent(bid, entryPrice, fees)
  evaluateSlTpTrailing({ effectiveTrigger: trigger, effectiveClosure: closure })
    → SL: trigger <= -sl OR closure <= -sl  (hybride OR)
    → TP: trigger >= tp AND closure >= tp   (hybride AND)
    → TRAILING: peakClosure - closure >= trailingStop
  evaluateMarketExit({ effectiveTrigger: trigger, effectiveClosure: closure })
    → PRE_CLOSE_LOSS: trigger < 0 OR closure < 0  (hybride OR)
  si closeReason → close-signals (avec fallback bid si illiquide)
```

### Constats par étape (après correctifs)

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| **SL-1** | SL uniquement sur `trigger` | 🔴 Haute | ✅ **Corrigé** — SL hybride OR (`policy.ts` L286-289) |
| **SL-2** | TP / trailing idem | 🟡 Moyenne | ✅ **Corrigé** — TP hybride AND, trailing sur peakClosure (`policy.ts` L293-304) |
| **SL-3** | Pré-clôture perte sur `trigger < 0` | 🟡 Moyenne | ✅ **Corrigé** — hybride OR (`policy.ts` L374-377) |
| **SL-4** | Carnet illiquide → `trigger = 0` | 🔴 Haute | ✅ **Corrigé** — évaluation sur dernier mark DB, closure passé à `evaluateCloseLogic` |
| **SL-5** | Ordre close exige `bidVwap > 0` | 🟡 Moyenne | ✅ **Corrigé** — fallback sur `pos.executableBidVwap ?? pos.entryPrice` |
| **SL-6** | `entryBidVwap === 0` → trigger = 0 | 🟢 Basse | ✅ **Corrigé** — commentaire documentant le sentinel, fallback via closure |
| **SL-7** | Kill switch `force_close_all` skip illiquide | 🟡 Moyenne | ✅ **Corrigé** — fallback sur dernier bid connu ou entryPrice |
| **SL-8** | UI : ticks absents si illiquide | 🟢 Basse | ✅ **Corrigé** — émission de ticks avec dernières valeurs DB persistées |

**Priorité SL** dans `evaluateSlTpTrailing` : **SL → TP → TRAILING** (inchangé).

---

## 5. Chaîne d'entrée

### Correctif implémenté (12/06/2026) — filtre bid/ask variante D

| Élément | Détail |
|---|---|
| Paramètres | `simMinBidToAskRatio`, `realMinBidToAskRatio` dans `RiskConfig` (défaut **0,9**) |
| Logique | `isEntryBidAskRatioAcceptable(bidVwap, askVwap, minRatio)` dans `policy.ts` |
| Point d'application | `CopyProcessor.handleEntry` — **pass 3** VWAP sur qty finale, avant réservation |
| UI | `EnvSettingsDialog` → onglet Entrée |
| Doc | `docs/configuration.md`, `docs/pipeline-copy-trading.md`, etc. |

**Ce que le filtre couvre**

- Spread extrême à l'entrée (ex. ratio ~1 % → refus)
- Entrées sim **et** real (même pipeline)

**Ce que le filtre ne couvre pas**

| Limite | Exemple |
|---|---|
| Seuil 0,90 laisse ~**−10 %** clôture instantanée | ask 1,00 / bid 0,90 autorisé, marché 0 % |
| Spread se dégrade **après** l'entrée | filtre passé au T0, carnet creux plus tard |
| Positions **legacy** | ouvertes avant déploiement |
| `liquidityStatus === 'partial'` | ratio OK sur profondeur partielle, sortie totale incertaine |
| Race snapshot → fill | pass 3 vs fill FAK quelques ms plus tard |

---

## 6. Clôture manuelle et copy-exit

| Chemin | Bid utilisé ? | Note |
|---|---|---|
| SL / TP / trailing / pré-clôture | Oui (live ou fallback DB) | Corrigé SL-4/SL-5 |
| COPY_DECREASE / COPY_CLOSE | Oui (`bidVwap` move) | Pas de filtre spread (sortie trader) |
| POST `/copied-positions/:id/close` | `executableBidVwap ?? entryPrice` | **Stale** — pas de relecture carnet live |
| Exécution SELL (sim/live) | Bid VWAP carnet | Cohérent |

Les clôtures **ne doivent pas** utiliser l'ask ; le code respecte ce principe. Le sujet bid/ask ne concerne que la **prévention à l'achat**.

---

## 7. Analyse « faut-il un SL hybride ? »

### Problème adressé

Aligner le SL sur la question : **« Si je vends au bid maintenant, est-ce que ma perte dépasse X % ? »** (colonne clôture), et non seulement : **« Le bid a-t-il baissé de X % vs le bid à l'entrée ? »**

### Gain

| Scénario | SL avant | SL hybride (OR clôture) |
|---|---|---|
| Legacy spread extrême (#3444) | ❌ | ✅ |
| Legacy spread modéré (#3403, −82 % clôture) | ❌ | ✅ |
| Chute classique du bid | ✅ | ✅ |
| Entrée ratio 0,90, bid stable (−10 % clôture) | ❌ | ❌ (sous −80 %) |

**Complémentarité avec filtre entrée** : sans filtre, un SL hybride seul provoquerait des **open → SL immédiats** sur spread large ; avec filtre + hybride, prévention + filet de sécurité.

### Métrique clôture utilisée pour le seuil

| Option | Formule | Alignement UI |
|---|---|---|
| **Implémentée** | `closurePnlPercent(bid, entryPrice, fees)` | Inclut les frais dans le % — cohérent avec la perte économique réelle |

---

## 8. TP et trailing — cohérence avec le SL

**Question métier** : si le SL doit refléter la clôture, TP et trailing devraient-ils suivre la même logique ?

**Réponse** : **oui, implémenté**.

| Règle | Comportement implémenté |
|---|---|
| **SL** | Marché ≤ −seuil **OU** clôture ≤ −seuil (OR) |
| **TP** | Marché ≥ +seuil **ET** clôture ≥ +seuil (AND — évite TP « fantôme ») |
| **Trailing** | Pic et drawdown sur **clôture** (`peakClosurePnlPercent`) |
| **Pré-clôture perte** | `trigger < 0` **OU** `closure < 0` (OR) |

### Choix OR vs AND (TP)

| Mode | Effet |
|---|---|
| **OR** | Plus agressif — TP dès qu'une métrique atteint le seuil |
| **AND** (implémenté) | Conservateur — TP seulement si gain **réel** (clôture) **et** mouvement marché confirmé |

---

## 9. Carnet illiquide — patch implémenté

**Problème** : quand `executableBidVwap = 0`, le moteur passait `effectiveTrigger = 0` → aucun SL même si la dernière valeur persistée indiquait −90 % clôture.

**Correctif (13/06/2026)**

1. **Évaluation** : utiliser `pos.executableBidVwap`, `pos.peakPnlPercent`, `pos.peakClosurePnlPercent` persistés pour calculer trigger + closure, au lieu de forcer 0.
2. **Émission ordre** : fallback sur `pos.executableBidVwap ?? pos.entryPrice` quand bid live = 0.
3. **Ticks UI** : émission de ticks PnL avec les dernières valeurs DB même quand le carnet est illiquide.

---

## 10. Matrice des risques résiduels (post-correctifs 13/06/2026)

| Risque | Gravité | Mitigation | Statut |
|---|---|---|---|
| Perte clôture > SL, marché plat | 🔴 | SL hybride OR | ✅ Corrigé |
| Position legacy piégée | 🔴 | SL hybride + clôture manuelle | ✅ Corrigé |
| Bid → 0, SL paralysé | 🔴 | Eval sur dernier mark + fallback bid | ✅ Corrigé |
| −10 % instantané (ratio 0,90) | 🟡 | Accepté par config | ⚠️ Configurable |
| Partial book à l'entrée | 🟡 | Non géré | ⚠️ Restant |
| TP incohérent avec clôture | 🟡 | TP hybride AND | ✅ Corrigé |
| Trailing sur pic marché | 🟡 | Peak clôture | ✅ Corrigé |
| UI ticks périmés | 🟢 | Ticks persistés sur illiquide | ✅ Corrigé |

---

## 11. Correctifs appliqués (13/06/2026)

### Phase 1 — Sorties hybrides (core + worker) ✅

**Fichiers modifiés**

- `packages/core/src/risk/policy.ts` — `evaluateSlTpTrailing` :
  - SL : `trigger <= -sl OR closure <= -sl` (OR)
  - TP : `trigger >= tp AND closure >= tp` (AND)
  - Trailing : drawdown depuis `peakClosurePnlPercent`
- `packages/core/src/risk/policy.ts` — `evaluateMarketExit` :
  - `trigger < 0 OR closure < 0` pour `PRE_CLOSE_LOSS`
- `packages/core/src/pricing/vwap.ts` — `closurePnlPercent` (avec frais)
- `packages/core/src/entities/CopiedPosition.ts` — `peakClosurePnlPercent`, `lastValidTriggerPnlPercent`
- `packages/worker/src/processors/strategy-processing.ts` — passage `closure` + `peakClosure` à `evaluateCloseLogic` ; branche illiquide : dernier mark DB
- `packages/core/src/risk/policy.test.ts` — cas #3444, #3403, TP AND, trailing drawdown

### Phase 2 — Trailing + pré-clôture alignés ✅

- `peakClosurePnlPercent` persisté et calculé dans `publishPositionPnl`
- Trailing : drawdown depuis pic **clôture**
- `evaluateMarketExit` : hybride OR

### Phase 3 — Robustesse ✅

- Carnet illiquide : évaluation SL/TP sur dernier mark DB (SL-4)
- Émission close : fallback bid quand `bidVwap = 0` (SL-5)
- Kill switch : fallback bid pour positions illiquides (SL-7)
- Ticks UI : émission avec dernières valeurs DB quand illiquide (SL-8)
- Circuit breaker API Polymarket (OPT-4)
- Métriques Prometheus (OPT-8)
- Reconnexion WS infinie (OPT-5)
- Cache LRU avec limite (OPT-11)
- Alerte dead-letter (OPT-7)
- Compression WebSocket (OPT-14)
- Requêtes N+1 optimisées (OPT-1)
- Health check DB (OPT-9)

---

## 12. Points ouverts pour validation produit

| # | Question | Statut |
|---|---|---|
| V1 | SL hybride **OR** clôture | ✅ Implémenté (OR) |
| V2 | TP : **OR** ou **AND** avec clôture | ✅ Implémenté (AND) |
| V3 | Trailing : pic **clôture** ou dual | ✅ Implémenté (peakClosurePnlPercent) |
| V4 | % clôture SL : avec ou sans frais | ✅ Implémenté (`closurePnlPercent` avec frais) |
| V5 | Illiquide : éval sur dernier mark | ✅ Implémenté |
| V6 | Seuil entrée 0,90 → resserrer à 0,95 ? | ⚠️ Config utilisateur |

---

## 13. Références code

| Sujet | Fichier |
|---|---|
| Trigger / display / closure PnL | `packages/core/src/pricing/vwap.ts` |
| SL / TP / trailing | `packages/core/src/risk/policy.ts` |
| Boucle stratégie | `packages/worker/src/processors/strategy-processing.ts` |
| Filtre entrée bid/ask | `packages/worker/src/processors/copy-processor.ts` |
| Finalisation entry bid | `packages/core/src/services/execution.service.ts`, `packages/worker/src/processors/executor.ts` |
| Clôture manuelle | `packages/backend/src/routes/positions.ts` |
| UI dual PnL | `packages/frontend/src/lib/position.ts`, `OpenPositionRowPnl.tsx` |
| Audit BDD scripts | `scripts/audit-sl-position.mjs`, `scripts/audit-spread-mismatch.mjs` |
| Doc filtre entrée | `docs/configuration.md` § filtre bid/ask |
| Circuit breaker | `packages/worker/src/polymarket/circuit-breaker.ts` |
| Métriques Prometheus | `packages/backend/src/metrics.ts` |

---

## 14. Historique

| Date | Action |
|---|---|
| 2026-06-12 | Incident #3444 signalé ; analyse code + BDD |
| 2026-06-12 | Implémentation `*MinBidToAskRatio` (entrée) + documentation |
| 2026-06-12 | Rédaction audit ; proposition sorties hybrides en attente validation |
| 2026-06-13 | Implémentation SL/TP/trailing hybrides (OR/AND) + peakClosure |
| 2026-06-13 | Implémentation correctifs carnet illiquide (SL-4 à SL-8) |
| 2026-06-13 | Implémentation circuit breaker, métriques, WS reconnect, LRU, dead-letter alert, compression WS |
| 2026-06-13 | Mise à jour de l'audit — tous les constats SL-1 à SL-8 sont corrigés |

---

*Fin du document — `audits/AUDIT-SL-PNL-SPREAD-2026-06-12.md`*

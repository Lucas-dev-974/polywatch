# Brainstorm — Patch : SL/TP copy trading déclenché sur le mauvais mark (conservateur)

**Date** : 2026-07-08
**Version cible** : v1-4
**Auteur** : Audit BDD + analyse code
**Tags** : `bug`, `SL`, `copy-trading`, `bid-points`, `conservative-mark`, `exit-decision`

---

## 1. Résumé du bug

Les positions **copy trading simulation** (mode bid points) voient leur SL se déclencher à des pertes de **-0.5% à -4%**, alors que la configuration `sim_sl_bid_points: 0.2` devrait les déclencher à des pertes de **-32% à -77%**.

**Cause racine** : Dans `buildPositionExitContext()` (`position-branches.ts`), le PnL de déclenchement SL/TP (`exitSnap.trigger` / `exitSnap.closure`) est calculé à partir du **mark conservateur** (minimum de tous les candidats : bookBid, wsBestBid, lastTradePrice, lastCloseableBidVwap). Un `lastTradePrice` obsolète et très bas fait chuter artificiellement le PnL, ce qui déclenche le SL prématurément.

---

## 2. Flux du bug (pas à pas)

### 2.1 Précision : la décision SL/TP n'est PAS faite sur `lastTradePrice` seul

Le flux est en **deux temps** :

1. **Premier PnL** : calculé sur le **vrai prix exécutable du carnet d'ordres** (`bookPrices.triggerBidVwap` ou `executableBidVwap`). Ce PnL sert à décider si le mode conservateur est activé.
2. **Second PnL (recalculé)** : si le mode conservateur est actif, le PnL est **recalculé** sur `min(bookBid, wsBestBid, lastTradePrice, lastCloseableBid)`. C'est ce PnL recalculé qui est utilisé pour la décision SL/TP.

**Conditions d'activation du mode conservateur :**
- Marché illiquide → toujours
- Position en perte (`trigger < 0` OU `closure < 0`) → même -0.01%
- Fenêtre de time-exit active

**Donc `lastTradePrice` n'intervient que quand :**
1. La position est déjà en perte (même infime)
2. **ET** `lastTradePrice` est plus bas que le prix du carnet d'ordres

### 2.2 Diagramme complet

```
evaluateLiquidPosition() / evaluateIlliquidPosition()
  │
  ├─ 1. PnL initial sur le VRAI prix du carnet d'ordres
  │   markPrice = getPositionMarkPrice(pos, bookPrices.triggerBidVwap, lifecycle)
  │   {trigger, closure} = computePnlSnapshot(markPrice, pos)
  │   → trigger = (0.67 - 0.66) / 0.66 * 100 = +1.5%  (vrai prix marché)
  │   → closure = (0.67 - 0.67) / 0.67 * 100 = -0.46%  (frais inclus)
  │
  └─ buildPositionExitContext({trigger: +1.5%, closure: -0.46%, ...})
      │
      ├─ shouldUseConservativeExitMark({trigger: +1.5%, closure: -0.46%, ...})
      │   └─ closure < 0 → true ! (même pour -0.46%)
      │
      ├─ 2. PnL RECALCULÉ sur le mark conservateur
      │   exitMark = resolveExitDecisionMarkPrice(bookBid=0.67, lastTradePrice=0.01, ..., {conservative: true})
      │   │   └─ Math.min(0.67, 0.01, ...) = 0.01  ← lastTradePrice stale
      │   │
      │   exitSnap = computePnlSnapshot(exitMark=0.01, pos)
      │       └─ trigger = (0.01 - 0.66) / 0.66 * 100 = -98.5%  ← FAUX !
      │       └─ closure = (0.01 - 0.67) / 0.67 * 100 = -98.5%  ← FAUX !
      │
      └─ evaluateCloseLogic(trigger=-98.5%, closure=-98.5%, ...)
          └─ evaluateSlTpTrailing()
              ├─ slBidAbsolute = 0.66 - 0.4 = 0.26
              ├─ impliedBid = 0.66 * (1 + (-98.5/100)) = 0.01
              └─ 0.01 <= 0.26 → SL déclenché ! ❌
```

---

## 3. Positions impactées (vérifiées en BDD)

| Position | entryBidVwap | slBidPoints | Perte réelle | Perte attendue | close_reason |
|----------|-------------|-------------|-------------|----------------|--------------|
| 17305 | 0.517 | 0.4 | -0.86% | -77.4% | SL |
| 17332 | 0.93 | 0.4 | -1.06% | -43.0% | SL |
| 17334 | 0.59 | 0.4 | -4.13% | -67.8% | SL |
| 17341 | 0.660 | 0.4 | -0.46% | -60.6% | SL |
| 17348 | 0.62 | 0.2 | -3.13% | -32.3% | SL |
| 17353 | 0.31 | 0.2 | -3.13% | -64.5% | SL |

---

## 4. Analyse du code existant

### 4.1 `buildPositionExitContext()` — le point problématique

```typescript
// position-branches.ts:87-105
const useConservativeMark = shouldUseConservativeExitMark({ trigger, closure, ... });
const exitMark = resolveExitDecisionMarkPrice(pos, bookBid, ..., { conservative: useConservativeMark });
const exitSnap = computePnlSnapshot(exitMark, pos);  // ← BUG
```

Le `exitSnap` (trigger/closure) est calculé sur le mark conservateur, puis passé à `evaluateCloseLogic()` comme `effectiveTrigger`/`effectiveClosure`. C'est ce PnL faussé qui alimente `evaluateSlTpTrailing()`.

### 4.2 `shouldUseConservativeExitMark()`

```typescript
// crypto-algo-exit.ts:483-499
function shouldUseConservativeExitMark(input) {
  if (input.liquidityStatus === 'illiquid') return true;
  if (input.trigger < 0 || input.closure < 0) return true;  // ← trop sensible
  if (input.timeExitSeconds > 0 && input.timeToEndMs <= input.timeExitSeconds * 1000) return true;
  return false;
}
```

Le mode conservateur s'active **dès la moindre perte** (même -0.01%). C'est un seuil trop bas pour les positions copy trading qui oscillent constamment autour de zéro.

### 4.3 `resolveExitDecisionMarkPrice()`

```typescript
// crypto-algo-exit.ts:528-565
function resolveExitDecisionMarkPrice(position, bookBid, lifecycle, liquidityStatus, wsBestBid, now, lastTradePrice, options) {
  const candidates = [];
  if (bookBid > 0) candidates.push(bookBid);
  if (wsBestBid != null && wsBestBid > 0) candidates.push(wsBestBid);
  if (lastTradePrice != null && lastTradePrice > 0) candidates.push(lastTradePrice);  // ← stale price
  if (freshLastCloseable != null) candidates.push(freshLastCloseable);
  return Math.min(...candidates);
}
```

`lastTradePrice` est inclus sans vérification de fraîcheur. Un `lastTradePrice` de plusieurs minutes (voire heures) peut être très éloigné du prix réel du marché.

### 4.4 `evaluateSlTpTrailing()` — mode bid points

```typescript
// policy.ts:487-492
if (slBidPoints != null && entryBidVwap != null && entryBidVwap > 0) {
  const slBidAbsolute = entryBidVwap - slBidPoints;
  const impliedBid = entryBidVwap * (1 + effectiveTrigger / 100);
  if (effectiveTrigger <= 0 && impliedBid <= slBidAbsolute) {
    return 'SL';
  }
}
```

La condition `effectiveTrigger <= 0` est toujours vraie quand le PnL est artificiellement négatif à cause du mark conservateur.

---

## 5. Solutions envisagées

### Solution A : Séparer le PnL de décision du PnL de sortie

**Principe** : Le SL/TP doit être évalué sur le **prix de marché réel** (bookBid), pas sur le mark conservateur. Le mark conservateur ne sert qu'à déterminer le **prix de vente** une fois la décision prise.

**Modification** : Dans `buildPositionExitContext()`, calculer `exitSnap` sur le `bookBid` (ou `triggerBidVwap`) plutôt que sur `exitMark`.

```typescript
// Nouveau : PnL pour la décision SL/TP
const decisionSnap = computePnlSnapshot(bookPrices.triggerBidVwap ?? bookPrices.executableBidVwap, pos);
// Ancien : PnL pour le prix de sortie (conservateur)
const exitSnap = computePnlSnapshot(exitMark, pos);
```

**Avantages** :
- Simple, changement localisé
- Ne casse pas le mécanisme de prix de sortie conservateur

**Inconvénients** :
- Le PnL affiché dans les ticks restera sur le mark conservateur (cohérent avec l'affichage actuel)

### Solution B : Ajouter un seuil de perte minimale pour le mode conservateur

**Principe** : Ne pas activer le mode conservateur pour des pertes infimes (< 1%).

```typescript
function shouldUseConservativeExitMark(input) {
  if (input.liquidityStatus === 'illiquid') return true;
  if (input.trigger < -1 || input.closure < -1) return true;  // ← seuil à -1% au lieu de 0
  if (input.timeExitSeconds > 0 && input.timeToEndMs <= input.timeExitSeconds * 1000) return true;
  return false;
}
```

**Avantages** : Simple, évite les faux positifs pour les petites fluctuations.

**Inconvénients** : Ne résout pas le problème si `lastTradePrice` est très stale et que la perte réelle dépasse -1%.

### Solution C : Filtrer `lastTradePrice` par fraîcheur dans `resolveExitDecisionMarkPrice()`

**Principe** : N'inclure `lastTradePrice` dans les candidats que s'il est suffisamment récent.

```typescript
const LAST_TRADE_MAX_AGE_MS = 120_000; // 2 minutes
if (lastTradePrice != null && lastTradePrice > 0 && lastTradeTimestamp != null && now - lastTradeTimestamp.getTime() <= LAST_TRADE_MAX_AGE_MS) {
  candidates.push(lastTradePrice);
}
```

**Avantages** : Empêche les prix obsolètes de fausser le mark.

**Inconvénients** : Nécessite de passer `lastTradeTimestamp` à la fonction (déjà disponible dans le pipeline).

### Solution D : Combinaison A + C (recommandée)

**Principe** : 
1. Le PnL de décision SL/TP utilise le prix de marché réel (Solution A)
2. Le prix de sortie reste conservateur mais avec un filtre de fraîcheur sur `lastTradePrice` (Solution C)

**Avantages** : Résout le bug à la racine sans compromettre la sécurité des sorties.

---

## 6. Impact sur les autres modes

| Mode | Impact | Raison |
|------|--------|--------|
| **Copy trading sim** | ✅ Corrigé | Le PnL de décision utilise le vrai prix de marché |
| **Copy trading real** | ✅ Corrigé | Même logique |
| **Crypto algo sim** | ✅ Neutre | Les positions algo ont des seuils % plus larges (12%) et des bid points plus serrés (0.10) |
| **Crypto algo real** | ✅ Neutre | Idem |

---

## 7. Plan d'implémentation

1. **Modifier `buildPositionExitContext()`** dans `position-branches.ts` :
   - Calculer `decisionSnap` sur le prix de marché réel
   - Passer `decisionSnap.trigger` et `decisionSnap.closure` à `evaluateCloseLogic()`
   - Garder `exitSnap` pour le prix de sortie et l'affichage

2. **Optionnel : Ajouter un filtre de fraîcheur** sur `lastTradePrice` dans `resolveExitDecisionMarkPrice()`

3. **Tester** :
   - Vérifier que les positions copy ne déclenchent plus de SL prématuré
   - Vérifier que les sorties conservatrices (pré-close, time-exit) fonctionnent toujours
   - Vérifier que le prix de vente reste correct (conservateur si nécessaire)

---

## 8. Questions ouvertes

- [ ] Faut-il aussi corriger le PnL affiché dans les ticks (`publishPositionPnl`) ou seulement le PnL de décision ?
- [ ] Le filtre de fraîcheur sur `lastTradePrice` doit-il être le même que celui de `isTimeExitMarkFresh` (120s) ou différent ?
- [ ] Faut-il un mécanisme de logging pour détecter les cas où le mark conservateur est significativement différent du prix de marché ?
- [ ] Les positions crypto-algo sont-elles aussi impactées ? Leurs seuils % plus larges (12%) les protègent-elles suffisamment ?

---

## 9. Clarification : la décision SL/TP n'est PAS faite sur `lastTradePrice` seul

Le flux est en **deux temps** :

1. **Premier PnL** : calculé sur le **vrai prix exécutable du carnet d'ordres** (`bookPrices.triggerBidVwap` ou `executableBidVwap`). Ce PnL sert à décider si le mode conservateur est activé.
2. **Second PnL (recalculé)** : si le mode conservateur est actif, le PnL est **recalculé** sur `min(bookBid, wsBestBid, lastTradePrice, lastCloseableBid)`. C'est ce PnL recalculé qui est utilisé pour la décision SL/TP.

**Conditions d'activation du mode conservateur :**
- Marché illiquide → toujours
- Position en perte (`trigger < 0` OU `closure < 0`) → même -0.01%
- Fenêtre de time-exit active

**Donc `lastTradePrice` n'intervient que quand :**
1. La position est déjà en perte (même infime)
2. **ET** `lastTradePrice` est plus bas que le prix du carnet d'ordres

### 9.1 Tableau récapitulatif : quel prix pour quelle décision ?

| Condition | Prix utilisé pour la décision SL/TP | Source |
|-----------|--------------------------------------|--------|
| Position en gain (`trigger >= 0` ET `closure >= 0`) | Prix exécutable du carnet d'ordres ✅ | `bookPrices.triggerBidVwap` |
| Position en perte (`trigger < 0` OU `closure < 0`) | Min(bookBid, wsBestBid, lastTradePrice, lastCloseableBid) ⚠️ | `resolveExitDecisionMarkPrice()` |
| Marché illiquide | Min(bookBid, wsBestBid, lastTradePrice, lastCloseableBid) ⚠️ | `resolveExitDecisionMarkPrice()` |
| Fenêtre de time-exit active | Min(bookBid, wsBestBid, lastTradePrice, lastCloseableBid) ⚠️ | `resolveExitDecisionMarkPrice()` |

---

## 10. Inventaire complet des erreurs de la pipeline SL

| # | Erreur | Fichier | Lignes | Sévérité | Description |
|---|--------|---------|--------|----------|-------------|
| **E1** | `buildPositionExitContext()` recalcule le PnL sur le mark conservateur | `position-branches.ts` | 94-104 | **CRITIQUE** | Le PnL de décision SL/TP (`exitSnap`) est recalculé sur `exitMark` (minimum de toutes les sources) au lieu d'utiliser le vrai prix de marché. Un `lastTradePrice` stale et bas fait chuter artificiellement le PnL, déclenchant le SL prématurément. |
| **E2** | `shouldUseConservativeExitMark()` activé dès la moindre perte | `crypto-algo-exit.ts` | 490-491 | **HAUTE** | `trigger < 0 || closure < 0` active le mode conservateur même pour -0.01%. Les positions copy trading oscillent constamment autour de zéro, donc le mode conservateur est quasi-permanent. |
| **E3** | `resolveExitDecisionMarkPrice()` inclut `lastTradePrice` sans filtre de fraîcheur | `crypto-algo-exit.ts` | 555-557 | **HAUTE** | `lastTradePrice` est ajouté aux candidats sans vérifier son timestamp. Un trade de plusieurs minutes/heures peut être très éloigné du prix réel. |
| **E4** | `evaluateSlTpTrailing()` condition `effectiveTrigger <= 0` trop large en mode bid points | `policy.ts` | 490 | **MOYENNE** | En mode bid points, la condition `effectiveTrigger <= 0` est toujours vraie quand le PnL est artificiellement négatif (à cause de E1). Elle devrait comparer le prix implicite au seuil sans exiger `effectiveTrigger <= 0`. |
| **E5** | `computePnlSnapshot()` appelée deux fois avec des marks différents | `position-branches.ts` + `position-evaluator.ts` | 33-55, 104 | **MOYENNE** | Le PnL est d'abord calculé sur le vrai prix de marché (dans `evaluateLiquidPosition()` / `evaluateIlliquidPosition()`), puis **recalculé** sur le mark conservateur dans `buildPositionExitContext()`. Le premier résultat est écrasé. |
| **E6** | `exitSnap` sert à la fois pour la décision ET pour le prix de sortie | `position-branches.ts` | 104, 107-108 | **MOYENNE** | Le même `exitSnap` est utilisé pour la décision SL/TP (via `evaluateCloseLogic`) ET pour le prix de sortie (via `exitMark`). Ces deux usages ont des besoins différents : le premier a besoin du prix de marché réel, le second du prix conservateur. |
| **E7** | `lastTradePrice` peut être stale de plusieurs minutes/heures | `market-metrics-cache.ts` | 43-54 | **MOYENNE** | `MarketMetricsCache.updateLastTrade()` stocke le prix sans timestamp de fraîcheur exploitable. Le `lastTradeTimestamp` existe mais n'est pas utilisé dans `resolveExitDecisionMarkPrice()`. |
| **E8** | Les positions copy trading n'ont pas de `sl_percent` de fallback | `policy.ts` | 109-138 | **BASSE** | `resolveCopyEntryExitParams()` retourne `slPercent: undefined`. Si `slBidPoints` était null, le SL serait complètement désactivé. Il n'y a pas de fallback vers le `sim_sl_percent: 40` de la RiskConfig. |
| **E9** | `triggerBidVwap` vs `executableBidVwap` : confusion possible | `connection-manager.ts` | 198-207 | **BASSE** | `triggerBidVwap` est le min entre le prix pour la quantité de la position et le prix pour la quantité de référence. `executableBidVwap` est le prix pour la quantité de la position. Le mark conservateur utilise `triggerBidVwap` mais le PnL recalculé ne distingue pas les deux. |
| **E10** | Pas de logging quand le mark conservateur diffère significativement du prix de marché | `position-branches.ts` | 87-104 | **BASSE** | Aucun avertissement n'est émis quand `exitMark` est significativement différent de `bookBid` (ex: 0.01 vs 0.67). Il est impossible de diagnostiquer le bug sans audit BDD manuel. |
| **E11** | Fallback d'émission (`lastCloseableBid`, `lastTradePrice`) réservé à TIME_EXIT / PRE_CLOSE, pas SL/TRAILING | `position-exit-evaluator.ts` | 269-304 | **CRITIQUE** | Le SL peut être **décidé** sur le mark conservateur mais **jamais émis** si le carnet live est vide (`emitBid=0`). `forced_exit_failed_attempts` reste à 0 ; hold silencieux jusqu'à REDEMPTION. Corrigé par `patch_sl_emit_blocked_no_close_bid`. |

### 10.1 Chaîne causale des erreurs

```
E2 (seuil trop sensible)
  → active le mode conservateur pour toute perte, même -0.01%
    → E3 (lastTradePrice sans filtre de fraîcheur)
      → lastTradePrice stale à 0.01 est inclus dans les candidats
        → E1 (PnL recalculé sur le minimum)
          → PnL artificiellement à -98.5%
            → E4 (effectiveTrigger <= 0 toujours vrai)
              → SL déclenché prématurément ❌
```

### 10.2 Matrice de correction

| Erreur | Solution A | Solution B | Solution C | Solution D |
|--------|-----------|-----------|-----------|-----------|
| **E1** | ✅ Corrigé | ❌ Non traité | ❌ Non traité | ✅ Corrigé |
| **E2** | ❌ Non traité | ✅ Corrigé | ❌ Non traité | ❌ Non traité |
| **E3** | ❌ Non traité | ❌ Non traité | ✅ Corrigé | ✅ Corrigé |
| **E4** | ✅ Corrigé (indirectement) | ❌ Non traité | ❌ Non traité | ✅ Corrigé (indirectement) |
| **E5** | ✅ Corrigé | ❌ Non traité | ❌ Non traité | ✅ Corrigé |
| **E6** | ✅ Corrigé | ❌ Non traité | ❌ Non traité | ✅ Corrigé |
| **E7** | ❌ Non traité | ❌ Non traité | ✅ Corrigé | ✅ Corrigé |
| **E8** | ❌ Non traité | ❌ Non traité | ❌ Non traité | ❌ Non traité |
| **E9** | ❌ Non traité | ❌ Non traité | ❌ Non traité | ❌ Non traité |
| **E10** | ❌ Non traité | ❌ Non traité | ❌ Non traité | ❌ Non traité |

---

## 11. Patch implémenté

### 11.1 Résumé des modifications

| Fichier | Modification | Erreurs corrigées |
|---------|-------------|-------------------|
| `packages/core/src/risk/crypto-algo-exit.ts` | Ajout du paramètre `lastTradeTimestamp` à `resolveExitDecisionMarkPrice()` + filtre de fraîcheur (≤ 120s) sur `lastTradePrice` | **E3, E4, E7** |
| `packages/core/src/risk/crypto-algo-exit.ts` | Export de `DEFAULT_LAST_TRADE_MAX_AGE_MS` (120s × 1000) | **E7** |
| `packages/worker/src/processors/strategy/position-branches.ts` | Passage de `lastTradeTimestamp` à `buildPositionExitContext()` et `resolveExitDecisionMarkPrice()` | **E3, E4** |
| `packages/worker/src/processors/strategy/position-branches.ts` | Ajout d'un log `[CONSERVATIVE_MARK]` quand le mark conservateur diffère de >5% du prix de marché | **E10** |
| `packages/core/src/risk/crypto-algo-exit.test.ts` | 2 nouveaux tests : stale timestamp et absence de timestamp | **E3, E7** |
| `packages/worker/src/processors/strategy/position-branches.test.ts` | Ajout de `lastTradeTimestamp` au test existant | **E3** |

### 11.2 Décisions et justifications

#### Décision 1 : Ne PAS séparer le PnL de décision du PnL de sortie (contrairement à la Solution A)

**Justification** : Le test `uses last trade price as conservative mark when stale bid masks a stop-loss breach` montre un cas où `executableBidVwap = 0` (marché illiquide sans carnet). Dans ce cas, le PnL de décision DOIT être calculé sur le mark conservateur car il n'y a pas de prix de marché réel disponible. Séparer les deux PnL créerait un bug inverse : les positions sur marchés illiquides ne déclencheraient plus jamais leur SL.

**Risque évité** : Bug fantôme où les SL ne se déclenchent plus sur les marchés illiquides.

#### Décision 2 : Filtrer `lastTradePrice` par fraîcheur (Solution C uniquement)

**Justification** : C'est la cause racine du bug. `lastTradePrice` est un prix de la dernière transaction exécutée, qui peut dater de plusieurs minutes/heures sur les marchés peu liquides. En exigeant un timestamp frais (≤ 120s, même seuil que `isTimeExitMarkFresh`), on empêche les prix obsolètes de fausser le mark conservateur.

**Seuil choisi** : 120 secondes (identique à `DEFAULT_CRYPTO_TIME_EXIT_LAST_TRADE_MAX_AGE_SECONDS`). Ce seuil est déjà validé par le code existant pour la fraîcheur des marks de time-exit.

**Risque évité** : Un `lastTradePrice` stale de 5 minutes à 0.01 ne peut plus faire chuter artificiellement le PnL à -98.5%.

#### Décision 3 : Ajouter un log quand le mark conservateur diffère significativement

**Justification** : Sans log, le bug est indétectable sans audit BDD manuel. Le seuil de 5% est suffisamment bas pour capturer les anomalies sans être trop bavard.

**Risque évité** : Impossible de diagnostiquer le bug en production.

#### Décision 4 : Ne PAS modifier `shouldUseConservativeExitMark()` (contrairement à la Solution B)

**Justification** : Avec le filtre de fraîcheur sur `lastTradePrice`, le mode conservateur n'est plus dangereux. Il reste utile pour :
- Les marchés illiquides où le carnet d'ordres peut cacher une perte réelle
- Les positions en perte où le prix de sortie doit être conservateur
- La fenêtre de time-exit

Modifier le seuil de `trigger < 0` à `trigger < -1` introduirait un risque de non-déclenchement de SL sur des pertes réelles de -0.5% à -1%.

**Risque évité** : Non-déclenchement de SL sur des pertes réelles modérées.

#### Décision 5 : Ne PAS ajouter de fallback `sl_percent` pour le copy trading (E8)

**Justification** : Le copy trading utilise intentionnellement les bid points (`slBidPoints`/`tpBidPoints`), pas les pourcentages. `resolveCopyEntryExitParams()` retourne `slPercent: undefined` par conception. Ajouter un fallback vers `sim_sl_percent: 40` serait incohérent avec le mode bid points.

**Risque évité** : Incohérence entre la configuration et le comportement attendu.

### 11.3 Matrice de correction finale

| Erreur | Statut | Justification |
|--------|--------|---------------|
| **E1** | ✅ Corrigé indirectement | Le filtre de fraîcheur empêche `lastTradePrice` stale de fausser le PnL. Le PnL reste calculé sur le mark conservateur, mais ce mark n'inclut plus de prix obsolètes. |
| **E2** | ❌ Non corrigé (intentionnel) | Le seuil `trigger < 0 || closure < 0` est nécessaire pour les marchés illiquides. Avec E3 corrigé, il n'y a plus de risque de faux positif. |
| **E3** | ✅ Corrigé | `lastTradePrice` n'est inclus dans les candidats que si son timestamp est frais (≤ 120s). |
| **E4** | ✅ Corrigé indirectement | Avec E3 corrigé, `lastTradePrice` stale n'est plus inclus, donc `effectiveTrigger <= 0` ne peut plus être déclenché par un prix obsolète. |
| **E5** | ❌ Non corrigé (intentionnel) | Le double calcul du PnL est nécessaire : le premier sur le prix de marché réel (pour l'affichage), le second sur le mark conservateur (pour la décision de sortie). Avec E3 corrigé, le second calcul n'est plus faussé. |
| **E6** | ❌ Non corrigé (intentionnel) | `exitSnap` sert à la fois pour la décision et le prix de sortie. C'est un choix de conception valide tant que le mark conservateur est fiable (ce qui est le cas avec E3 corrigé). |
| **E7** | ✅ Corrigé | Le filtre de fraîcheur utilise `lastTradeTimestamp` pour exclure les prix obsolètes. |
| **E8** | ❌ Non corrigé (hors scope) | Comportement intentionnel du copy trading en mode bid points. |
| **E9** | ❌ Non corrigé (hors scope) | `triggerBidVwap` vs `executableBidVwap` est un choix de conception documenté. |
| **E10** | ✅ Corrigé | Log ajouté quand le mark conservateur diffère de >5% du prix de marché. |

### 11.4 Tests

Tous les tests passent (83 tests au total) :

```
✓ packages/core/src/risk/crypto-algo-exit.test.ts  — 27 passed
✓ packages/worker/src/processors/strategy/position-branches.test.ts — 4 passed
✓ packages/worker/src/processors/strategy/position-exit-evaluator.test.ts — 15 passed
✓ packages/core/src/risk/policy.test.ts — 37 passed
```

Nouveaux tests ajoutés :
1. **`ignores stale last trade price when timestamp is too old`** : Vérifie que `lastTradePrice` de 5 minutes est ignoré
2. **`ignores last trade price when no timestamp is provided`** : Vérifie que `lastTradePrice` sans timestamp est ignoré

---

## 12. Patches v1-4 suivants (chaîne complète)

Ce brainstorm documente le **patch 1** (filtre `lastTradePrice` stale). Deux correctifs complémentaires ont suivi :

| Patch | Doc | Problème |
|-------|-----|----------|
| 1 | `2026-07-08_patch_sorties_copy_bid_points_conservative_mark.md` | `lastTradePrice` stale dans le mark conservateur |
| 2 | `2026-07-08_patch_faux_positifs_sl_executable_bid_ws_filter.md` | `triggerBidVwap` + `wsBestBid=0.01` fantôme |
| 3 | `2026-07-09_patch_pipeline_sorties_no_liquidity.md` | Boucle `no_liquidity`, retries contournés, ticks ouverture, confirmation SL |
| 4 | `2026-07-09_patch_sl_emit_blocked_no_close_bid.md` | SL décidé mais jamais émis (`emitBid=0`, hold silencieux jusqu'à REDEMPTION) |
| 5 | `2026-07-09_patch_deadlock_time_exit_outcome_known.md` | Deadlock UpDown 5m (TIME_EXIT bloqué par `winningTokenId` dérivé) |

Voir aussi : `2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md` (audit BDD et recommandations P0/P1).

# PLAN : Correction SL/TP/Pre-Close — Crypto-Algo Sim

**Date** : 2026-07-03  
**Contexte** : Audit `2026-07-03_audit-close-reasons-sim-crypto-algo.md`  
**Objectif** : Les positions sim crypto-algo ne sont jamais fermées par SL/TP/pre-close (100% REDEMPTION).  
**Root causes** : 3 problèmes identifiés → 3 fixes ciblés + 1 fix de configuration DB.

---

## Résumé des problèmes

| # | Problème | Impact | Fichiers |
|---|---|---|---|
| 1 | `suppressSlTp` désactive SL/TP dès que `endDate` passe, même si le marché n'est pas encore résolu | SL/TP inactif pendant les dernières minutes critiques du marché | `redemption-wait.ts`, `position-exit-evaluator.ts` |
| 2 | Pre-close hérite de `sim_pre_close_seconds = 40` au lieu des 120s recommandés pour le 5min | Book déjà vide quand le pre-close tente de vendre | `crypto-algo-exit.ts` (override null) + DB |
| 3 | `simulateFill` échoue sur book vide après `endDate` → pre-close en échec | 948 signaux `PRE_CLOSE_LOSS` failed, aucun n'aboutit | `executor.ts` |
| 4 | SL à 30% et TP null — inadaptés pour la volatilité des marchés 5min | SL jamais atteint (max drawdown = -15%), TP laisse filer des gains jusqu'à +89% | DB `risk_config` |

---

## Fix 1 : Ne pas supprimer le SL/TP tant que le marché n'est pas résolu

### Préambule
`isMarketAwaitingRedemptionExit()` retourne `true` dès que `endDate` passe, ce qui désactive le SL/TP trop tôt. Sur des marchés 5min, il y a souvent un delta de 5-10 minutes entre `endDate` et la résolution effective (`resolved=true` / `winningTokenId` set). Pendant ce delta, le CLOB peut encore avoir des bids utilisables.

### Changement
**Fichier** : `packages/core/src/positions/redemption-wait.ts`  
**Fonction** : `isMarketAwaitingRedemptionExit`

Ne plus retourner `true` sur `endDate <= now` seul. Exiger soit `resolved`, soit `winningTokenId`, soit `isMarketTerminal()` (CLOB réellement fermé — `closed=true && acceptingOrders=false`).

```typescript
// AVANT
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  if (market.endDate && market.endDate.getTime() <= now) return true;  // ← TROP TÔT
  return false;
}

// APRÈS
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  // Ne plus supprimer le SL/TP au simple passage de endDate.
  // Le CLOB peut encore avoir des bids après endDate tant que acceptingOrders
  // n'est pas explicitement false. Le suppressSlTp ne s'active que quand le
  // marché est vraiment terminal (closed && !acceptingOrders) ou résolu.
  return false;
}
```

### Impact
- Le SL/TP reste actif tant que le CLOB n'est pas fermé (`acceptingOrders !== false`)
- Les positions peuvent encore être fermées par SL/TP après `endDate` si le book a des bids
- Le `suppressSlTp` ne s'active que quand le marché est vraiment terminal

### Tests à mettre à jour
- `packages/core/src/positions/redemption-wait.test.ts` : les tests qui supposent `endDate <= now → true` doivent être ajustés
- `packages/worker/src/processors/strategy/position-exit-evaluator.test.ts` : vérifier que le SL/TP n'est plus supprimé sur `endDate` seul

---

## Fix 2 : Activer l'override pre-close crypto-algo (120s pour le 5min)

### Préambule
`crypto_algo_pre_close_enabled = null` et `crypto_algo_pre_close_seconds = null` → le système hérite de `sim_pre_close_seconds = 40`. La table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` recommande 120s pour le `5m`. Avec 40s, le book est déjà vide.

### Changement
**Type** : Migration DB (SQL) + vérification du code

#### 2a. Migration SQL
```sql
-- Activer l'override pre-close crypto-algo avec les valeurs par interval
UPDATE risk_config
SET crypto_algo_pre_close_enabled = true,
    crypto_algo_pre_close_seconds = 120;
```

**Note** : `crypto_algo_pre_close_seconds = 120` est la valeur fixe de l'override. Pour une logique par-interval plus fine (120s pour 5m, 180s pour 15m, etc.), le code `resolveCryptoAlgoPreCloseSeconds()` gère déjà la résolution par interval quand `overrides.preCloseSeconds` est null. Donc on pourrait aussi faire :

```sql
-- Alternative : activer sans fixer les secondes → le code résout par interval
UPDATE risk_config
SET crypto_algo_pre_close_enabled = true,
    crypto_algo_pre_close_seconds = NULL;
```

Avec `preCloseSeconds = NULL`, `resolveCryptoAlgoPreCloseSeconds()` utilisera la table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` : 120s pour 5m, 180s pour 15m, etc.

**Recommandation** : Utiliser l'alternative (`NULL`) pour laisser le code gérer par interval.

#### 2b. Vérification code
`packages/core/src/risk/crypto-algo-exit.ts:71-86` — `resolveCryptoAlgoPreCloseSeconds` :

```typescript
export function resolveCryptoAlgoPreCloseSeconds(
  risk: RiskConfig,
  interval?: string | null,
): number {
  const overrides = getCryptoAlgoPreCloseParams(risk);
  if (overrides.preCloseEnabled === false) return 0;
  if (overrides.preCloseSeconds != null) return overrides.preCloseSeconds;
  // ↓ Ce path est déjà correct — il utilise la table par interval
  const byInterval = normalizeCryptoInterval(interval);
  if (byInterval) return CRYPTO_INTERVAL_PRE_CLOSE_SECONDS[byInterval] ?? 120;
  // Fallback sur les mode defaults
  return Math.max(
    risk.simPreCloseEnabled ? risk.simPreCloseSeconds : 0,
    risk.realPreCloseEnabled ? risk.realPreCloseSeconds : 0,
  );
}
```

Le code est déjà correct — il suffit de setter `crypto_algo_pre_close_enabled = true` et laisser `crypto_algo_pre_close_seconds = NULL` pour que la résolution par interval s'applique.

---

## Fix 3 : Fallback last-trade price pour `simulateFill` quand le book est vide

### Préambule
Quand le pre-close émet un signal mais que le book est déjà vide (market expiré), `simulateFill()` retourne `no_liquidity`. Le signal échoue et la position reste ouverte jusqu'à la redemption.

Le système a déjà un `lastTradePrice` disponible (passé dans `buildCloseOrderSignal` via `emitCloseSignal`). On peut l'utiliser comme prix de fallback pour le fill en mode sim.

### Changement
**Fichier** : `packages/worker/src/processors/executor.ts`  
**Fonction** : `simulateFill`

Ajouter un fallback : si le book est null/empty mais que `signal.lastTradePrice` est disponible et positif, simuler le fill à ce prix.

```typescript
// AVANT (ligne 209-215)
if (!book) {
  return failedExecution(signal, 'no_liquidity');
}
if (fillPrice <= 0) {
  return failedExecution(signal, 'no_liquidity');
}

// APRÈS
if (!book) {
  // Fallback sim : utiliser le lastTradePrice si disponible (pre-close sur
  // marché expiré où le book est parti mais un prix de référence existe).
  if (signal.side === 'SELL' && signal.lastTradePrice && signal.lastTradePrice > 0) {
    // Simuler un fill direct au lastTradePrice (pas de slippage sur book vide)
    const fallbackPrice = signal.lastTradePrice;
    const minOrderShares = await resolveMinOrderSharesForSignal(signal);
    if (signal.quantity < minOrderShares) {
      return failedExecution(signal, 'below_min_order_size');
    }
    const platformFeeParams = await this.marketService.resolvePlatformFeeParams(
      signal.conditionId,
    );
    const fees = computeTakerFee(signal.quantity, fallbackPrice, platformFeeParams);
    if (await shouldAbortPreCloseForWinningFill(
      this.ds, signal, risk, fallbackPrice, signal.quantity, fees,
    )) {
      return failedExecution(signal, 'pre_close_hold_winning');
    }
    return {
      orderSignalId: signal.id,
      mode: signal.mode,
      status: 'filled',
      fillPrice: fallbackPrice,
      fillQuantity: signal.quantity,
      fees,
      entryBidVwap: signal.side === 'BUY' ? 0 : fallbackPrice,
      closeRetryAttempt: signal.closeRetryAttempt,
      executedAt: new Date(),
    };
  }
  return failedExecution(signal, 'no_liquidity');
}

if (fillPrice <= 0) {
  // Même fallback pour fillPrice <= 0
  if (signal.side === 'SELL' && signal.lastTradePrice && signal.lastTradePrice > 0) {
    // ... même logique ...
  }
  return failedExecution(signal, 'no_liquidity');
}
```

### Refactor suggéré
Extraire la logique de fallback dans une fonction helper pour éviter la duplication :

```typescript
private async simulateFillAtPrice(
  signal: OrderSignal,
  price: number,
  risk: RiskConfig,
): Promise<ExecutionResult | null> {
  const minOrderShares = await resolveMinOrderSharesForSignal(signal);
  if (signal.quantity < minOrderShares) {
    return failedExecution(signal, 'below_min_order_size');
  }
  const platformFeeParams = await this.marketService.resolvePlatformFeeParams(
    signal.conditionId,
  );
  const fees = computeTakerFee(signal.quantity, price, platformFeeParams);
  if (await shouldAbortPreCloseForWinningFill(
    this.ds, signal, risk, price, signal.quantity, fees,
  )) {
    return failedExecution(signal, 'pre_close_hold_winning');
  }
  return {
    orderSignalId: signal.id,
    mode: signal.mode,
    status: 'filled',
    fillPrice: price,
    fillQuantity: signal.quantity,
    fees,
    entryBidVwap: signal.side === 'BUY' ? 0 : price,
    closeRetryAttempt: signal.closeRetryAttempt,
    executedAt: new Date(),
  };
}
```

### Impact
- Les signaux pre-close (et SL/TP) qui arrivaient à l'executor avec un book vide pourront maintenant s'exécuter au lastTradePrice
- Le hold-if-winning reste respecté (pas de sell si le fill serait non-négatif)
- Uniquement pour le mode sim — le mode réel ne passe jamais par `simulateFill`

### Tests à ajouter
- `executor.test.ts` : test sim fill avec book null + lastTradePrice positif → fill réussi
- `executor.test.ts` : test sim fill avec book null + lastTradePrice positif + hold-if-winning → abort
- `executor.test.ts` : test sim fill avec book null + lastTradePrice null → no_liquidity

---

## Fix 4 : Ajuster SL/TP crypto-algo pour les marchés 5min (config DB)

### Préambule
- SL à 30% : le max drawdown observé est -15.4%. Un SL à 30% ne protège donc que les crashs extrêmes.
- TP null → hérite `sim_tp_percent = 300` (inatteignable). 7 positions ont dépassé +20% au peak, 3 ont dépassé +50%.

### Changement
**Type** : SQL uniquement (pas de code)

```sql
-- SL à 15% (protection réaliste pour 5min, couvre les drawdowns observés)
UPDATE risk_config SET crypto_algo_sl_percent = 15;

-- TP à 50% (sécurise les gains importants observés sans être trop gourmand)
UPDATE risk_config SET crypto_algo_tp_percent = 50;

-- Désactiver hold-if-winning pour les marchés courts (la position peut
-- basculer de gagnante à perdante en secondes sur du 5min)
UPDATE risk_config SET crypto_algo_pre_close_hold_if_winning = false;
```

### Impact
- SL à 15% : aurait protégé la position 15683 (-15.4% au peak)
- TP à 50% : aurait sécurisé des gains sur les positions 15671 (+89%), 15664 (+75%), 15680 (+67%), 15681/15676 (+70%), 15679 (+128%)
- `hold_if_winning = false` : le pre-close ne retient plus les positions gagnantes qui peuvent basculer

### Note sur le mode
Ces settings sont des overrides crypto-algo qui s'appliquent aux positions `ALGO_OPEN` dans les deux modes (sim + real). Les positions copy-trading continuent d'utiliser `sim_sl_percent` / `sim_tp_percent`.

---

## Ordre d'implémentation

```
1. Fix 1 (suppressSlTp) → code change
2. Fix 2 (pre-close override) → SQL migration
3. Fix 3 (simulateFill fallback) → code change
4. Fix 4 (SL/TP config) → SQL
5. Run tests
6. Build
```

---

---

## Zones d'ombre identifiées lors de la vérification

### Zone d'ombre 1 (CRITIQUE) : Fix 1 — `isMarketAwaitingRedemptionExit` est utilisée à 3 endroits, pas 1

**Le plan original ne mentionnait que `position-exit-evaluator.ts` (suppressSlTp). Mais la fonction est aussi utilisée dans :**

#### 1a. `results-consumer.ts:84-92` — retry des forced exits

```typescript
if (market && isMarketAwaitingRedemptionExit(marketLifecycleFromEntity(market))) {
  log.debug('forced exit retry skipped — market awaiting redemption');
  return;
}
```

**Impact du Fix 1** : Si on retire le check `endDate <= now`, cette branche ne skip plus les retries sur un marché expiré mais non résolu. Le worker va retry un SL/TP/pre-close échoué alors que le book est peut-être déjà parti. Ce n'est **pas un bug** — c'est le comportement souhaité (on veut retry tant qu'il y a du book) — mais ça augmente le volume de retries. Le `maxRetries` (`getModeSlCloseMaxRetries`) borne déjà ce comportement, donc le risque est contrôlé.

**Conclusion** : Pas de break, mais le comportement de retry change subtilement. À documenter.

#### 1b. `isAwaitingRedemptionPosition()` (`redemption-wait.ts:44-54`) — utilisé par le frontend + worker

```typescript
export function isAwaitingRedemptionPosition(...) {
  ...
  return isMarketAwaitingRedemptionExit(market, now);  // ← appelle la fonction modifiée
}
```

Cette fonction est utilisée par :
- **Frontend** (`frontend/src/lib/redemption-wait.ts`) : `isAwaitingRedemption()`, `canManualClosePosition()`, `partitionActivePositions()`
- **Worker** : `isActionableFailurePosition()`, `getRedemptionWaitPhase()`

**Impact du Fix 1** : Si on retire `endDate <= now`, une position sur un marché expiré mais non résolu ne sera plus classée comme "awaiting redemption" dans le frontend. Elle restera dans l'onglet "Open" au lieu de passer dans "Awaiting Redemption". L'utilisateur verra ses positions expirées en "Open" plus longtemps.

**C'est un changement de UX frontend** — pas un bug, mais ça change ce que l'utilisateur voit. À valider avec le product owner.

#### 1c. `redemption-wait.test.ts:47-61` — test existant

```typescript
it('includes open position when endDate is past', () => {
  expect(isAwaitingRedemptionPosition(
    { status: 'open' },
    { ...terminalMarket, closed: false, acceptingOrders: true,
      endDate: new Date('2020-01-01') },
    null,
    new Date('2026-01-01').getTime(),
  )).toBe(true);  // ← Ce test va FAIL après le Fix 1
});
```

**Ce test devra être changé pour `toBe(false)`** car un marché `closed=false, acceptingOrders=true` avec `endDate` passé ne sera plus "awaiting redemption".

### Zone d'ombre 2 (CRITIQUE) : Fix 1 — le TP n'est pas protégé par `isMarketSettled`

Le plan dit : "Le check `isMarketSettled()` dans `evaluatePreCloseExit` empêche le pre-close sur marché résolu."

C'est vrai pour le pre-close. **Mais le SL/TP passe par `evaluateSlTpTrailing()`, pas par `evaluatePreCloseExit()`.** Et `evaluateSlTpTrailing()` ne vérifie pas `isMarketSettled()` — elle ne fait que comparer des pourcentages.

Après Fix 1, si le marché est `resolved=true` mais `isMarketTerminal()` retourne `false` (CLOB encore ouvert), le SL/TP peut encore fire. Mais `suppressSlTp` vérifie `resolved` → donc `suppressSlTp = true` → SL/TP désactivé. **OK, pas de problème.**

Le vrai cas edge : marché `resolved=false`, `winningTokenId=null`, `closed=false`, `acceptingOrders=true`, `endDate` passé. Avant le Fix 1, `suppressSlTp = true`. Après le Fix 1, `suppressSlTp = false` → le SL/TP reste actif. C'est exactement le comportement souhaité — le marché n'est pas résolu, le CLOB est encore ouvert, on veut pouvoir sortir.

### Zone d'ombre 3 : Fix 3 — le slippage guard n'est pas appliqué sur le fallback

Le `simulateFill` normal applique un slippage guard (`evaluateSlippageGuard`) qui compare `fillPrice` vs `signal.referenceVwap`. Le fallback `lastTradePrice` ne passe pas par ce guard.

Pour les SL/TP/PRE_CLOSE_LOSS, ce n'est pas un problème car les forced exits ne sont pas dans `SLIPPAGE_GUARDED_REASONS` (qui ne contient que `COPY_OPEN`, `COPY_INCREASE`, `TP`, `PRE_CLOSE_WIN`).

**Mais `TP` est dans `SLIPPAGE_GUARDED_REASONS` !** Si un TP fire et que le fallback `lastTradePrice` s'applique, le slippage guard est bypassé. Sur un marché 5min, le lastTradePrice peut être très différent du `referenceVwap` du signal.

**Fix nécessaire** : Le fallback doit appliquer le slippage guard pour les raisons guarded (TP, PRE_CLOSE_WIN), ou au minimum logger un warning.

### Zone d'ombre 4 : Fix 3 — `lastTradePrice` peut être absent

Le plan suppose que `signal.lastTradePrice` est toujours disponible. Mais ce champ est optionnel dans `OrderSignal` (`lastTradePrice?: number`). Si le signal est émis sans `lastTradePrice` (par exemple si le WS metrics cache n'a pas de données pour cet asset), le fallback ne s'applique pas et on retombe sur `no_liquidity`.

**C'est acceptable** — c'est un best-effort fallback, pas une garantie. Mais le plan doit le mentionner.

### Zone d'ombre 5 : Fix 3 — `lastTradePrice` peut être stale

Le code a déjà `LAST_TRADE_PRICE_MAX_AGE_MS` (constants.ts) pour les warnings de staleness. Mais le fallback dans `simulateFill` n'utilise pas ce check. Si le lastTradePrice date de 10 minutes, on pourrait simuler un fill à un prix qui ne reflète plus le marché.

**Fix nécessaire** : Ajouter un check de staleness dans le fallback, ou utiliser `signal.lastTradePrice` uniquement si `bookUpdatedAt` est récent.

### Zone d'ombre 6 : Fix 4 — les overrides crypto-algo s'appliquent aussi au mode real

Le plan mentionne : "Ces settings sont des overrides crypto-algo qui s'appliquent aux positions ALGO_OPEN dans les deux modes (sim + real)."

C'est correct — `getCryptoAlgoExitParams()` est utilisée dans `algo-entry-pipeline.ts` pour **les deux modes** (`sim` et `real`). Donc un SL à 15% et un TP à 50% s'appliqueront aussi aux positions algo réelles. Sur du real, un SL à 15% peut être trop serré car les frais de gas + slippage réels peuvent amplifier les mouvements.

**Recommandation** : Valider le SL/TP en sim d'abord, puis ajuster pour le real si nécessaire. Le code supporte déjà des overrides séparés par mode (`sim_sl_percent` / `real_sl_percent`), mais les overrides crypto-algo sont globaux. Si on veut des valeurs différentes sim vs real pour les algo, il faudrait étendre le schema.

### Zone d'ombre 7 : Fix 4 — `crypto_algo_pre_close_hold_if_winning = false` affecte les deux modes

Comme ci-dessus, ce paramètre est global (pas par mode). Le désactiver affecte aussi le real. En real, hold-if-winning peut être souhaitable pour éviter de vendre à perte sur des frais de gas élevés.

---

## Risques et mitigations (révisés)

| Risque | Sévérité | Mitigation |
|---|---|---|
| Fix 1 : `isAwaitingRedemptionPosition` change la UX frontend — positions expirées restent en "Open" | Moyen | À valider. Si bloquant, créer une fonction séparée `isMarketSuppressSlTp` au lieu de modifier `isMarketAwaitingRedemptionExit`. |
| Fix 1 : Le test `redemption-wait.test.ts:47` échoue | Faible | Mettre à jour le test : `toBe(false)` au lieu de `toBe(true)`. |
| Fix 1 : Retry des forced exits augmente sur marché expiré | Faible | Borné par `maxRetries`. Comportement souhaité. |
| Fix 3 : Slippage guard bypassé pour TP | Moyen | Appliquer `evaluateSlippageGuard` dans le fallback pour les raisons guarded. |
| Fix 3 : `lastTradePrice` peut être absent | Faible | Best-effort fallback. Retombe sur `no_liquidity` si absent. |
| Fix 3 : `lastTradePrice` peut être stale | Moyen | Ajouter un check `LAST_TRADE_PRICE_MAX_AGE_MS` dans le fallback. |
| Fix 4 : SL 15% et hold-if-winning=false s'appliquent aussi au real | Moyen | Valider en sim d'abord. Le code supporte des overrides par mode mais pas pour les crypto-algo overrides. |
| Fix 4 : SL 15% peut causer des faux positifs | Faible | Max drawdown observé = -15.4% (1 position sur 22). Les autres sont > -6%. Risque faible. |

---

## Fix 1 alternatif (si la zone d'ombre 1 est bloquante)

Si modifier `isMarketAwaitingRedemptionExit` a trop d'impacts collatéraux (frontend, retry, tests), on peut créer une fonction séparée pour le `suppressSlTp` uniquement :

```typescript
// packages/core/src/positions/redemption-wait.ts

/**
 * Spécifique au suppressSlTp : ne supprime le SL/TP que quand le marché
 * est terminal (CLOB fermé) ou résolu. Contrairement à isMarketAwaitingRedemptionExit,
 * ne supprime pas au simple passage de endDate.
 */
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;
  return false;
}
```

Puis dans `position-exit-evaluator.ts` :
```typescript
const suppressSlTp = shouldSuppressSlTp(lifecycle);
```

**Avantages** :
- Pas de changement sur `isMarketAwaitingRedemptionExit` → pas d'impact frontend, pas d'impact retry, pas de test à casser
- Changement minimal et ciblé

**Inconvénient** :
- Ajoute une fonction de plus — mais elle a une sémantique différente (suppressSlTp ≠ awaitingRedemption)

**Recommandation** : Utiliser cette approche alternative. Elle isole le changement au seul endroit qui pose problème.

---

## Fix 3 révisé — avec slippage guard et staleness check

```typescript
// Dans simulateFill(), après `if (!book)` et `if (fillPrice <= 0)`:

if (signal.side === 'SELL' && signal.lastTradePrice && signal.lastTradePrice > 0) {
  // Check de staleness : ne pas utiliser un lastTradePrice trop ancien
  // (les metrics cache ont un timestamp — on peut le récupérer via connectionManager)
  // Si pas de timestamp disponible, on accepte (best-effort).

  const fallbackPrice = signal.lastTradePrice;

  // Slippage guard pour les raisons guarded (TP, PRE_CLOSE_WIN)
  if (signal.referenceVwap != null && signal.referenceVwap > 0) {
    const guard = evaluateSlippageGuard(signal, fallbackPrice, risk.maxSlippagePercent);
    if (guard.blocked) {
      return failedExecution(signal, 'slippage_exceeded');
    }
  }

  const minOrderShares = await resolveMinOrderSharesForSignal(signal);
  if (signal.quantity < minOrderShares) {
    return failedExecution(signal, 'below_min_order_size');
  }
  const platformFeeParams = await this.marketService.resolvePlatformFeeParams(signal.conditionId);
  const fees = computeTakerFee(signal.quantity, fallbackPrice, platformFeeParams);
  if (await shouldAbortPreCloseForWinningFill(this.ds, signal, risk, fallbackPrice, signal.quantity, fees)) {
    return failedExecution(signal, 'pre_close_hold_winning');
  }
  return {
    orderSignalId: signal.id,
    mode: signal.mode,
    status: 'filled',
    fillPrice: fallbackPrice,
    fillQuantity: signal.quantity,
    fees,
    entryBidVwap: signal.side === 'BUY' ? 0 : fallbackPrice,
    closeRetryAttempt: signal.closeRetryAttempt,
    executedAt: new Date(),
  };
}
```

---

## Ordre d'implémentation (révisé)

```
1. Fix 1 alternatif (shouldSuppressSlTp) → nouvelle fonction + 1 import dans position-exit-evaluator.ts
2. Fix 2 (pre-close override) → SQL
3. Fix 3 révisé (simulateFill fallback + slippage guard + staleness) → code change
4. Fix 4 (SL/TP config) → SQL
5. Tests : redemption-wait.test.ts (nouveau test pour shouldSuppressSlTp), position-exit-evaluator.test.ts, executor.test.ts
6. Build : npm run build (core, worker, crypto-algo)
```

---

## Vérification post-fix

1. Lancer le worker en sim et laisser tourner plusieurs cycles de marchés 5min
2. Auditer la DB :
   ```sql
   SELECT close_reason, COUNT(*) FROM copied_positions
   WHERE mode = 'sim' AND status = 'closed'
   GROUP BY close_reason;
   ```
3. Vérifier qu'on obtient un mix de SL, TP, PRE_CLOSE_LOSS et REDEMPTION (au lieu de 100% REDEMPTION)
4. Vérifier que les sells `PRE_CLOSE_LOSS` failed diminuent drastiquement
5. Vérifier que le frontend n'est pas impacté (les positions expirées non résolues restent en "Open")
6. Vérifier les logs du worker pour les retries forced exit (augmentation attendue mais bornée)
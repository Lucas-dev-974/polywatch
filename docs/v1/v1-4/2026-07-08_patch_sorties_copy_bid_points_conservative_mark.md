# Patch — SL/TP copy trading : filtre de fraîcheur sur `lastTradePrice`

**Date** : 2026-07-08
**Version cible** : v1-4
**Statut** : ✅ Implémenté
**Tags** : `bug`, `SL`, `copy-trading`, `bid-points`, `conservative-mark`, `exit-decision`

---

## 1. Résumé

Les positions **copy trading simulation** (mode bid points) déclenchaient leur SL à des pertes de **-0.5% à -4%** au lieu des **-32% à -77%** configurés.

**Cause racine** : `lastTradePrice` (prix du dernier trade exécuté) était inclus sans filtre de fraîcheur dans le calcul du mark conservateur. Un prix obsolète de plusieurs minutes/heures faisait chuter artificiellement le PnL, déclenchant le SL prématurément.

**Correction** : Ajout d'un filtre de fraîcheur (≤ 60s) sur `lastTradePrice` dans `resolveExitDecisionMarkPrice()`, avec fallback sur le comportement historique quand le timestamp est absent.

---

## 2. Fichiers modifiés

| Fichier | Modification | Erreurs corrigées |
|---------|-------------|-------------------|
| `packages/core/src/risk/crypto-algo-exit.ts` | Ajout du paramètre `lastTradeTimestamp` à `resolveExitDecisionMarkPrice()` + filtre de fraîcheur (≤ 60s, via `LAST_CLOSEABLE_BID_MAX_AGE_MS`) sur `lastTradePrice`, avec fallback historique quand le timestamp est absent | **E3, E4, E7** |
| `packages/worker/src/processors/strategy/position-branches.ts` | Passage de `lastTradeTimestamp` à `buildPositionExitContext()` et `resolveExitDecisionMarkPrice()` | **E3, E4** |
| `packages/worker/src/processors/strategy/position-branches.ts` | Ajout d'un log pino `warnConservativeMarkDrift` (throttled 60s/position) quand le mark conservateur diffère de >5% du prix de marché | **E10** |
| `packages/worker/src/processors/strategy/position-branches.ts` | Suppression du paramètre mort `unrealizedPnl` de `buildPositionExitContext()` | refactor |
| `packages/core/src/risk/crypto-algo-exit.test.ts` | 3 nouveaux tests : stale timestamp, absence de timestamp (backward compat), timestamp futur (clock skew) | **E3, E7** |
| `packages/worker/src/processors/strategy/position-branches.test.ts` | Ajout de `lastTradeTimestamp` au test existant | **E3** |

---

## 3. Modifications détaillées

### 3.1 `resolveExitDecisionMarkPrice()` — filtre de fraîcheur

**Fichier** : `packages/core/src/risk/crypto-algo-exit.ts`

**Avant** :
```typescript
if (lastTradePrice != null && lastTradePrice > 0) {
  candidates.push(lastTradePrice);
}
```

**Après** :
```typescript
if (lastTradePrice != null && lastTradePrice > 0) {
  const stale =
    lastTradeTimestamp != null &&
    (lastTradeTimestamp.getTime() > now ||
      now - lastTradeTimestamp.getTime() > LAST_CLOSEABLE_BID_MAX_AGE_MS);
  if (!stale) candidates.push(lastTradePrice);
}
```

**Nouveau paramètre** : `lastTradeTimestamp?: Date | null` ajouté à la signature.

**Constante utilisée** : `LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000` (60s, déjà exportée par core, alignée avec `isLastCloseableBidFresh` et `LAST_TRADE_PRICE_MAX_AGE_MS` du worker).

**Comportement** :
- Timestamp absent (`null`/`undefined`) → prix inclus (compat ascendante, préserve le cas illiquide)
- Timestamp frais (≤ 60s) → prix inclus
- Timestamp stale (> 60s) → prix exclu
- Timestamp dans le futur (désync d'horloge) → prix exclu (garde anti-corruption)

### 3.2 `buildPositionExitContext()` — log de diagnostic pino

**Fichier** : `packages/worker/src/processors/strategy/position-branches.ts`

Logger pino structuré + throttlé (1 warn/min/position) quand le mark conservateur diffère de plus de 5% du prix de marché :

```typescript
const log = pino({ name: 'position-branches' });
const CONSERVATIVE_MARK_DRIFT_WARN_THRESHOLD = 0.05;
const CONSERVATIVE_MARK_DRIFT_THROTTLE_MS = 60_000;
const lastConservativeMarkWarnAt = new Map<number, number>();

// Dans buildPositionExitContext() :
if (
  useConservativeMark &&
  decisionBidVwap > 0 &&
  exitMark > 0 &&
  Math.abs(exitMark - decisionBidVwap) / decisionBidVwap >
    CONSERVATIVE_MARK_DRIFT_WARN_THRESHOLD
) {
  const lastWarnAt = lastConservativeMarkWarnAt.get(pos.id) ?? 0;
  if (now - lastWarnAt >= CONSERVATIVE_MARK_DRIFT_THROTTLE_MS) {
    lastConservativeMarkWarnAt.set(pos.id, now);
    log.warn(
      {
        positionId: pos.id,
        assetId: pos.assetId,
        decisionBid: decisionBidVwap,
        exitMark,
        diffPercent: ((exitMark - decisionBidVwap) / decisionBidVwap) * 100,
        trigger,
        closure,
        liquidityStatus: bookPrices.liquidityStatus,
      },
      'conservative exit mark drifts significantly from live book bid — possible stale lastTradePrice',
    );
  }
}
```

**Pourquoi pino plutôt que `console.warn` ?** Le reste du worker utilise pino avec des logs structurés JSON. `console.warn` n'est pas capturé par la pipeline pino et serait noyé dans stdout.

**Pourquoi throttle ?** Les ticks tournent toutes les 100ms (`STRATEGY_EVAL_INTERVAL_MS`). Sans throttle, 100 positions en mode conservateur généreraient ~1000 warns/sec.

### 3.3 Passage de `lastTradeTimestamp` dans le pipeline

Ajout du paramètre `lastTradeTimestamp` dans :
- `buildPositionExitContext()` → `resolveExitDecisionMarkPrice()`
- Les 3 appels à `buildPositionExitContext()` dans `evaluateIlliquidPosition()` et `evaluateLiquidPosition()`

---

## 4. Décisions et justifications

### Décision 1 : Filtrer `lastTradePrice` par fraîcheur (Solution C uniquement)

**Pourquoi pas la Solution A (séparer le PnL de décision) ?**

Le test `uses last trade price as conservative mark when stale bid masks a stop-loss breach` montre un cas où `executableBidVwap = 0` (marché illiquide sans carnet). Dans ce cas, le PnL de décision DOIT être calculé sur le mark conservateur car il n'y a pas de prix de marché réel disponible. Séparer les deux PnL créerait un bug inverse : les positions sur marchés illiquides ne déclencheraient plus jamais leur SL.

**Pourquoi 60s (et non 120s) ?**

Le seuil utilise `LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000` (déjà exportée par core), alignée avec :
- `isLastCloseableBidFresh()` qui valide la fraîcheur du `lastCloseableBidVwap` avec le même seuil
- `LAST_TRADE_PRICE_MAX_AGE_MS = 60_000` du worker (`constants.ts`), utilisée par `warnStaleData` pour alerter d'un `lastTradePrice` stale

Utiliser 120s aurait créé une incohérence : `warnStaleData` aurait émis un warning "stale" à 60s tout en continuant d'inclure le prix jusqu'à 120s.

**Pourquoi fallback sur le comportement historique quand le timestamp est absent ?**

Si on excluat `lastTradePrice` quand `lastTradeTimestamp` n'est pas transmis, on cassait le cas illiquide où `lastTradePrice` est le seul prix disponible (bookBid=0, wsBestBid=0). Le fallback préserve la compat ascendante : pas de timestamp → on ne peut pas déterminer la staleness → on inclut le prix (comportement d'origine).

**Pourquoi ne pas supprimer `lastTradePrice` complètement ?**

Le test existant montre un cas réel où `lastTradePrice` est nécessaire : quand le carnet d'ordres est illiquide et que le dernier trade est le seul indicateur d'une chute réelle du marché. Le filtre de fraîcheur préserve ce cas d'usage tout en empêchant les prix obsolètes de fausser la décision.

### Décision 2 : Ajouter un log de diagnostic

Sans log, le bug est indétectable sans audit BDD manuel. Le seuil de 5% est suffisamment bas pour capturer les anomalies sans être trop bavard.

### Décision 3 : Ne PAS modifier `shouldUseConservativeExitMark()`

Avec le filtre de fraîcheur sur `lastTradePrice`, le mode conservateur n'est plus dangereux. Modifier le seuil de `trigger < 0` à `trigger < -1` introduirait un risque de non-déclenchement de SL sur des pertes réelles de -0.5% à -1%.

### Décision 4 : Ne PAS ajouter de fallback `sl_percent` pour le copy trading

Le copy trading utilise intentionnellement les bid points (`slBidPoints`/`tpBidPoints`), pas les pourcentages. `resolveCopyEntryExitParams()` retourne `slPercent: undefined` par conception.

---

## 5. Matrice de correction finale

| Erreur | Statut | Justification |
|--------|--------|---------------|
| **E1** — PnL recalculé sur le mark conservateur | ✅ Corrigé indirectement | Le filtre de fraîcheur empêche `lastTradePrice` stale de fausser le PnL. Le PnL reste calculé sur le mark conservateur, mais ce mark n'inclut plus de prix obsolètes. |
| **E2** — `shouldUseConservativeExitMark()` trop sensible | ❌ Non corrigé (intentionnel) | Le seuil `trigger < 0 \|\| closure < 0` est nécessaire pour les marchés illiquides. Avec E3 corrigé, il n'y a plus de risque de faux positif. |
| **E3** — `lastTradePrice` sans filtre de fraîcheur | ✅ Corrigé | `lastTradePrice` n'est inclus dans les candidats que si son timestamp est frais (≤ 60s) ou absent (fallback compat ascendante). Garde anti-timestamp-futur. |
| **E4** — `effectiveTrigger <= 0` trop large | ✅ Corrigé indirectement | Avec E3 corrigé, `lastTradePrice` stale n'est plus inclus, donc `effectiveTrigger <= 0` ne peut plus être déclenché par un prix obsolète. |
| **E5** — Double calcul du PnL | ❌ Non corrigé (intentionnel) | Le double calcul est nécessaire : le premier sur le prix de marché réel (affichage), le second sur le mark conservateur (décision de sortie). Avec E3 corrigé, le second calcul n'est plus faussé. |
| **E6** — `exitSnap` sert à la fois pour la décision et le prix de sortie | ❌ Non corrigé (intentionnel) | C'est un choix de conception valide tant que le mark conservateur est fiable (ce qui est le cas avec E3 corrigé). |
| **E7** — `lastTradePrice` peut être stale | ✅ Corrigé | Le filtre de fraîcheur utilise `lastTradeTimestamp` pour exclure les prix obsolètes. |
| **E8** — Pas de fallback `sl_percent` copy trading | ❌ Non corrigé (hors scope) | Comportement intentionnel du copy trading en mode bid points. |
| **E9** — `triggerBidVwap` vs `executableBidVwap` | ❌ Non corrigé (hors scope) | Choix de conception documenté. |
| **E10** — Pas de logging | ✅ Corrigé | Log pino structuré + throttlé (1/min/position) ajouté quand le mark conservateur diffère de >5% du prix de marché. |

---

## 6. Tests

Tous les tests passent (84 tests au total) :

```
✓ packages/core/src/risk/crypto-algo-exit.test.ts  — 28 passed
✓ packages/worker/src/processors/strategy/position-branches.test.ts — 4 passed
✓ packages/worker/src/processors/strategy/position-exit-evaluator.test.ts — 15 passed
✓ packages/core/src/risk/policy.test.ts — 37 passed
```

**Nouveaux tests ajoutés** :

1. **`ignores stale last trade price when timestamp is too old`** : Vérifie que `lastTradePrice` de 5 minutes est ignoré (retourne `lastCloseableBidVwap` au lieu du prix stale)
2. **`includes last trade price when no timestamp is provided (backward compat)`** : Vérifie que `lastTradePrice` sans timestamp est inclus (compat ascendante, préserve le cas illiquide)
3. **`ignores last trade price with a future timestamp (clock skew guard)`** : Vérifie qu'un timestamp dans le futur (désync d'horloge) est rejeté

---

## 7. Risques résiduels

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Un `lastTradePrice` frais mais anormalement bas (flash crash) déclenche un SL | Faible | Moyen | Le filtre de fraîcheur ne protège pas contre les flash crashes. C'est un comportement attendu : si le dernier trade est à 0.01 et qu'il date de < 1 min, le marché a réellement crashé. |
| Le log pino `warnConservativeMarkDrift` est trop bavard en production | Faible | Faible | Throttle à 1 warn/min/position. Le seuil de 5% évite le bruit des fluctuations normales. |
| Un marché sans trade pendant > 1 min ne bénéficie plus du `lastTradePrice` comme source conservatrice | Moyenne | Faible | Le `bookBid` et `wsBestBid` sont toujours disponibles. Le `lastCloseableBidVwap` sert de fallback. Le `lastTradePrice` n'est qu'une source supplémentaire. |
| Un appelant ne transmettant pas `lastTradeTimestamp` contourne le filtre de fraîcheur | Moyenne | Faible | Comportement intentionnel (compat ascendante). `warnStaleData` ne se déclenche pas non plus sans timestamp (`position-exit-evaluator.ts:279`), il n'y a donc pas de safety net automatique pour ce cas. Mitigation : s'assurer que tous les call sites propagent `lastTradeTimestamp` (déjà fait pour `evaluateIlliquidPosition` et `evaluateLiquidPosition`). |

---

## 8. Références

- **Brainstorm complet** : `docs/v1/v1-4/2026-07-08_brainstorm_patch_sorties_copy_bid_points_conservative_mark.md`
- **Code modifié** :
  - `packages/core/src/risk/crypto-algo-exit.ts` (filtre de fraîcheur, lignes 558-575)
  - `packages/worker/src/processors/strategy/position-branches.ts` (logger pino, throttle, suppression paramètre mort)
- **Tests** :
  - `packages/core/src/risk/crypto-algo-exit.test.ts` (3 nouveaux tests, lignes 287-313)
  - `packages/worker/src/processors/strategy/position-branches.test.ts` (mise à jour test existant)

---

## 10. Chaîne de correctifs v1-4

| Patch | Date | Problème | Statut |
|-------|------|----------|--------|
| `patch_sorties_copy_bid_points_conservative_mark` | 2026-07-08 | `lastTradePrice` stale | ✅ (ce document) |
| `patch_faux_positifs_sl_executable_bid_ws_filter` | 2026-07-08 | `triggerBidVwap` + `wsBestBid=0.01` | ✅ |
| `patch_pipeline_sorties_no_liquidity` | 2026-07-09 | Boucle no_liquidity, retries, ticks, confirmation SL | ✅ |
| `patch_sl_emit_blocked_no_close_bid` | 2026-07-09 | SL décidé mais jamais émis (`emitBid=0`) | ✅ |
| `patch_deadlock_time_exit_outcome_known` | 2026-07-09 | Deadlock UpDown 5m (TIME_EXIT + suppressSlTp) | ✅ |

---

## 9. Bug fix post-audit (2026-07-08)

Un audit de l'implémentation (via la skill `verify-implementation`) a détecté **3 bugs réels** et **2 bugs fantômes** introduits par la première version du patch. Voici les corrections appliquées.

### 9.1 Bugs réels corrigés

#### BR1 — Commentaire contradictoire (`position-branches.ts:107-111`)

**Problème** : Le commentaire affirme "we must NOT recalculate it on the conservative mark" et "exitSnap is only used for the actual exit price, not for the SL/TP decision". Mais le code fait l'inverse : `exitSnap` est calculé sur `exitMark` (mark conservateur) puis passé à `evaluateCloseLogic()` pour la décision SL/TP.

**Pourquoi c'est un bug** : Le commentaire décrit une solution (Solution A) qui n'a **pas** été appliquée. La décision documentée (Décision 1) est de **ne pas séparer** les PnL. Un développeur relisant ce code pourrait "corriger" le code pour qu'il corresponde au commentaire, réintroduisant le bug inverse.

**Correction** : Remplacement du commentaire par une description correcte du comportement : "The decision PnL is computed on the conservative mark. This is intentional: on illiquid markets where the book bid is 0, the conservative mark is the only available price."

#### BR2 — Seuil de fraîcheur incohérent (120s vs 60s)

**Problème** : Le patch avait introduit `DEFAULT_LAST_TRADE_MAX_AGE_MS = 120_000` (120s) dans `crypto-algo-exit.ts`, mais le worker utilise déjà `LAST_TRADE_PRICE_MAX_AGE_MS = 60_000` (60s) dans `warnStaleData` (`position-exit-evaluator.ts:281`). Entre 60s et 120s, le système émettait un warning "stale" tout en continuant d'inclure le prix dans le mark conservateur — contradiction.

**Pourquoi c'est un bug** : Le `warnStaleData` sert de safety net pour alerter d'un `lastTradePrice` stale. Si le filtre du patch utilise un seuil plus large (120s), le warning se déclenche à 60s mais le prix est toujours utilisé jusqu'à 120s, créant une fenêtre de 60s où le système dit "ce prix est stale" tout en l'utilisant pour la décision SL/TP.

**Correction** :
- Suppression de `DEFAULT_LAST_TRADE_MAX_AGE_MS` (120s)
- Utilisation de `LAST_CLOSEABLE_BID_MAX_AGE_MS = 60_000` (déjà exportée par core, alignée avec `isLastCloseableBidFresh` et `LAST_TRADE_PRICE_MAX_AGE_MS` du worker)
- Cohérence : `warnStaleData` et le filtre utilisent désormais le même seuil (60s)

#### BR3 — Filtre trop strict : excluait `lastTradePrice` quand le timestamp était absent

**Problème** : Le filtre original exigeait `lastTradeTimestamp != null` pour inclure `lastTradePrice`. Or, `lastTradeTimestamp` est un paramètre optionnel ajouté en fin de signature. Tout appelant ne le passant pas voyait `lastTradePrice` **silencieusement exclu** du mark conservateur.

**Pourquoi c'est un bug fantôme critique** : Sur un marché illiquide où `bookBid = 0`, `wsBestBid = 0`, et `lastTradePrice` est le seul prix disponible mais sans timestamp transmis, le mark tombait sur `getPositionMarkPrice` (fallback entry-price), masquant la perte réelle — exactement le bug que `resolveExitDecisionMarkPrice` était censé corriger à l'origine.

**Correction** : Fallback sur le comportement historique quand le timestamp est absent :
- Timestamp absent (`null`/`undefined`) → prix inclus (compat ascendante)
- Timestamp frais (≤ 60s) → prix inclus
- Timestamp stale (> 60s) → prix exclu
- Timestamp dans le futur (désync d'horloge) → prix exclu (garde anti-corruption)

### 9.2 Bugs fantômes corrigés

#### BF1 — `console.warn` non structuré, invisible en production

**Problème** : Le patch utilisait `console.warn` brut, alors que le reste du worker utilise **pino** avec des logs structurés JSON. Le `console.warn` n'est pas capturé par la pipeline pino (pas de level, pas de correlation ID) et serait noyé dans stdout.

**Scénario déclencheur** : 100 positions en mode conservateur avec un mark différant de >5% → ~1000 warns/sec (ticks toutes les 100ms).

**Correction** :
- Remplacement par `log.warn({ positionId, assetId, ... }, 'msg')` avec logger pino (`pino({ name: 'position-branches' })`)
- Ajout d'un throttle (1 warn/min/position via `Map<number, number>`) pour éviter le log spam
- Extraction des constantes (`CONSERVATIVE_MARK_DRIFT_WARN_THRESHOLD`, `CONSERVATIVE_MARK_DRIFT_THROTTLE_MS`)

#### BF2 — Garde anti-timestamp-futur

**Problème** : Si `lastTradeTimestamp` est dans le futur (désync d'horloge, bug WS, timestamp mal parsé), `now - lastTradeTimestamp.getTime()` est négatif, donc `<= seuil` est toujours vrai. Le prix était inclus indéfiniment, même s'était stale depuis longtemps côté "vrai" temps.

**Correction** : Ajout d'une garde `lastTradeTimestamp.getTime() > now` dans la détection de staleness. Un timestamp futur est traité comme unreliable → prix exclu.

### 9.3 Refactor appliqué

#### RF1 — Suppression du paramètre mort `unrealizedPnl`

**Problème** : `buildPositionExitContext()` acceptait un paramètre `unrealizedPnl: number` qui était déstructuré mais **jamais utilisé** dans le corps de la fonction. Le `exitSnap.unrealizedPnl` (recalculé) était utilisé à la place.

**Pourquoi c'est un refactor nécessaire** : Un paramètre mort induit en erreur — un appelant peut croire qu'il influence le résultat.

**Correction** : Suppression du paramètre `unrealizedPnl` de l'interface de `buildPositionExitContext()` et des 3 call sites (`evaluateIlliquidPosition` ×2, `evaluateLiquidPosition` ×1).

### 9.4 Vérification post-correction

| Vérification | Statut |
|--------------|--------|
| `tsc --noEmit` packages/core | ✅ 0 erreur |
| `tsc --noEmit` packages/worker | ✅ 0 erreur |
| `ReadLints` sur les fichiers modifiés | ✅ 0 diagnostic |
| Tests `crypto-algo-exit.test.ts` | ✅ 28 passed (+1 nouveau) |
| Tests `position-branches.test.ts` | ✅ 4 passed |
| Tests `position-exit-evaluator.test.ts` | ✅ 15 passed |
| Tests `policy.test.ts` | ✅ 37 passed |
| **Total** | **✅ 84 passed** |

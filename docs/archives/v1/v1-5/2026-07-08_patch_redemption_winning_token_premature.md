# Patch — `winningTokenId` ≠ settled (sous-marchés Polymarket)

**Date** : 2026-07-08
**Dernière mise à jour** : 2026-07-09
**Version cible** : v1-5
**Statut** : ✅ **P1–P5 implémentés**
**Auteur** : Audit BDD + analyse code
**Tags** : `patch`, `bug`, `redemption`, `winningTokenId`, `SL`, `dead-zone`, `sous-token`, `spread`, `polymarket`, `implémenté`
**Brainstorm associé** : `2026-07-08_brainstorm_redemption_winning_token_premature.md`
**Plan P4/P5** : `2026-07-09_plan_p4_p5_outcome_badge_monitoring.md`

---

## 1. Résumé

`winningTokenId` est **déduit du prix CLOB** (seuil `>= 0.99` dans `market-metadata.ts`) et persisté en BDD **sans exiger** `resolved === true`. Pour les **sous-marchés Polymarket** (spread, total, exact score…), le résultat du sous-token peut être connu (token à 1.00) alors que le contrat n'est pas encore officiellement résolu — parfois **des jours avant**.

Le système interprétait ce `winningTokenId` comme un signal de "marché terminé" dans trois fonctions de `redemption-wait.ts`, créant une **zone morte** : SL/TP désactivé, position non redeemable on-chain, frontend affichant "Rédemption automatique en cours" à tort.

Ce patch propose **5 niveaux** de corrections, du strict bug-fix (P1, obligatoire) aux améliorations de robustesse/UX (P2-P5, recommandées). Chaque niveau est indépendant et peut être appliqué séparément.

| Niveau | Priorité | Coût | Bénéfice |
|--------|----------|------|-----------|
| **P1** | Obligatoire | 3 fonctions + tests | Corrige le bug + la zone morte |
| **P2** | Recommandé | 1 commentaire | Prévention de régression (invariant) |
| **P3** | Recommandé | 1 commentaire | Clarifie `isMarketOutcomeKnown()` |
| **P4** | Recommandé | Badge frontend | ✅ Implémenté — UX badges jaune/bleu |
| **P5** | Recommandé | ~20 lignes + log warn | ✅ Implémenté — monitoring > 24h |

**État** : P1–P5 appliqués (2026-07-08 / 2026-07-09). Reste : vérification prod positions #17294–#17379.

---

## 2. P1 — Correctif du bug (obligatoire)

### 2.1 `shouldSuppressSlTp()` — lignes 72-81

**Problème** : Retourne `true` dès que `winningTokenId` est présent, même si le CLOB est encore actif et que l'`endDate` est dans plusieurs jours.

**Correctif** : Ne supprimer SL/TP que quand le marché est officiellement `resolved`. Un marché terminal (`closed && !acceptingOrders`) sans `resolved` peut encore avoir des bids CLOB exploitables — la branche illiquide gère le cas où le book est à 0.

```typescript
// AVANT
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  if (market.winningTokenId) {
    return true;
  }
  return false;
}

// APRÈS
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  // winningTokenId seul ne suffit pas — pour les sous-marchés (spread, total),
  // le résultat du sous-token peut être connu avant la résolution officielle
  // du contrat. Tant que resolved = false, le CLOB peut encore offrir une sortie.
  return false;
}
```

**Justification** :

- `resolved` = le contrat intelligent a été résolu → le payoff est fixe, plus de sens à trader
- `winningTokenId` seul = le résultat du sous-token est connu mais le contrat n'est pas encore résolu → le CLOB peut encore avoir de la liquidité
- Un marché terminal (`closed && !acceptingOrders`) sans `resolved` garde SL/TP actif → la branche illiquide utilise le mark conservateur, ce qui est correct

### 2.2 `isMarketAwaitingRedemptionExit()` — lignes 53-63

**Problème** : Retourne `true` dès que `winningTokenId` est présent. Impacte :

- `isAwaitingRedemptionPosition()` → affichage frontend "En attente de rédemption" / "Rédemption automatique en cours"
- `ResultsConsumer.maybeRetryForcedExitClose()` → saute les retries de forced exit

**Correctif** : Supprimer la condition `winningTokenId` seule. Les cas où le CLOB est vraiment mort sont déjà couverts par `isMarketTerminal()` et `endDate <= now`.

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
  if (market.endDate && market.endDate.getTime() <= now) return true;
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
  // winningTokenId seul ne suffit pas — un sous-marché (spread, total) peut
  // avoir son résultat connu sans que le contrat soit settled. Attendre
  // isMarketTerminal / resolved / endDate <= now avant de considérer la
  // position en attente de rédemption.
  if (market.endDate && market.endDate.getTime() <= now) return true;
  return false;
}
```

**Justification** :

- `isMarketTerminal()` = `closed && !acceptingOrders` → le CLOB n'accepte plus d'ordres → rédemption
- `resolved` = résolution officielle → rédemption
- `endDate <= now` = le marché a expiré → rédemption (même si `acceptingOrders` est encore true, Polymarket le ferme bientôt)
- `winningTokenId` seul = le résultat du sous-token est connu mais le CLOB peut encore être actif → **ne pas** considérer comme "en attente de rédemption"

### 2.3 `getRedemptionWaitPhase()` — ligne 124

**Problème** : `market?.winningTokenId || market?.resolved` traite `winningTokenId` seul comme `'awaiting_redemption'`, d'où le message frontend "Rédemption automatique en cours. Aucune action requise." affiché pour un sous-marché dont seul le résultat est connu.

**Correctif** : Aligner sur la même logique — `winningTokenId` seul ne suffit pas.

```typescript
// AVANT
if (market?.winningTokenId || market?.resolved) return 'awaiting_redemption';

// APRÈS
if (market?.resolved) return 'awaiting_redemption';
```

**Justification** : Quand `winningTokenId` est présent mais que le marché n'est ni `resolved` ni terminal, la phase correcte est `'awaiting_resolution'` (retourné par le fallback ligne 125). Le cas `winningTokenId + isMarketSettled` est déjà couvert par `pos.status === 'pending_resolution'` ligne 123 (le `MarketResolutionWatcher` passe en `pending_resolution` quand `isMarketRedeemable()` = true).

---

## 3. P2 — Invariant de cycle de vie (recommandé)

Pour éviter qu'un futur contributeur réintroduise la branche `winningTokenId` dans une décision de cycle de vie, ajouter un **commentaire d'invariant** en haut de `packages/core/src/positions/redemption-wait.ts`, juste après les imports :

```typescript
// INVARIANT — winningTokenId ≠ settled
//
// winningTokenId est DÉDUIT du prix CLOB (seuil >= 0.99 dans
// market-metadata.ts → determineWinnerFromPrices) et persisté en BDD
// (market.service.ts → persistMarket) SANS exiger resolved === true.
//
// Pour les sous-marchés Polymarket (spread, total, exact score…), le résultat
// du sous-token peut être connu (token à 1.00) alors que le contrat n'est pas
// encore officiellement résolu — parfois des jours avant (ex : tennis multi-
// jours, spread réalisé en plein match).
//
// RÈGLE : aucune décision de cycle de vie (suppression SL/TP, passage en
// attente de rédemption, affichage "rédemption en cours") ne doit reposer sur
// winningTokenId seul. Toujours exiger resolved || isMarketSettled().
//
// Exception : isMarketOutcomeKnown() (lifecycle.ts) inclut winningTokenId
// seul — c'est VOLONTAIRE et correct pour TIME_EXIT (carnet à 1.00/0.00,
// sortie CLOB sans sens économique). NE PAS réutiliser cette fonction pour
// supprimer SL/TP ou pour le cycle de vie de rédemption.
```

**Coût** : 1 bloc de commentaire. **Bénéfice** : prévention de régression documentée à l'endroit exact où le bug s'est produit.

---

## 4. P3 — Clarifier `isMarketOutcomeKnown()` (recommandé)

Ajouter un commentaire explicatif dans `packages/core/src/market/lifecycle.ts` au-dessus de `isMarketOutcomeKnown()` pour dissuader toute réutilisation incorrecte :

```typescript
/**
 * Outcome known — résultat du sous-token connu (token à 1.00 sur le CLOB).
 *
 * UTILISATION LÉGITIME : désactiver TIME_EXIT. Une fois le résultat du
 * sous-marché connu, le carnet est à 1.00/0.00 et une sortie CLOB n'a plus
 * de sens économique.
 *
 * NE PAS UTILISER pour :
 * - supprimer SL/TP → utiliser shouldSuppressSlTp() (exige resolved)
 * - décider du passage en pending_resolution → utiliser isMarketRedeemable()
 *   (exige isMarketSettled() && winningTokenId)
 * - afficher "rédemption en cours" → utiliser getRedemptionWaitPhase()
 *   (exige resolved)
 *
 * winningTokenId est déduit du prix (seuil >= 0.99) et peut être connu bien
 * avant la résolution officielle du contrat (sous-marchés sportifs).
 */
export function isMarketOutcomeKnown(market: MarketLifecycleState): boolean {
  return market.resolved || !!market.winningTokenId;
}
```

**Coût** : 1 commentaire. **Bénéfice** : clarifie la subtilité (winningTokenId = résultat du sous-token, pas résolution du contrat) à l'endroit où la confusion est la plus probable.

---

## 5. P4 — Badge frontend "résultat connu" ✅ Implémenté (2026-07-09)

### 5.1 Problème UX

Après P1, le frontend n'affichait plus "Rédemption automatique en cours" pour un sous-marché à `winningTokenId` set et `resolved = false` — la position apparaissait en "Ouvertes". C'est correct, mais l'utilisateur n'avait **aucune indication** que le résultat du sous-token est déjà fixé.

### 5.2 Implémentation réalisée

| Fichier | Changement |
|---------|------------|
| `packages/frontend/src/lib/redemption-wait.ts` | `subMarketOutcomeKnownBadge()`, `redemptionProgressBadge()` |
| `packages/frontend/src/lib/position-tooltips.ts` | Tooltips `subMarketOutcomeKnown`, `redemptionInProgress` |
| `packages/frontend/src/components/position/PositionOpenRowMeta.tsx` | Affichage badges dans la meta ligne |
| `packages/frontend/src/lib/position.ts` | Exports des helpers |
| `packages/frontend/src/lib/redemption-wait.test.ts` | 6 tests |

**Badges** :
- **Jaune (`warn`)** : `"Résultat connu"` — `marketWinningTokenId` set + `!marketResolved`
- **Bleu (`accent`)** : `"Rédemption"` — `getRedemptionWaitPhase() === 'awaiting_redemption'`

Aucune modification backend.

---

## 6. P5 — Monitoring des sous-marchés bloqués ✅ Implémenté (2026-07-09)

### 6.1 Problème

Les sous-marchés sportifs multi-jours peuvent rester en `winningTokenId set + resolved = false` pendant des jours sans alerte.

### 6.2 Implémentation réalisée

| Fichier | Changement |
|---------|------------|
| `packages/worker/src/processors/market-resolution-monitoring.ts` | `countStaleUnresolvedWinningTokenMarkets()`, seuil 24h |
| `packages/worker/src/processors/market-resolution-watcher.ts` | Appel en fin de `processAll()` + `log.warn` si count > 0 |
| `packages/worker/src/processors/market-resolution-monitoring.test.ts` | 2 tests DB |

```typescript
// Log émis toutes les 30s si des marchés sont stale :
// WARN markets with winningTokenId but unresolved for >24h  count=N
```

**Note** : métrique Datadog non ajoutée (hors scope minimal) — le log warn suffit pour l'ops initiale.

---

## 7. Tests (P1)

### 7.1 Test à modifier

**Fichier** : `packages/core/src/positions/redemption-wait.test.ts`

**Test** : `'includes open position when winning token is known'` (lignes 64-78)

Ce test crée un marché avec `winningTokenId: 'token-yes'` mais `closed: false, acceptingOrders: true, endDate: new Date('2026-12-31T00:00:00Z')` (marché encore actif, endDate dans le futur). Il s'attend à ce que `isAwaitingRedemptionPosition` retourne `true`.

**Après correctif** : Ce marché a encore un CLOB actif → la position n'est PAS en attente de rédemption → doit retourner `false`.

```typescript
// AVANT (lignes 64-78)
it('includes open position when winning token is known', () => {
  expect(
    isAwaitingRedemptionPosition(
      { status: 'open' },
      {
        ...terminalMarket,
        closed: false,
        acceptingOrders: true,
        winningTokenId: 'token-yes',
        endDate: new Date('2026-12-31T00:00:00Z'),
      },
      null,
    ),
  ).toBe(true);
});

// APRÈS
it('excludes open position when winning token is known but market is still live', () => {
  expect(
    isAwaitingRedemptionPosition(
      { status: 'open' },
      {
        ...terminalMarket,
        closed: false,
        acceptingOrders: true,
        winningTokenId: 'token-yes',
        endDate: new Date('2026-12-31T00:00:00Z'),
      },
      null,
    ),
  ).toBe(false);
});
```

### 7.2 Tests à ajouter

Ajouter un test pour `shouldSuppressSlTp` qui vérifie que `winningTokenId` seul ne supprime PAS le SL/TP (sous-marché dont le résultat est connu mais pas résolu) :

```typescript
it('does NOT suppress on winningTokenId alone (sub-market outcome known, not resolved)', () => {
  expect(
    shouldSuppressSlTp({
      resolved: false,
      winningTokenId: 'token-yes',
      closed: false,
      acceptingOrders: true,
      endDate: new Date('2099-01-01T00:00:00Z'),
    }),
  ).toBe(false);
});
```

Ajouter un test pour `getRedemptionWaitPhase` qui vérifie qu'un sous-marché à `winningTokenId` set et `resolved = false` n'est pas en `awaiting_redemption` :

```typescript
it('returns awaiting_resolution (not awaiting_redemption) when winningTokenId known but not resolved', () => {
  expect(
    getRedemptionWaitPhase(
      { status: 'open' },
      {
        resolved: false,
        winningTokenId: 'token-yes',
        closed: false,
        acceptingOrders: true,
        endDate: new Date(Date.now() - 1000), // endDate passé → isAwaitingRedemption = true
      },
      null,
    ),
  ).toBe('awaiting_resolution');
});
```

### 7.3 Test à supprimer

Le test existant `'suppresses when winningTokenId is known'` (lignes 202-210) doit être supprimé :

```typescript
// À SUPPRIMER — ce comportement n'est plus valide
it('suppresses when winningTokenId is known', () => {
  expect(
    shouldSuppressSlTp({
      ...terminalMarket,
      resolved: false,
      winningTokenId: 'token-yes',
    }),
  ).toBe(true);
});
```

---

## 8. Fichiers modifiés

### PR 1 — P1 + P2 + P3 + P0 (correctif + invariants) ✅

| Fichier | Modifications |
|---------|---------------|
| `packages/core/src/positions/redemption-wait.ts` | P1 + P2 + P0 |
| `packages/core/src/market/lifecycle.ts` | P3 |
| `packages/core/src/positions/redemption-wait.test.ts` | 22 tests |

### PR 2 — P4 + P5 (visibilité) ✅

| Fichier | Modifications |
|---------|---------------|
| `packages/frontend/src/lib/redemption-wait.ts` | Helpers badge P4 |
| `packages/frontend/src/lib/redemption-wait.test.ts` | 6 tests P4 |
| `packages/frontend/src/lib/position-tooltips.ts` | Tooltips P4 |
| `packages/frontend/src/lib/position.ts` | Exports P4 |
| `packages/frontend/src/components/position/PositionOpenRowMeta.tsx` | Affichage badges P4 |
| `packages/worker/src/processors/market-resolution-monitoring.ts` | Requête count P5 |
| `packages/worker/src/processors/market-resolution-monitoring.test.ts` | 2 tests P5 |
| `packages/worker/src/processors/market-resolution-watcher.ts` | Log warn P5 |

---

## 9. Vérifications de non-régression

### 9.1 Cas qui doivent continuer à fonctionner

| Scénario | `shouldSuppressSlTp` | `isMarketAwaitingRedemptionExit` | `getRedemptionWaitPhase` | Comportement attendu |
|----------|---------------------|----------------------------------|--------------------------|---------------------|
| Marché live, pas de winner | `false` | `false` | `null` | SL/TP actif, pas de rédemption |
| **Sous-marché live, winner connu, endDate dans 164h** | `false` ✅ | `false` ✅ | `null` ✅ | SL/TP actif, badge jaune "Résultat connu" (P4) |
| Marché terminal (`closed && !acceptingOrders`), winner connu | `false` | `true` (via `isMarketTerminal`) | `awaiting_resolution` | SL/TP actif (branche illiquide), affiché "En attente" |
| Marché terminal, pas de winner | `false` | `true` (via `isMarketTerminal`) | `awaiting_resolution` | SL/TP actif, affiché "En attente résolution" |
| Marché résolu (`resolved=true`) | `true` | `true` (via `resolved`) | `awaiting_redemption` | SL/TP supprimé, rédemption |
| Marché passé endDate, winner connu | `false` | `true` (via `endDate <= now`) | `awaiting_resolution` ✅ | SL/TP actif, affiché "En attente résolution" |
| Marché passé endDate, pas de winner | `false` | `true` (via `endDate <= now`) | `awaiting_resolution` | SL/TP actif, affiché "En attente résolution" |

### 9.2 Scénario de rédemption normale (sous-marché résolu officiellement)

```
1. Sous-marché "Spread: Belgium -4.5" → écart réalisé → winningTokenId = token-yes
   → shouldSuppressSlTp = false ✅ (SL/TP protège la position perdante)
   → isMarketAwaitingRedemptionExit = false ✅ (CLOB encore actif)
   → frontend : "Ouverte" (ou badge jaune "résultat connu" après P4)

2. endDate atteinte → isMarketTerminal = true
   → isMarketAwaitingRedemptionExit = true ✅
   → getRedemptionWaitPhase = 'awaiting_resolution' ✅
   → SL/TP toujours actif (branche illiquide)

3. Résolution officielle (UMA oracle) → resolved = true
   → shouldSuppressSlTp = true ✅
   → isMarketRedeemable = true
   → MarketResolutionWatcher → pending_resolution
   → getRedemptionWaitPhase = 'awaiting_redemption' ✅
   → RedemptionHandler → REDEMPTION
```

### 9.3 Scénario de perte évitée (sous-marché perdant + SL)

```
1. Sous-marché "Spread: Belgium -4.5" → écart réalisé → winningTokenId = token-yes
   → position sur token-NO (perdante)
   → shouldSuppressSlTp = false ✅ (SL/TP actif)

2. Le marché devient illiquide, le prix côté perdant s'effondre vers 0.00
   → SL se déclenche sur le mark conservateur (branche illiquide)
   → Position fermée avec close_reason = 'SL' ✅
   → Perte partielle (ex : -40 % au SL) au lieu de -100 % (no_payout en rédemption)
```

---

## 10. Pourquoi le patch ne casse pas la rédemption légitime des sous-tokens

C'est la question clé soulevée par l'analyse des sous-marchés : si on supprime `winningTokenId` des fonctions d'exit, est-ce qu'on risque de rater la rédemption des sous-marchés effectivement terminés ?

**Non**, car :

1. **La rédemption on-chain** est déclenchée par `MarketResolutionService.processCondition()` qui exige `isMarketRedeemable()` = `isMarketSettled() && winningTokenId`. Un sous-marché résolu officiellement (`resolved = true`) passe ce garde-fou et est correctement redeem.

2. **`isMarketSettled()`** couvre aussi le cas `closed && !acceptingOrders` — un sous-marché clôturé par Polymarket sans résolution formelle (ex : annulation) est aussi traité.

3. **Le SL/TP reste actif** entre le moment où `winningTokenId` est connu et le moment où `resolved = true`. Pendant cette fenêtre, le CLOB est encore vivant (`accepting_orders = true`), donc le SL/TP peut exit la position à un prix exploitable (0.20 pour le perdant via `slBidPoints`, ~1.00 pour le gagnant).

4. **Une fois `resolved = true`**, `shouldSuppressSlTp()` retourne `true` et `isMarketRedeemable()` retourne `true` → la position passe en `pending_resolution` puis en REDEMPTION, exactement comme aujourd'hui.

Le patch ne fait que **combler la fenêtre morte** entre "résultat du sous-token connu" et "résolution officielle du contrat", sans toucher au flux de rédemption final.

---

## 11. Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Un marché `resolved` sans `winningTokenId` (marché annulé) voit SL/TP supprimé | ✅ Correct — `isMarketRedeemable` = false, la position reste en `pending_resolution` sans rédemption possible. Le SL/TP ne servirait à rien car le CLOB est mort. |
| Un marché terminal (`closed && !acceptingOrders`) sans `resolved` garde SL/TP actif avec un book à 0 | ✅ La branche illiquide utilise le mark conservateur (lastTradePrice, lastCloseableBid). Si toutes les sources sont à 0, `canStillExitViaClob` retourne `false` et la sortie CLOB est désactivée. |
| Les positions crypto-algo (updown-5m) ont `winningTokenId` ~1-2h avant endDate | ✅ Leur `endDate` est à +5 min, donc le delta est faible. TIME_EXIT (configuré à 120s) continue de fonctionner. |
| Le frontend affiche des positions "ouvertes" qui ont un winner connu | ✅ Correct — elles sont encore clôturables via CLOB. P4 ajoute un badge "résultat connu" pour la clarté. |
| P5 (monitoring) génère du bruit sur les marchés sportifs multi-jours légitimes | ✅ Calibrer le seuil (>24h ou >48h) et le regrouper par `marketType`. Les marchés sportifs multi-jours sont attendus, l'alerte sert à détecter les cas anormaux (> 1 semaine). |

---

## 12. Approches écartées (et pourquoi)

### 12.1 ❌ Introduire une notion d'"event parent" pour grouper les sous-marchés

Polywatch traite déjà chaque `conditionId` de manière autonome, et c'est **correct** : la rédemption, le SL/TP, le cycle de vie sont par sous-marché, pas par event. Grouper par `eventSlug` introduirait une dépendance croisée (ex : "ne pas redeem le spread tant que le moneyline n'est pas résolu") qui n'a **aucun sens on-chain** — chaque sous-marché a son propre contrat et son propre payout. L'`eventSlug` sert uniquement à construire des URLs aujourd'hui. Le bug se résout entièrement au niveau du sous-marché individuel.

### 12.2 ❌ "Rédemption anticipée" pour les sous-tokens gagnants

On pourrait être tenté de redeem on-chain un sous-token gagnant dès que `winningTokenId` est connu, sans attendre `resolved`. **Déconseillé** :

- Le contrat Polymarket (UMA oracle) **refusera** la rédemption tant que `resolved = false` — ça produirait des `redemption_failed` en boucle.
- `RedemptionHandler` a déjà ce garde-fou (`isMarketRedeemable`), il faut le préserver.
- La sortie CLOB à ~1.00 sur le carnet vivant est une meilleure option pour les gagnants (pas de gaz, pas d'attente on-chain).

---

## 13. Résumé des changements P1 (diff)

```diff
--- a/packages/core/src/positions/redemption-wait.ts
+++ b/packages/core/src/positions/redemption-wait.ts
@@ -53,10 +53,9 @@ export function isRedemptionFailureError(
 export function isMarketAwaitingRedemptionExit(
   market: MarketLifecycleState | null | undefined,
   now = Date.now(),
 ): boolean {
   if (!market) return false;
   if (isMarketTerminal(market)) return true;
   if (market.resolved) return true;
-  if (market.winningTokenId) return true;
   if (market.endDate && market.endDate.getTime() <= now) return true;
   return false;
 }
@@ -72,12 +71,9 @@ export function isMarketAwaitingRedemptionExit(
 export function shouldSuppressSlTp(
   market: MarketLifecycleState | null | undefined,
 ): boolean {
   if (!market) return false;
   if (market.resolved) return true;
-  if (market.winningTokenId) {
-    return true;
-  }
   return false;
 }
 
@@ -120,7 +116,7 @@ export function getRedemptionWaitPhase(
   if (!isAwaitingRedemptionPosition(pos, market, lastCloseError, now)) {
     return null;
   }
   if (pos.status === 'pending_resolution') return 'awaiting_redemption';
-  if (market?.winningTokenId || market?.resolved) return 'awaiting_redemption';
+  if (market?.resolved) return 'awaiting_redemption';
   return 'awaiting_resolution';
 }
```

```diff
--- a/packages/core/src/positions/redemption-wait.test.ts
+++ b/packages/core/src/positions/redemption-wait.test.ts
@@ -61,18 +61,18 @@ describe('isAwaitingRedemptionPosition', () => {
     ).toBe(true);
   });
 
-  it('includes open position when winning token is known', () => {
+  it('excludes open position when winning token is known but market is still live', () => {
     expect(
       isAwaitingRedemptionPosition(
         { status: 'open' },
         {
           ...terminalMarket,
           closed: false,
           acceptingOrders: true,
           winningTokenId: 'token-yes',
           endDate: new Date('2026-12-31T00:00:00Z'),
         },
         null,
       ),
-    ).toBe(true);
+    ).toBe(false);
   });
 
@@ -199,12 +199,4 @@ describe('shouldSuppressSlTp', () => {
     ).toBe(true);
   });
 
-  it('suppresses when winningTokenId is known', () => {
-    expect(
-      shouldSuppressSlTp({
-        ...terminalMarket,
-        resolved: false,
-        winningTokenId: 'token-yes',
-      }),
-    ).toBe(true);
-  });
-
   it('does NOT suppress on past endDate alone (CLOB may still be active)', () => {
+    // ... tests existants ...
+  });
+
+  it('does NOT suppress on winningTokenId alone (sub-market outcome known, not resolved)', () => {
+    expect(
+      shouldSuppressSlTp({
+        resolved: false,
+        winningTokenId: 'token-yes',
+        closed: false,
+        acceptingOrders: true,
+        endDate: new Date('2099-01-01T00:00:00Z'),
+      }),
+    ).toBe(false);
+  });
+});
+
+describe('getRedemptionWaitPhase', () => {
+  it('returns awaiting_resolution (not awaiting_redemption) when winningTokenId known but not resolved', () => {
+    expect(
+      getRedemptionWaitPhase(
+        { status: 'open' },
+        {
+          resolved: false,
+          winningTokenId: 'token-yes',
+          closed: false,
+          acceptingOrders: true,
+          endDate: new Date(Date.now() - 1000),
+        },
+        null,
+      ),
+    ).toBe('awaiting_resolution');
+  });
```

---

## 14. Références

- `packages/core/src/positions/redemption-wait.ts` — `shouldSuppressSlTp()`, `isMarketAwaitingRedemptionExit()`, `getRedemptionWaitPhase()`, `isAwaitingRedemptionPosition()`
- `packages/core/src/market/lifecycle.ts` — `isMarketSettled()`, `isMarketRedeemable()`, `isMarketOutcomeKnown()`, `isMarketTerminal()`, `MarketLifecycleState`
- `packages/core/src/polymarket/market-metadata.ts` — `determineWinnerFromPrices()`, `determineWinningTokenFromClobTokens()`, `WINNING_PRICE_THRESHOLD = 0.99`
- `packages/core/src/services/market.service.ts` — `persistMarket()` (persistance de `winningTokenId`)
- `packages/core/src/services/market-resolution.service.ts` — `processCondition()` (garde-fou `isMarketRedeemable`)
- `packages/worker/src/processors/redemption-handler.ts` — `RedemptionHandler.redeem()` (garde-fou on-chain)
- `packages/worker/src/processors/market-resolution-watcher.ts` — `MarketResolutionWatcher` (cible de P5)
- `packages/worker/src/processors/strategy/position-exit-evaluator.ts` — `evaluateCloseLogic()` (consomme `shouldSuppressSlTp`)
- `packages/core/src/risk/exit-decision.ts` — `evaluatePositionExit()` (TIME_EXIT utilise `isMarketOutcomeKnown`)
- `docs/v1/v1-5/2026-07-08_brainstorm_redemption_winning_token_premature.md` — brainstorm complet
- `tools/_query-redemption.ts`, `tools/_query-belgium-spread.ts` — outils de diagnostic BDD
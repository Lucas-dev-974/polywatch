# Brainstorm — Patch : `winningTokenId` ≠ settled (sous-marchés Polymarket)

**Date** : 2026-07-08
**Dernière mise à jour** : 2026-07-09
**Version cible** : v1-5
**Statut** : ✅ **P1–P5 implémentés** — vérification prod positions #17294–#17379 en attente
**Auteur** : Audit BDD + analyse code
**Tags** : `bug`, `redemption`, `winningTokenId`, `SL`, `copy-trading`, `dead-zone`, `exit-decision`, `sous-token`, `spread`, `polymarket`, `implémenté`
**Documents associés** :
- Patch : `2026-07-08_patch_redemption_winning_token_premature.md`
- Plan P4/P5 : `2026-07-09_plan_p4_p5_outcome_badge_monitoring.md`
- Extension P0 SL/TP : `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md` §7
- **Mise à jour 2026-07-09 (v1-4)** : l'exception TIME_EXIT via `isMarketOutcomeKnown` est **retirée** — TIME_EXIT skip sur `resolved` uniquement. Voir `docs/v1/v1-4/2026-07-09_patch_deadlock_time_exit_outcome_known.md` (cas UpDown 5m #18075). SL/TP sous `winningTokenId` seul reste actif (P1 inchangé).

---

## 1. Résumé du problème

Des positions en mode **copy trading simulation** restaient bloquées en statut `open` sans aucune protection de sortie (SL/TP désactivé, TIME_EXIT et PRE_CLOSE hors fenêtre) pendant que leur marché possédait un `winningTokenId` connu alors que le contrat Polymarket n'était **pas encore `resolved`**.

**Cause racine raffinée** : sur Polymarket, un événement (match, élection, etc.) est décliné en de nombreux **sous-marchés** (Moneyline, Spread, Total, Exact Score…), chacun avec son propre `conditionId` et son propre `winningTokenId`. Pour un sous-marché de type **spread** (ex : "Belgium -4.5"), le résultat du sous-token peut être **définitivement connu dès que l'écart est réalisé**, même si le match continue — le token gagnant cote alors à 1.00 sur le CLOB. Polywatch **déduit** `winningTokenId` de ce prix (seuil `>= 0.99`) et le persiste en BDD **sans exiger** `resolved === true`.

Le système interprétait ensuite ce `winningTokenId` comme un signal de "marché terminé" dans trois fonctions critiques (`shouldSuppressSlTp()`, `isMarketAwaitingRedemptionExit()`, `getRedemptionWaitPhase()`), créant une **zone morte** : la position n'était ni exitable via CLOB (SL/TP coupé), ni redeemable on-chain (`isMarketRedeemable()` exige `isMarketSettled()`), et restait bloquée jusqu'à la résolution officielle — parfois des jours plus tard.

**Résultat avant correctif** : perte potentielle de -100 % (no_payout) si le marché devenait illiquide ou si le côté perdant s'effondrait entre-temps, alors que le SL/TP aurait pu protéger la position.

### 1.1 Correctif appliqué (2026-07-08 / 2026-07-09)

| Niveau | Statut | Fichiers |
|--------|--------|----------|
| **P1** — 3 fonctions corrigées | ✅ Implémenté | `packages/core/src/positions/redemption-wait.ts` |
| **P2** — Invariant documenté | ✅ Implémenté | `redemption-wait.ts` (lignes 8-26) |
| **P3** — JSDoc `isMarketOutcomeKnown()` | ✅ Implémenté | `packages/core/src/market/lifecycle.ts` (lignes 51-69) |
| **P0** — Extension `shouldSuppressSlTp` | ✅ Implémenté | `endDate` passé + `acceptingOrders === false` (boucles `no_liquidity`) |
| **Tests** | ✅ 22/22 passent | `packages/core/src/positions/redemption-wait.test.ts` |
| **P4** — Badge frontend | ✅ Implémenté | `redemption-wait.ts`, `PositionOpenRowMeta.tsx`, tooltips |
| **P5** — Monitoring | ✅ Implémenté | `market-resolution-monitoring.ts`, `market-resolution-watcher.ts` |

---

## 2. Anatomie d'un sous-marché Polymarket (contexte)

### 2.1 Structure événement → marchés → tokens

Polymarket organise les paris autour de la notion d'**event**, qui regroupe plusieurs **markets** (sous-marchés), chacun décliné en deux **tokens** (YES/NO) pour les marchés binaires :

```
Event : "FIFA World Cup — Spain vs Belgium" (10 juil. 2026)
  ├─ Market : Moneyline             (conditionId A)  → tokens YES/NO
  ├─ Market : Spread: Belgium -4.5  (conditionId B)  → tokens YES/NO
  ├─ Market : Spread: Belgium -5    (conditionId C)  → tokens YES/NO
  ├─ Market : Spread: Belgium -3    (conditionId D)  → tokens YES/NO
  ├─ Market : Total: 7.5            (conditionId E)  → tokens YES/NO
  ├─ Market : Exact Score 3-0       (conditionId F)  → tokens YES/NO
  └─ … (parfois 20+ sous-marchés par event)
```

Caractéristiques clés :

- **Chaque sous-marché est indépendant** : son `conditionId`, son `endDate`, son `winningTokenId`, son statut `resolved`/`closed`/`acceptingOrders` sont propres.
- **`endDate` est partagé** : généralement la fin prévue du match (ex : 10 juil. 21:00). Tous les sous-marchés d'un même event ont la même `endDate`.
- **`winningTokenId` peut être connu à des moments différents** :
  - Le **spread** "Belgium -4.5" est décidé dès que l'écart de score atteint 5 points — potentiellement en plein match.
  - Le **total** "7.5" est décidé dès que 8 buts/points sont marqués.
  - Le **moneyline** n'est décidé qu'à la fin du match.
- **Le contrat intelligent Polymarket** ne marque `resolved = true` qu'à la **fin officielle** de l'event (UMA oracle / resolve), après `endDate`.

### 2.2 Ce que ça signifie pour Polywatch

Polywatch traite chaque `conditionId` comme un marché autonome (entity `Market`). Il n'y a **pas de notion d'event parent** dans la logique de cycle de vie : la table `Market` stocke `eventSlug` uniquement pour construire des URLs (`buildPolymarketMarketUrl`), pas pour grouper le cycle de vie.

**Conséquence** : un sous-marché de spread peut avoir son `winningTokenId` persisté (token YES à 1.00 sur le CLOB) alors que :

- `resolved = false` (l'event n'est pas officiellement résolu)
- `closed = false` (Polymarket garde le marché ouvert)
- `accepting_orders = true` (le CLOB accepte encore des ordres)
- `endDate` est dans **+60h** (le match n'est même pas commencé ou en cours)

C'est exactement le cas observé pour la position #17308 (cf. §4).

---

## 3. Comment Polywatch déduit `winningTokenId` (cause racine technique)

### 3.1 Déduction par le prix, pas par un flag officiel

Polywatch ne reçoit **pas** `winningTokenId` comme un champ "résolution officielle" de Polymarket. Il le **calcule** à partir des prix CLOB/Gamma.

**Fichier** : `packages/core/src/polymarket/market-metadata.ts`

```typescript
// Resolved binary markets report the winner with a payoff price of 1.
const WINNING_PRICE_THRESHOLD = 0.99;

function determineWinnerFromPrices(
  tokenIds: string[] | undefined,
  outcomePrices: string[] | undefined,
): string | null {
  if (!tokenIds || !outcomePrices) return null;
  if (tokenIds.length !== outcomePrices.length) return null;
  const winnerIndex = outcomePrices.findIndex(
    (price) => Number(price) >= WINNING_PRICE_THRESHOLD,
  );
  return winnerIndex >= 0 ? tokenIds[winnerIndex] : null;
}
```

```typescript
function determineWinningTokenFromClobTokens(
  tokens: Record<string, unknown>[],
): string | null {
  for (const token of tokens) {
    const tokenId = typeof token.token_id === 'string' ? token.token_id : null;
    if (!tokenId) continue;
    if (token.winner === true || Number(token.price) >= WINNING_PRICE_THRESHOLD) {
      return tokenId;
    }
  }
  return null;
}
```

Dès qu'un token cote à `>= 0.99` (ou porte `winner: true` sur le CLOB), Polywatch le considère comme `winningTokenId`.

### 3.2 Persistance systématique sans vérifier `resolved`

**Fichier** : `packages/core/src/services/market.service.ts` (`persistMarket`)

```typescript
if (fetched.winningTokenId) market.winningTokenId = fetched.winningTokenId;
market.resolved = fetched.resolved;
market.closed = fetched.closed;
```

`winningTokenId` est copié tel quel, indépendamment de `resolved`. La BDD peut donc contenir des lignes avec `winningTokenId != null` ET `resolved = false` — c'est légitime du point de vue de la persistance (le prix reflète bien le résultat du sous-token), mais **trompeur** du point de vue du cycle de vie.

### 3.3 Le seuil 0.99 est robuste pour les sous-tokens décidés

Pour un sous-marché de spread dont l'écart est réalisé, le token gagnant cote à **1.00** (payoff certain) et le perdant à **0.00**. Le seuil `>= 0.99` capture donc correctement le résultat du sous-token. Ce n'est pas un bug de détection — c'était l'**interprétation** de ce signal dans le cycle de vie (SL/TP, affichage) qui était fautive, **corrigée par P1**.

---

## 4. Cas concret : position #17308 (Spain vs Belgium, Spread -4.5)

### 4.1 Description utilisateur

> swisstony — Spain Sim — Rédemption automatique en cours. Aucune action requise.
> Sports — Spread: Belgium (-4.5) — 2.00 pUSD — 2.00 @ 0.9990 — frais entrée 0.000060 pUSD — ouvert 08/07 08:04 — expire 2j 10h

### 4.2 État en BDD (vérifié)

| Champ | Valeur |
|-------|--------|
| `copied_position.id` | 17308 |
| `status` | `open` |
| `mode` | `sim` |
| `conditionId` | (sous-marché "Spread: Belgium -4.5") |
| `market.winningTokenId` | **présent** (token gagnant = Belgium a couvert le spread) |
| `market.resolved` | **false** |
| `market.closed` | **false** |
| `market.accepting_orders` | **true** |
| `market.endDate` | **10 juil. 21:00** (~+60h) |
| `entry_bid_vwap` | 0.9990 |
| `quantity` | 2.00 pUSD |

### 4.3 Interprétation (état observé AVANT correctif)

- Le match **n'est pas fini** (`endDate` dans +60h, `accepting_orders = true`).
- **L'écart de 4.5 a été réalisé** → le token YES du sous-marché "Spread: Belgium -4.5" cote à 1.00 → Polywatch persiste `winningTokenId`.
- La position est **gagnante** pour le sous-token, mais elle ne peut pas encore être redeem on-chain (le contrat n'est pas `resolved`).
- **Polywatch affichait "Rédemption automatique en cours"** dans le frontend, car `isMarketAwaitingRedemptionExit()` retournait `true` sur `winningTokenId` seul.
- SL/TP était supprimé (`shouldSuppressSlTp()` retournait `true` sur `winningTokenId` seul).

### 4.4 Comportement attendu APRÈS correctif (P1)

Pour la même position #17308 (`winningTokenId` set, `resolved = false`, `accepting_orders = true`, `endDate` dans +60h) :

| Fonction | Avant | Après correctif |
|----------|-------|-----------------|
| `shouldSuppressSlTp()` | `true` ❌ | `false` ✅ — SL/TP actif |
| `isMarketAwaitingRedemptionExit()` | `true` ❌ | `false` ✅ — pas en attente de rédemption |
| `getRedemptionWaitPhase()` | `null` ✅ | `null` ✅ — pas de "rédemption en cours" |
| Frontend | "Rédemption automatique en cours" | Position ouverte + badge jaune **"Résultat connu"** (P4) |

Pour une position **perdante** sur le même sous-marché (token NO), le SL/TP à `sl_bid_points = 0.20` peut désormais déclencher une sortie CLOB tant que le carnet est vivant.

### 4.5 Pourquoi la position était en zone morte (AVANT correctif)

Pour cette position précise (entrée à 0.9990, déjà gagnante), l'impact réel est limité (le payoff sera 1.00 à la rédemption). **Mais** :

1. Le frontend ment — il indique "rédemption en cours" alors que rien ne se passe pendant 60h.
2. Pour une position **perdante** sur le même sous-marché (entrée sur le token NO), le scénario est dramatique : SL/TP coupé, aucune sortie CLOB, perte -100 % à la rédemption finale, alors que le SL/TP aurait pu exit à 0.20 sur le carnet encore vivant.
3. Les positions #17301 (Total 7.5), #17304 (Spread -5), #17315 (Spread -3) sont dans le même cas.

---

## 5. Données constatées en BDD

### 5.1 Configuration sim actuelle

| Paramètre | Valeur |
|-----------|--------|
| `sim_initial_capital` | 1 000 pUSD |
| `sim_sl_percent` | 40 % |
| `sim_tp_percent` | 300 % |
| `sim_trailing_enabled` | false |
| `sim_sl_bid_points` | 0.20 |
| `sim_tp_bid_points` | 0.99 |
| `sim_pre_close_enabled` | true |
| `sim_pre_close_seconds` | 40 s |
| `sim_min_time_to_close` | 120 s |
| `sim_sl_tp_enabled` | true |
| `sim_copy_trading_enabled` | true |

### 5.2 Positions bloquées en `open` avec `winningTokenId` connu

| Position | Marché (sous-token) | endDate | Heures restantes | winner | Type de sous-marché |
|----------|---------------------|---------|-----------------|--------|---------------------|
| #17294 | itf-mo-sarksia-2026-07-08 | 15 juil. 04:00 | **+164 h** | oui | Tennis (multi-jours) |
| #17301 | fifwc-esp-bel-2026-07-10-total-7pt5 | 10 juil. 21:00 | **+61 h** | oui | **Total** (sous-marché) |
| #17304 | fifwc-esp-bel-2026-07-10-spread-away-5pt | 10 juil. 21:00 | **+61 h** | oui | **Spread** (sous-marché) |
| #17308 | fifwc-esp-bel-2026-07-10-spread-away-4pt | 10 juil. 21:00 | **+61 h** | oui | **Spread** (sous-marché) |
| #17315 | fifwc-esp-bel-2026-07-10-spread-away-3pt | 10 juil. 21:00 | **+61 h** | oui | **Spread** (sous-marché) |
| #17378 | eth-updown-5m-1783496100 | 8 juil. 09:40 | **+1.9 h** | oui | Crypto up/down 5m |
| #17379 | btc-updown-5m-1783496100 | 8 juil. 09:40 | **+1.9 h** | oui | Crypto up/down 5m |

**Observation** : 4 des 7 positions sont des **sous-marchés de spread/total** du même event "Spain vs Belgium", dont le résultat du sous-token est connu alors que le match n'a même pas commencé (`endDate` = 10 juil. 21:00, relevé le 8 juil. à 10:00).

### 5.3 Marchés avec `winningTokenId` mais endDate lointaine

Des **dizaines de marchés** ont un `winningTokenId` assigné alors que leur `endDate` est dans **+2 h à +164 h**. Exemples :

| Slug | endDate | Heures restantes | closed | accepting_orders | Type |
|------|---------|-----------------|--------|-----------------|------|
| itf-mo-sarksia-2026-07-08 | 15 juil. 04:00 | 164 h | true | false | Tennis multi-jours |
| mlb-mia-col-2026-07-01 | 9 juil. 02:00 | 18 h | true | false | Baseball |
| atp-fritz-bublik-2026-07-06 | 13 juil. 12:00 | 124 h | false | true | Tennis |
| fifwc-esp-bel-2026-07-10-spread-away-5pt | 10 juil. 21:00 | 61 h | false | true | **Spread** (sous-marché) |

---

## 6. Flux du bug — état AVANT correctif (historique)

> **Note** : cette section documente le comportement fautif observé avant l'implémentation de P1 (2026-07-08). Le flux corrigé est en §13.

### 6.1 Le pipeline de résolution de marché

```
Gamma/CLOB API retourne outcomePrices = [1.00, 0.00] pour le sous-marché
  │
  ├─ determineWinnerFromPrices() → winningTokenId = tokenId du YES
  │
  ├─ MarketService.persistMarket()
  │   └─ market.winningTokenId = <tokenId>   (sans vérifier resolved)
  │   └─ market.resolved = false             (l'event n'est pas officiellement résolu)
  │
  ├─ MarketResolutionWatcher (toutes les 15s)
  │   └─ MarketResolutionService.processResolvablePositions()
  │       └─ fetchAndPersist() → winningTokenId présent
  │           └─ isMarketRedeemable() ?
  │               ├─ isMarketSettled() = false (pas resolved, pas closed+!acceptingOrders)
  │               └─ → false → SKIP ❌ (ne passe pas en pending_resolution)
  │
  └─ StrategyProcessing (toutes les 100ms)
      └─ evaluatePosition()
          └─ buildPositionExitContext()
              └─ shouldSuppressSlTp(lifecycle)
                  ├─ market.winningTokenId = true (déduit du prix 1.00)
                  └─ → true → SL/TP désactivé ❌
```

### 6.2 La zone morte

```
winningTokenId connu (t = 0) — ex : spread réalisé en plein match
  │
  ├─ shouldSuppressSlTp = true → SL/TP désactivé
  ├─ TIME_EXIT pas encore dans la fenêtre (timeExitSeconds pas atteint)
  ├─ PRE_CLOSE pas encore dans la fenêtre (preCloseSeconds pas atteint)
  ├─ isMarketRedeemable = false → pas de passage en pending_resolution
  ├─ isMarketAwaitingRedemptionExit = true → frontend affiche "rédemption en cours" (faux)
  │
  └─ [ZONE MORTE] ── la position reste ouverte sans protection pendant des heures/jours ──
      │
      ├─ Le marché peut devenir illiquide (book à 0)
      ├─ Le prix peut s'effondrer (côté perdant)
      ├─ Le frontend ment ("rédemption en cours" alors que rien ne se passe)
      └─ Aucune sortie possible jusqu'à la résolution officielle
          │
          └─ Résolution officielle (resolved = true) → pending_resolution → REDEMPTION
              └─ Perte potentielle : -100 % (no_payout) pour le côté perdant
```

### 6.3 Différence entre sous-marchés "décidés tôt" et marchés "résolus tard"

```
Event : Spain vs Belgium (endDate = 10 juil. 21:00)
  │
  ├─ t = 8 juil. 10:00  (le match n'a pas commencé)
  │   ├─ Spread -4.5 : résultat connu (Belgium a couvert à l'avance via autre match ?)
  │   │   └─ winningTokenId = YES, resolved = false, accepting_orders = true
  │   │   └─ [AVANT P1 : zone morte 60h] → [APRÈS P1 : SL/TP actif ✅]
  │   │
  │   └─ Moneyline : pas de winner connu
  │       └─ winningTokenId = null → SL/TP actif ✅
  │
  └─ t = 10 juil. 23:00  (match fini, résolution officielle)
      └─ Tous les sous-marchés : resolved = true
          └─ isMarketRedeemable = true → pending_resolution → REDEMPTION
```

---

## 7. Analyse du code — AVANT / APRÈS correctif

### 7.1 `shouldSuppressSlTp()` — corrigé (+ extension P0)

**Fichier** : `packages/core/src/positions/redemption-wait.ts`

**AVANT (bug)** :

```typescript
export function shouldSuppressSlTp(market): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  if (market.winningTokenId) return true;  // ← BUG
  return false;
}
```

**APRÈS (implémenté)** :

```typescript
export function shouldSuppressSlTp(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (market.resolved) return true;
  // Past endDate AND CLOB not accepting orders → no liquidity (P0 fix)
  if (
    market.endDate &&
    market.endDate.getTime() <= now &&
    market.acceptingOrders === false
  ) {
    return true;
  }
  return false;
}
```

**Changements** :
- ❌ Supprimé : `if (market.winningTokenId) return true`
- ✅ Ajouté (P0, v1-4) : suppression si `endDate` passé **ET** `acceptingOrders === false` — évite les boucles infinies `no_liquidity` après expiration du marché
- ✅ `winningTokenId` seul ne supprime plus le SL/TP — les sous-marchés (spread, total) gardent leur protection tant que le CLOB est vivant

### 7.2 `isMarketAwaitingRedemptionExit()` — corrigé

**AVANT (bug)** :

```typescript
if (market.winningTokenId) return true;  // ← BUG
```

**APRÈS (implémenté, lignes 80-89)** :

```typescript
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  if (market.endDate && market.endDate.getTime() <= now) return true;
  return false;
}
```

**Impact corrigé** :
- `isAwaitingRedemptionPosition()` → ne classe plus les positions `open` sur sous-marché live comme "en attente de rédemption"
- `ResultsConsumer.maybeRetryForcedExitClose()` → retries de forced exit continuent tant que `resolved = false`
- **Frontend** → ne affiche plus "Rédemption automatique en cours" pour un sous-marché dont seul le résultat est connu

### 7.3 `getRedemptionWaitPhase()` — corrigé

**AVANT (bug)** :

```typescript
if (market?.winningTokenId || market?.resolved) return 'awaiting_redemption';
```

**APRÈS (implémenté, lignes 159-171)** :

```typescript
if (market?.resolved) return 'awaiting_redemption';
return 'awaiting_resolution';
```

Un sous-marché avec `winningTokenId` set et `endDate` passé retourne désormais `'awaiting_resolution'` (et non `'awaiting_redemption'`) tant que `resolved = false`.

### 7.4 Invariant documenté (P2) — implémenté

Bloc de commentaire en tête de `redemption-wait.ts` (lignes 8-26) :

```
// INVARIANT — winningTokenId ≠ settled
// RULE: no lifecycle decision must rely on winningTokenId alone.
// Always require resolved || isMarketSettled().
// Exception: isMarketOutcomeKnown() for TIME_EXIT only.
```

### 7.5 `isMarketOutcomeKnown()` — JSDoc enrichi (P3)

**Fichier** : `packages/core/src/market/lifecycle.ts` (lignes 51-72)

JSDoc ajouté listant les usages légitimes (TIME_EXIT) et interdits (SL/TP, pending_resolution, affichage frontend). Comportement inchangé : `return market.resolved || !!market.winningTokenId`.

### 7.6 `isMarketRedeemable()` — inchangé (garde-fou on-chain)

```typescript
export function isMarketRedeemable(market: MarketLifecycleState): boolean {
  return isMarketSettled(market) && !!market.winningTokenId;
}
```

Toujours correct — protège `MarketResolutionWatcher` et `RedemptionHandler` contre la rédemption prématurée.

### 7.7 `isMarketSettled()` — inchangé

```typescript
export function isMarketSettled(market: MarketLifecycleState): boolean {
  if (market.resolved) return true;
  if (market.closed && market.acceptingOrders === false) return true;
  return false;
}
```

`winningTokenId` seul ne suffit pas.

### 7.8 `MarketResolutionService` / `RedemptionHandler` — inchangés

Les garde-fous on-chain (`isMarketRedeemable()`) n'ont pas été modifiés — le bug n'affectait que la couche "décision d'exit / suppression SL/TP / affichage".

---

## 8. Solutions envisagées

### Solution A : Restreindre `shouldSuppressSlTp()` à `resolved` uniquement

**Principe** : Ne supprimer SL/TP que quand le marché est officiellement `resolved`. `winningTokenId` seul ne suffit pas — le CLOB peut encore avoir de la liquidité exploitable (sous-marché dont le résultat est connu mais l'event continue).

**Modification** dans `redemption-wait.ts` :

```typescript
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

**Avantages** :

- Simple, changement localisé (1 fichier, 2 lignes)
- Laisse SL/TP actif pour protéger les positions perdantes
- TIME_EXIT et PRE_CLOSE continuent de fonctionner normalement

**Inconvénients** :

- Sur les marchés où `winningTokenId` est connu ET le CLOB est déjà mort (cas rare), le SL/TP s'évaluera sur un book à 0 → la branche illiquide gère ce cas

### Solution B : Restreindre `isMarketAwaitingRedemptionExit()` aussi

**Principe** : Aligner `isMarketAwaitingRedemptionExit()` sur `isMarketRedeemable()` — exiger `isMarketSettled()` en plus de `winningTokenId`.

**Modification** dans `redemption-wait.ts` :

```typescript
export function isMarketAwaitingRedemptionExit(
  market: MarketLifecycleState | null | undefined,
  now = Date.now(),
): boolean {
  if (!market) return false;
  if (isMarketTerminal(market)) return true;
  if (market.resolved) return true;
  // winningTokenId seul ne suffit pas — un sous-marché (spread, total) peut
  // avoir son résultat connu sans que le contrat soit settled. Attendre
  // isMarketSettled() avant de considérer la position en attente de rédemption.
  if (market.endDate && market.endDate.getTime() <= now) return true;
  return false;
}
```

**Note** : la condition `winningTokenId && isMarketSettled(market)` est redondante avec `isMarketTerminal(market)` et `market.resolved` déjà présents en haut. La supprimer entièrement est plus propre.

**Avantages** :

- Cohérent avec `isMarketRedeemable()`
- Empêche le frontend d'afficher des positions comme "En attente de rédemption" trop tôt
- Permet aux retries de forced exit de continuer à fonctionner

**Inconvénients** :

- Changement plus large (impacte frontend + ResultsConsumer)

### Solution C : Aligner aussi `getRedemptionWaitPhase()`

**Principe** : Ne retourner `awaiting_redemption` que sur `resolved` (pas sur `winningTokenId` seul).

**Modification** dans `redemption-wait.ts` :

```typescript
export function getRedemptionWaitPhase(
  pos: { status: string },
  market: MarketLifecycleState | null | undefined,
  lastCloseError: string | null | undefined,
  now = Date.now(),
): RedemptionWaitPhase | null {
  if (!isAwaitingRedemptionPosition(pos, market, lastCloseError, now)) {
    return null;
  }
  if (pos.status === 'pending_resolution') return 'awaiting_redemption';
  if (market?.resolved) return 'awaiting_redemption';
  return 'awaiting_resolution';
}
```

**Avantage** : le frontend n'affiche plus "rédemption en cours" pour un sous-marché dont seul le résultat est connu.

### Solution D : Combinaison A + B + C — ✅ **IMPLÉMENTÉE** (2026-07-08)

**Principe** :

1. `shouldSuppressSlTp()` → ne supprimer que sur `resolved` (+ extension P0 : `endDate` passé + `acceptingOrders === false`)
2. `isMarketAwaitingRedemptionExit()` → supprimer la branche `winningTokenId` seul
3. `getRedemptionWaitPhase()` → ne retourner `awaiting_redemption` que sur `resolved`

**Résultat** : Résout le bug à la racine sans compromettre la sécurité des sorties, ni casser la rédemption légitime des sous-marchés résolus (qui passent par `isMarketRedeemable` qui exige `isMarketSettled`).

---

## 9. Impact sur les autres modes (après implémentation P1)

| Mode | Impact | Raison |
|------|--------|--------|
| **Copy trading sim** | ✅ Corrigé | SL/TP reste actif tant que le marché n'est pas `resolved` (ou CLOB mort post-endDate via P0) |
| **Copy trading real** | ✅ Corrigé | Même logique |
| **Crypto algo sim** | ✅ Neutre | TIME_EXIT propre ; `isMarketOutcomeKnown` inchangé |
| **Crypto algo real** | ✅ Neutre | Idem |
| **Frontend** | ✅ Corrigé + P4 | Plus de "rédemption en cours" prématuré ; badge jaune "Résultat connu" sur sous-marchés live |
| **Redemption on-chain** | ✅ Neutre | Déjà protégé par `isMarketRedeemable()` |
| **Sous-marchés résolus officiellement** | ✅ Neutre | `resolved = true` → flux normal inchangé |

---

## 10. Pourquoi le patch ne casse pas la rédemption légitime des sous-tokens

*(Validé après implémentation P1 — comportement confirmé par les 22 tests unitaires.)*

C'est la question clé : si on supprime `winningTokenId` des fonctions d'exit, est-ce qu'on risque de rater la rédemption des sous-marchés effectivement terminés ?

**Non**, car :

1. **La rédemption on-chain** est déclenchée par `MarketResolutionService.processCondition()`, qui exige `isMarketRedeemable()` = `isMarketSettled() && winningTokenId`. Un sous-marché résolu officiellement (`resolved = true`) passe ce garde-fou et est correctement redeem.

2. **`isMarketSettled()`** couvre aussi le cas `closed && !acceptingOrders` — un sous-marché clôturé par Polymarket sans résolution formelle (ex : annulation) est aussi traité.

3. **Le SL/TP reste actif** entre le moment où `winningTokenId` est connu et le moment où `resolved = true` (ou `endDate` passé + `acceptingOrders = false` via P0). Pendant cette fenêtre, le CLOB peut encore offrir une sortie exploitable.

4. **Une fois `resolved = true`**, `shouldSuppressSlTp()` retourne `true` et `isMarketRedeemable()` retourne `true` → la position passe en `pending_resolution` puis en REDEMPTION, exactement comme aujourd'hui.

Le patch ne fait que **combler la fenêtre morte** entre "résultat du sous-token connu" et "résolution officielle du contrat", sans toucher au flux de rédemption final.

---

## 11. État d'implémentation

### 11.1 P1 — Correctif du bug ✅

| Tâche | Statut | Détail |
|-------|--------|--------|
| `shouldSuppressSlTp()` — retirer `winningTokenId` | ✅ | Lignes 110-126 de `redemption-wait.ts` |
| `isMarketAwaitingRedemptionExit()` — retirer `winningTokenId` | ✅ | Lignes 80-89 |
| `getRedemptionWaitPhase()` — `resolved` uniquement | ✅ | Ligne 169 |
| Tests unitaires | ✅ | 22/22 passent (`npx vitest run src/positions/redemption-wait.test.ts`) |

**Tests ajoutés/modifiés** :
- `excludes open position when winning token is known but market is still live` (modifié, attend `false`)
- `does NOT suppress on winningTokenId alone (sub-market outcome known, not resolved)` (ajouté)
- `returns awaiting_resolution when winningTokenId known but not resolved` (ajouté)
- `suppresses when winningTokenId is known` (supprimé — comportement obsolète)

### 11.2 P2 — Invariant documenté ✅

Bloc `// INVARIANT — winningTokenId ≠ settled` ajouté en tête de `redemption-wait.ts` (lignes 8-26).

### 11.3 P3 — JSDoc `isMarketOutcomeKnown()` ✅

JSDoc enrichi dans `lifecycle.ts` (lignes 51-69) — usages légitimes vs interdits.

### 11.4 Extension P0 — `shouldSuppressSlTp` post-endDate ✅

Ajouté en complément du correctif P1 (réf. `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md` §7) :

```typescript
if (
  market.endDate &&
  market.endDate.getTime() <= now &&
  market.acceptingOrders === false
) {
  return true;  // CLOB mort après endDate → évite boucles no_liquidity
}
```

**Tests P0** :
- `suppresses on terminal market (past endDate + not accepting orders, P0 fix)` → `true`
- `does NOT suppress on past endDate when CLOB still accepting orders` → `false`

### 11.5 P4 — Badge frontend ✅

Implémenté le 2026-07-09.

| Élément | Détail |
|---------|--------|
| Helper `subMarketOutcomeKnownBadge()` | Badge jaune `warn` — `winningTokenId` set + `!resolved` |
| Helper `redemptionProgressBadge()` | Badge bleu `accent` — phase `awaiting_redemption` |
| Affichage | `PositionOpenRowMeta.tsx` (lignes Ouvertes + En attente) |
| Tooltips | `position-tooltips.ts` — `subMarketOutcomeKnown`, `redemptionInProgress` |
| Tests | 6/6 passent — `packages/frontend/src/lib/redemption-wait.test.ts` |

### 11.6 P5 — Monitoring ✅

Implémenté le 2026-07-09.

| Élément | Détail |
|---------|--------|
| `countStaleUnresolvedWinningTokenMarkets()` | `market-resolution-monitoring.ts` |
| Seuil | 24h (`UNRESOLVED_WINNING_TOKEN_STALE_MS`) |
| Intégration | `MarketResolutionWatcher.processAll()` — log warn si count > 0 |
| Tests | 2/2 passent — `market-resolution-monitoring.test.ts` |

### 11.7 Fichiers modifiés (PR1 + PR2)

| Fichier | Modifications |
|---------|---------------|
| `packages/core/src/positions/redemption-wait.ts` | P1 (3 fonctions) + P2 (invariant) + P0 (extension `shouldSuppressSlTp`) |
| `packages/core/src/market/lifecycle.ts` | P3 (JSDoc `isMarketOutcomeKnown`) |
| `packages/core/src/positions/redemption-wait.test.ts` | Tests P1 + P0 |
| `packages/frontend/src/lib/redemption-wait.ts` | P4 — helpers badge |
| `packages/frontend/src/lib/redemption-wait.test.ts` | P4 — 6 tests |
| `packages/frontend/src/lib/position-tooltips.ts` | P4 — tooltips |
| `packages/frontend/src/lib/position.ts` | P4 — exports |
| `packages/frontend/src/components/position/PositionOpenRowMeta.tsx` | P4 — affichage badges |
| `packages/worker/src/processors/market-resolution-monitoring.ts` | P5 — requête count |
| `packages/worker/src/processors/market-resolution-monitoring.test.ts` | P5 — 2 tests |
| `packages/worker/src/processors/market-resolution-watcher.ts` | P5 — log warn |

---

## 12. Questions ouvertes

- [x] Faut-il aussi corriger `isMarketOutcomeKnown()` ? **Non** — correct pour TIME_EXIT. JSDoc ajouté (P3) pour éviter la réutilisation incorrecte.
- [x] Le `ResultsConsumer.maybeRetryForcedExitClose()` doit-il continuer à retenter les forced exits même avec `winningTokenId` connu ? **Oui** — après P1, tant que `resolved = false`, le marché n'est pas en attente de rédemption.
- [x] Faut-il un mécanisme de logging pour détecter les marchés où `winningTokenId` est connu depuis longtemps sans résolution ? **Oui — P5 implémenté** (`countStaleUnresolvedWinningTokenMarkets`, log warn > 24h).
- [x] Les marchés "updown-5m" (crypto-algo) ont-ils un comportement différent ? Leur `endDate` est à +5 min, fenêtre morte courte. Le patch les affecte positivement sans risque.
- [x] Faut-il introduire une notion d'"event parent" pour grouper les sous-marchés ? **Non** — chaque sous-marché est autonome, le patch traite correctement son cycle de vie individuel.
- [x] Badge frontend "résultat connu" pour distinguer `winningTokenId` set de `resolved = true` ? **Oui — P4 implémenté** (badge jaune `warn` + badge bleu `accent`).
- [ ] Vérification en production : reconfirmer le comportement des positions #17294–#17379 après redémarrage du worker avec le correctif déployé.

---

## 13. Diagramme de flux corrigé (état ACTUEL après P1 + P0)

```
Sous-marché : résultat connu (token YES à 1.00, t = 0)
  │
  ├─ determineWinnerFromPrices() → winningTokenId persisté en BDD
  ├─ resolved = false, accepting_orders = true, endDate dans le futur
  │
  ├─ ÉTAT ACTUEL (P1 implémenté) :
  │   ├─ shouldSuppressSlTp = false ✅ → SL/TP actif
  │   ├─ isMarketAwaitingRedemptionExit = false ✅ → frontend affiche "Ouvertes"
  │   ├─ getRedemptionWaitPhase = null ✅ → pas de "rédemption en cours"
  │   ├─ TIME_EXIT actif tant que resolved=false ✅ (patch v1-4 deadlock)
  │   ├─ PRE_CLOSE normal (selon preCloseSeconds)
  │   │
  │   └─ [PÉRIODE DE PROTECTION] ── SL/TP peut déclencher une sortie CLOB ──
  │
  ├─ endDate atteinte, accepting_orders = true (fenêtre Polymarket)
  │   ├─ shouldSuppressSlTp = false ✅ (CLOB encore vivant)
  │   └─ isMarketAwaitingRedemptionExit = true → awaiting_resolution
  │
  ├─ endDate atteinte, accepting_orders = false (CLOB mort)
  │   ├─ shouldSuppressSlTp = true ✅ (P0 — évite boucles no_liquidity)
  │   └─ isMarketAwaitingRedemptionExit = true → awaiting_resolution
  │
  ├─ Résolution officielle (resolved = true)
  │   ├─ shouldSuppressSlTp = true ✅
  │   ├─ isMarketRedeemable = true
  │   ├─ MarketResolutionWatcher → pending_resolution → REDEMPTION
  │   └─ getRedemptionWaitPhase = 'awaiting_redemption' ✅
  │
  └─ Position fermée avec close_reason = 'SL' (pendant la fenêtre de protection)
     ou 'REDEMPTION' (après résolution officielle)
```

---

## 14. Glossaire

- **Event** : l'événement parent Polymarket (ex : "Spain vs Belgium"). Regroupe plusieurs marchés.
- **Market / sous-marché** : un `conditionId` Polymarket avec ses propres tokens YES/NO, `endDate`, `winningTokenId`, `resolved`.
- **Sous-token** : dans ce document, un token d'un sous-marché (ex : le token YES de "Spread: Belgium -4.5"). Par abus de langage, "sous-token" désigne aussi le sous-marché lui-même.
- **Token** : un actif ERC1155 tradable sur le CLOB Polymarket, identifié par `tokenId` (alias `assetId` côté position).
- **`winningTokenId`** : le tokenId dont le payoff sera 1 à la résolution. Polywatch le **déduit** du prix CLOB (seuil `>= 0.99`), pas d'un flag officiel.
- **`resolved`** : flag Polymarket officiel — le contrat est résolu par l'oracle (UMA).
- **`settled`** (Polywatch) : `resolved === true` OU (`closed === true` ET `acceptingOrders === false`).
- **`redeemable`** (Polywatch) : `settled && winningTokenId` — prérequis pour la rédemption on-chain.
- **Zone morte** : période entre "résultat du sous-token connu" et "résolution officielle" où la position n'était ni exitable ni redeemable **avec le code AVANT correctif**. **Corrigée par P1** — SL/TP reste actif tant que `resolved = false` et le CLOB accepte des ordres.

---

## 15. Références

- `packages/core/src/positions/redemption-wait.ts` — **modifié** : `shouldSuppressSlTp()`, `isMarketAwaitingRedemptionExit()`, `getRedemptionWaitPhase()`, invariant P2
- `packages/core/src/positions/redemption-wait.test.ts` — **modifié** : 22 tests (P1 + P0)
- `packages/core/src/market/lifecycle.ts` — **modifié** : JSDoc `isMarketOutcomeKnown()` (P3)
- `packages/core/src/market/lifecycle.ts` — `isMarketSettled()`, `isMarketRedeemable()`, `isMarketTerminal()`, `MarketLifecycleState`
- `packages/core/src/polymarket/market-metadata.ts` — `determineWinnerFromPrices()`, `WINNING_PRICE_THRESHOLD = 0.99`
- `packages/core/src/services/market.service.ts` — `persistMarket()` (persistance de `winningTokenId`)
- `packages/core/src/services/market-resolution.service.ts` — `processCondition()` (garde-fou `isMarketRedeemable`)
- `packages/worker/src/processors/redemption-handler.ts` — `RedemptionHandler.redeem()` (garde-fou on-chain)
- `packages/worker/src/processors/market-resolution-watcher.ts` — `MarketResolutionWatcher`
- `packages/worker/src/processors/results-consumer.ts` — `maybeRetryForcedExitClose()`
- `packages/worker/src/processors/strategy/position-exit-evaluator.ts` — `evaluateCloseLogic()` (consomme `shouldSuppressSlTp`)
- `packages/core/src/risk/exit-decision.ts` — `evaluatePositionExit()` (TIME_EXIT utilise `isMarketOutcomeKnown`)
- `docs/v1/v1-5/2026-07-08_patch_redemption_winning_token_premature.md` — patch détaillé
- `docs/v1/v1-4/2026-07-08_brainstorm2_audit_sl_tp_copy_trading.md` — extension P0 `shouldSuppressSlTp`
- `packages/frontend/src/lib/redemption-wait.ts` — **P4** badges `subMarketOutcomeKnownBadge`, `redemptionProgressBadge`
- `packages/frontend/src/lib/redemption-wait.test.ts` — **P4** 6 tests
- `packages/frontend/src/components/position/PositionOpenRowMeta.tsx` — **P4** affichage badges
- `packages/worker/src/processors/market-resolution-monitoring.ts` — **P5** `countStaleUnresolvedWinningTokenMarkets`
- `packages/worker/src/processors/market-resolution-watcher.ts` — **P5** log warn > 24h
- `docs/v1/v1-5/2026-07-09_plan_p4_p5_outcome_badge_monitoring.md` — plan P4/P5
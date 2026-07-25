# Audit — Marché fermé sur Polymarket, position coincée `open`

**Date** : 12 juin 2026  
**Dernière mise à jour** : 13 juin 2026 (correctifs appliqués)  
**Périmètre** : `packages/worker` (strategy-processing, connection-manager), `packages/core` (market lifecycle, entities), `packages/frontend` (affichage marché)  
**Contexte** : position sim #2927 affichant « ILLIQUIDE » bien que le marché expire dans 6 jours ; enquête API Polymarket + BDD  
**Méthode** : appel direct API CLOB (`/books/{assetId}`), lecture BDD `markets`, analyse lifecycle  
**Statut** : **corrigé le 13/06/2026** — MF-1, MF-2, MF-4, MF-5 implémentés ; MF-3 (UI) non vérifié

---

## 1. Synthèse exécutive

| Question | Réponse |
|---|---|
| Le carnet est-il vide ? | **Non** — il n'existe **plus** (HTTP 404 Polymarket CLOB) |
| Pourquoi 404 ? | Le marché est marqué **`closed=1`** sur Polymarket, pas seulement `acceptingOrders=false` |
| Le worker gère-t-il ce cas ? | **Oui (corrigé)** — `isMarketSettled` détecte `closed=1` ; force-close sur marché terminal |
| L'UI est-elle trompeuse ? | **Oui** — affiche « expire dans 6j 18h » sans mentionner que le marché est fermé (MF-3 non vérifié) |
| Le SL/TP joue-t-il un rôle ici ? | **Non** — la position #2927 a `slPercent=null, tpPercent=null` |

**Verdict** : décalage **données Polymarket ↔ logique worker**. Polymarket ferme des marchés avant leur `endDate` (report de match, suspension, etc.). Le worker ne détectait pas cette transition et laissait les positions coincées en `open` + `illiquid`. **Corrigé le 13/06/2026.**

---

## 2. Incident de référence (BDD + API)

### Position #2927 (swisstony, sim, `open`)

| Champ | Valeur |
|---|---|
| Marché | Libema Open (Doubles): Pavlasek/Rikl vs Bergs/Rinderknech |
| Outcome | Pavlasek/Rikl |
| `assetId` | `56647613151804794649819045388756900944490048735293304567794910173218751854242` |
| `entry_price` | 0.83 |
| `entry_bid_vwap` | 0.79 |
| `executable_bid_vwap` | **0** (dernier mark valide ~0.01 d'après `lastValidTriggerPnlPercent`) |
| `liquidityStatus` | **"illiquid"** |
| `slPercent` | **null** |
| `tpPercent` | **null** |

### Marché en base

| Champ | Valeur | Signification |
|---|---|---|
| `endDate` | 2026-06-19 08:00:00 | Match prévu dans 6 jours |
| `closed` | **1** | **Marché fermé par Polymarket** |
| `acceptingOrders` | **0** | Plus d'ordres acceptés |
| `resolved` | **0** | Résultat **pas encore connu** |

### Appel API Polymarket CLOB

```
GET https://clob.polymarket.com/books/{assetId}?side=all
→ HTTP 404 Not Found
```

Le carnet d'ordres n'existe **plus** sur le CLOB.

### Appel API Gamma

```
GET https://gamma-api.polymarket.com/events/{conditionId}
→ end_date: 2026-06-19, active: false, closed: true
```

---

## 3. Modèle de lifecycle Polymarket (état actuel)

```
active / acceptingOrders=true  →  marché ouvert, CLOB actif
        ↓
acceptingOrders=false, closed=false  →  marché en cours de fermeture (pre-close)
        ↓
closed=1, resolved=0  →  MARCHÉ FERMÉ, RÉSULTAT INCONNU  ← désormais géré
        ↓
resolved=1, winningTokenId  →  marché réglé, payoff connu
```

**Corrigé le 13/06/2026** : le worker distingue maintenant `closed=1, resolved=0` :

- `isMarketSettled` retourne `true` quand `closed=1 && acceptingOrders === false` (MF-1)
- `isMarketTerminal` : nouvelle fonction exportée (MF-4)
- `isMarketRedeemable` : nécessite un `winningTokenId` connu (distinction settled vs redeemable)
- `getPositionMarkPrice` : fallback sur dernier bid connu ou `entryPrice` pour marchés terminaux (MF-5)
- `evaluatePosition` : force-close des positions `open` sur marché terminal sans liquidité (MF-2)

**Fichiers modifiés**

- Lifecycle : `packages/core/src/market/lifecycle.ts` — `isMarketSettled`, `isMarketTerminal`, `isMarketRedeemable`
- Mark price : `packages/core/src/positions/mark.ts` — `getPositionMarkPrice`
- Évaluation : `packages/worker/src/processors/strategy-processing.ts` — `evaluatePosition`
- Tests : `packages/core/src/market/lifecycle.test.ts` — 5 nouveaux tests

---

## 4. Chaîne de traitement (après correctif)

```
StrategyProcessing (~100 ms)
  refreshMarketsNearEnd()
    → fetch lifecycle (acceptingOrders, closed, resolved)
  evaluatePosition()
    → getExecutablePrices() → 404 → bid=0 → "illiquid"
    → isMarketSettled() → true (closed=1, acceptingOrders=false)
    → isMarketTerminal() → true
    → force-close avec fallbackBid = pos.executableBidVwap ?? pos.entryPrice
    → emitCloseSignal(pos, 'KILL_SWITCH', fallbackBid)
```

### Constats par étape (après correctif)

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| **MF-1** | `closed=1` non détecté comme état terminal | 🔴 Haute | ✅ Corrigé — `isMarketSettled` détecte `closed=1` |
| **MF-2** | Position coincée `open` + `illiquid` | 🔴 Haute | ✅ Corrigé — force-close sur marché terminal |
| **MF-3** | UI affiche expiration sans état marché | 🟡 Moyenne | ⚠️ Non vérifié (frontend) |
| **MF-4** | `isMarketSettled` ignore `closed=1` | 🟡 Moyenne | ✅ Corrigé — fusionné avec MF-1 |
| **MF-5** | Pas de fallback mark price pour marché fermé | 🟡 Moyenne | ✅ Corrigé — `getPositionMarkPrice` gère les marchés terminaux |

---

## 5. Positions impactées (BDD)

| Critère | Compte |
|---|---|
| `status='open' AND closed=1 AND resolved=0` | **À vérifier** |
| `status='open' AND executableBidVwap=0 AND liquidityStatus='illiquid'` | Multiple (tennis doubles, marchés exotiques) |

Le script `scripts/audit-liquidity-check.mjs` peut identifier les positions avec marché `closed=1, resolved=0`.

---

## 6. Options de correctif (décision)

**Option retenue** : combinaison B + C :

1. **Détection** : `isMarketSettled` retourne `true` pour `closed=1 && acceptingOrders === false` (MF-1)
2. **Force-close** : positions `open` sur marché terminal → `emitCloseSignal` avec fallback bid (MF-2)
3. **Fallback mark** : `getPositionMarkPrice` utilise dernier bid connu ou `entryPrice` (MF-5)
4. **Distinction** : `isMarketRedeemable` ≠ `isMarketSettled` — seul le premier nécessite `winningTokenId`

---

## 7. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/core/src/market/lifecycle.ts` | `isMarketSettled` : `closed=1` détecté ; `isMarketTerminal` : nouvelle fonction ; `isMarketRedeemable` : nécessite `winningTokenId` |
| `packages/core/src/positions/mark.ts` | `getPositionMarkPrice` : fallback pour marchés terminaux sans winner |
| `packages/worker/src/processors/strategy-processing.ts` | `evaluatePosition` : force-close sur marché terminal illiquide |
| `packages/core/src/market/lifecycle.test.ts` | 5 nouveaux tests pour `isMarketTerminal` et cas `closed=1` |

---

## 8. Références code

| Sujet | Fichier |
|---|---|
| Lifecycle marché | `packages/core/src/market/lifecycle.ts` |
| Boucle stratégie | `packages/worker/src/processors/strategy-processing.ts` |
| Connexion CLOB | `packages/worker/src/polymarket/connection-manager.ts` |
| Entité Market | `packages/core/src/entities/Market.ts` |
| UI statut | `packages/frontend/src/lib/position.ts` |
| Script audit | `scripts/audit-liquidity-check.mjs` |

---

## 9. Historique

| Date | Action |
|---|---|
| 2026-06-12 | Incident #2927 signalé ; enquête API Polymarket + BDD |
| 2026-06-12 | Création audit marché fermé |
| 2026-06-13 | Implémentation MF-1, MF-2, MF-4, MF-5 ; mise à jour audit |

---

*Fin du document — `audits/AUDIT-MARCHE-FERME-CLOSED-2026-06-12.md`*

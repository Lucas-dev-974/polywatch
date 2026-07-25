# Rapport d'audit — P&L ouvert obsolète (simulation)

**Date** : 2026-06-16  
**Objet** : expliquer l'écart perçu entre le capital affiché, l'historique et le P&L des positions ouvertes ; documenter la cause racine et le correctif déployé.  
**Statut** : **Résolu** — une seule formule de P&L ouvert partagée entre hero, API positions, worker et persistance post-fill.  
**Audit lié** : [2026-06-16_audit_simulation_capital.md](./2026-06-16_audit_simulation_capital.md) (drift cash / equity — problème distinct, déjà corrigé).

---

## 1. Symptôme remonté

Configuration de référence : capital initial **50 pUSD**, historique fermé environ **+31 pUSD**, positions ouvertes affichées autour de **−20 pUSD**, capital perçu autour de **~57 pUSD**.

Calcul mental attendu :

```
50 + 31 − 20 ≈ 61 pUSD
```

Le grand chiffre (equity) affiché ne correspondait pas à cette somme, donnant l'impression d'une erreur de comptabilité.

---

## 2. Constat après analyse BDD (2026-06-16)

Interrogation PostgreSQL (`polywatch`) + `tools/verify-sim-cash.ts`.

| Métrique | Valeur observée |
|---|---|
| `baseline_capital` | 50 pUSD |
| Cash (`simulation_balances.amount`) | ~29,5 pUSD |
| Valeur positions (mark) | ~49,8 pUSD |
| **Equity réelle** (`cash + positions`) | **~79,3 pUSD** |
| Historique (`Σ realized_pnl` fermées) | **+32,7 pUSD** |
| P&L ouvert **recalculé** (hero / mark) | **~−2,9 pUSD** |
| P&L ouvert **stocké** (`Σ unrealized_pnl` BDD) | **~−24,2 pUSD** |
| Drift cash vs ledger exécutions | **0 pUSD** ✓ |

### 2.1 Formule qui « tombe juste » vs formule fausse

| Méthode | Résultat |
|---|---|
| `equity = cash + positionsValue` | **~79,3 pUSD** ✓ |
| `50 + Historique + Pos. ouv. recalculé` | **~79,8 pUSD** (écart ~0,5 pUSD, acceptable) |
| `50 + Historique + Pos. ouv. stocké BDD` | **~58,5 pUSD** ← proche du **~57** perçu |

**Verdict initial** : la comptabilité patrimoniale (cash + equity) est correcte. L'écart utilisateur vient d'un **P&L ouvert affiché ou agrégé à partir de valeurs BDD périmées**, pas d'une erreur sur le capital total.

---

## 3. Cause racine

### 3.1 Deux chemins de calcul divergents

| Zone UI / backend | Source du P&L ouvert |
|---|---|
| Bandeau Simulation (`SimHero` → `getSnapshot()`) | Recalcul live : `mark × qty − entry × qty − fees` |
| Tableau Positions / footer P&L | `copied_positions.unrealized_pnl` persisté, ou tick WS `pnl_tick` |
| Agrégation manuelle utilisateur | Somme des lignes du tableau → valeurs stockées |

Le hero et l'equity utilisaient la bonne formule. Le tableau et les totaux REST s'appuyaient souvent sur `unrealized_pnl` **non resynchronisé**.

### 3.2 Mécanismes qui figeaient `unrealized_pnl`

| # | Mécanisme | Fichier(s) | Effet |
|---|---|---|---|
| M1 | **Fill BUY / COPY_INCREASE** met à jour `entry_price`, `quantity`, `entry_fees_remaining` mais **ne recalcule pas** `unrealized_pnl` | `execution.service.ts` | P&L latent reste celui d'avant le changement d'entrée |
| M2 | **Carnet illiquide** : le worker met à jour `liquidityStatus` uniquement, **sans** resync P&L | `strategy-processing.ts` | P&L figé au dernier mark liquide (souvent très négatif après une chute) |
| M3 | **`evaluateAll()`** ne traitait que `status = 'open'` | `strategy-processing.ts` | Positions `closing`, `pending_resolution`, `failed` jamais rafraîchies |
| M4 | **API REST positions** renvoyait `unrealized_pnl` brut | `copied-position-presenter.ts` | Poll 60 s et chargement initial servaient des valeurs obsolètes |
| M5 | **Frontend** chargeait `status=pending` (inexistant) au lieu de `pending_resolution` | `PositionCard.tsx` | Positions en attente de résolution absentes ou mal synchronisées |

### 3.3 Exemple concret (BDD)

Positions #5952 et #6022 au moment de l'audit :

| Position | `unrealized_pnl` stocké | P&L recalculé (mark + entrée actuelle) | Écart |
|---|---|---|---|
| #5952 | −6,10 | −0,27 | −5,83 |
| #6022 | −6,11 | −0,28 | −5,82 |

**Écart cumulé sur ~32 positions ouvertes** : ~**21 pUSD** de P&L ouvert trop pessimiste en base.

---

## 4. Ce qui n'était *pas* le problème

Pour éviter toute confusion avec l'audit capital du même jour :

- Le **cash** est cohérent avec le replay des exécutions (`ensureCashIntegrity`, drift = 0).
- L'**equity** (`cash + valeur mark des positions`) est la bonne définition du capital affiché.
- La formule `50 + Historique + Pos. ouv.` n'est valide **que si** « Pos. ouv. » est recalculé au mark courant — pas si l'on somme les `unrealized_pnl` stockés.

---

## 5. Correctif déployé (2026-06-16)

Principe : **une seule fonction de vérité** pour le P&L ouvert latent, réutilisée partout.

### 5.1 Helper partagé

**Fichier** : `packages/core/src/positions/mark.ts`

- `OPEN_LIKE_POSITION_STATUSES` : `open`, `closing`, `pending_resolution`, `failed`
- `isOpenLikePositionStatus(status)`
- `computePositionUnrealizedPnl(position, market?, bookBid?)`  
  → `unrealizedPnl(getPositionMarkPrice(...), entryPrice, quantity, entryFeesRemaining)`

Exporté via `@polywatch/core` (`export * from './positions/mark.js'`).

### 5.2 Resync après chaque fill

**Fichier** : `packages/core/src/services/execution.service.ts`

- `syncPersistedUnrealizedPnl(pos)` appelé à la fin de `finalize()` (BUY, increase, vente partielle).
- Remet `unrealized_pnl` en phase avec l'entrée courante et le mark persisté (`executable_bid_vwap`), sans toucher au cash.

### 5.3 API positions (REST)

**Fichier** : `packages/core/src/services/copied-position-presenter.ts`

- Pour les statuts open-like : `unrealizedPnl` **écrasé** dans la réponse enrichie par `computePositionUnrealizedPnl` (avec lifecycle marché depuis `MarketService.loadByConditionIds`).
- Le tableau Positions et son footer P&L reflètent la même logique que le hero, même au chargement REST.

### 5.4 Worker — évaluation élargie et resync illiquide

**Fichier** : `packages/worker/src/processors/strategy-processing.ts`

| Changement | Détail |
|---|---|
| Périmètre `evaluateAll()` | Tous les statuts `OPEN_LIKE_POSITION_STATUSES` |
| Carnet illiquide | Resync `unrealized_pnl` via mark persisté **sans** écraser `executable_bid_vwap` |
| SL/TP / trailing | Uniquement si `pos.status === 'open'` (évite double close sur `closing`) |

### 5.5 Frontend

**Fichier** : `packages/frontend/src/components/PositionCard.tsx`

- Requête ouvertes : `open,closing,pending_resolution` (correction de `pending` → `pending_resolution`).

### 5.6 Refactor mineur

**Fichier** : `packages/core/src/services/simulation.service.ts`

- `getSnapshot().openPnlSum` utilise `computePositionUnrealizedPnl` et `OPEN_LIKE_POSITION_STATUSES` (pas de changement de comportement, code unifié).

---

## 6. Tests ajoutés / exécutés

| Test | Fichier | Couverture |
|---|---|---|
| `computePositionUnrealizedPnl` | `packages/core/src/positions/mark.test.ts` | Formule mark + entrée + fees |
| Resync après `COPY_INCREASE` | `packages/core/src/services/execution.service.test.ts` | `unrealized_pnl` passe de −6 (obsolète) à ~+0,6 après fill |
| Suite existante execution / accounting | inchangée | Pas de régression cash |

Commandes :

```bash
npm run build -w packages/core
npm run build -w packages/worker
npm test -w packages/core -- src/positions/mark.test.ts src/services/execution.service.test.ts
```

Résultat au patch : **9 tests passés**, builds `core` et `worker` OK.

---

## 7. Comportement attendu après patch

| Scénario | Avant | Après |
|---|---|---|
| Hero « Pos. ouv. » vs footer Positions | Écart jusqu'à ~21 pUSD | Alignés (même formule) |
| Fill COPY_INCREASE sans tick worker immédiat | P&L latent figé | Resync en BDD dans `finalize()` |
| Position en `pending_resolution` | Non réévaluée | Incluse dans `evaluateAll()` |
| Carnet illiquide après changement d'entrée | P&L figé à l'ancienne entrée | Resync P&L sur mark persisté |
| Calcul mental `50 + Hist. + Pos. ouv.` | ~58 (stocké) vs ~79 (equity) | ~79 des deux côtés si Pos. ouv. lu depuis UI/API patchée |

**Note** : l'equity affichée reste `cash + positionsValue`, pas une somme arithmétique des trois lignes du bandeau — mais les trois composantes P&L (Pos. ouv., Historique, session) deviennent cohérentes entre elles.

---

## 8. Risques évités dans le patch

| Risque | Mitigation |
|---|---|
| Double vente sur positions `closing` | Close eval limité à `status === 'open'` |
| Écraser un bon mark bid par un bid illiquide | Carnet illiquide : resync P&L seulement, pas de mise à jour `executable_bid_vwap` |
| Régression comptabilité cash | Aucune modification de `adjustCash` / `replaySimCashDelta` |
| Sur-ingénierie | Pas de nouvelle table ; helper pur + points d'accroche existants |

---

## 9. Surveillance recommandée

```bash
npx tsx tools/verify-sim-cash.ts
```

Contrôler périodiquement :

- `écart equity vs P&L` ≤ ~0,5 pUSD (mark lifecycle / arrondis)
- Somme `unrealized_pnl` BDD ≈ `openPnlSum` hero après quelques cycles worker

En cas de réapparition d'un écart important : vérifier que le worker tourne et que les positions concernées ne sont pas bloquées hors statuts open-like.

---

## 10. Conclusion

- **Problème** : désalignement d'affichage — P&L ouvert stocké (~−24 pUSD) vs recalculé (~−3 pUSD), provoquant une fausse impression d'erreur sur le capital (~57 vs ~79 pUSD).
- **Cause** : `unrealized_pnl` persisté sans resync après fills, carnet illiquide, périmètre worker trop étroit, API REST brute.
- **Patch** : `computePositionUnrealizedPnl` partagé ; resync post-fill, presenter, worker élargi, fix statut frontend.
- **Comptabilité** : inchangée et déjà validée par l'audit capital du même jour.

---

*Audit rédigé le 2026-06-16. Correctif implémenté dans la même session (~19:45 UTC+2).*

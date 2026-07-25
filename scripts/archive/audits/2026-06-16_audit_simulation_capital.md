# Rapport d'audit — Capital simulation Polywatch

**Date initiale** : 2026-06-16 (~11:50 UTC+2)  
**Dernière mise à jour** : 2026-06-16 (~13:00 UTC+2) — correctifs implémentés et validés en BDD  
**Objet** : vérifier le calcul du capital en mode simulation et expliquer pourquoi le cash affiché ne correspond pas aux flux d'exécution.  
**Statut** : **Résolu** — drift cash = 0, equity alignée sur P&L (voir §8).

---

## 1. Données de référence (état au moment de l'audit initial)

Source : base PostgreSQL locale `polywatch`, lue le 2026-06-16 à ~11:50 UTC+2.

| Élément | Valeur |
|---|---|
| Capital initial configuré (`risk_config.sim_initial_capital`) | **50 pUSD** |
| Cash simulation (`simulation_balances.amount`) | **0.58609 pUSD** |
| Nombre total de positions sim | 86 |
| Positions ouvertes | 24 |
| Positions fermées | 52 |
| Positions annulées | 10 |
| Exécutions `filled` / `partial` sim | 244 |
| Exécutions orphelines (sans position) | 0 |

## 2. Recalcul indépendant des métriques (audit initial)

### 2.1 P&L stocké en BDD

| Métrique | Valeur recalculée depuis `copied_positions` |
|---|---|
| `openPnlSum` (positions ouvertes) | **+1.17826 pUSD** |
| `closedPnlSum` (positions fermées) | **−8.54850 pUSD** |
| **P&L total** | **−7.37024 pUSD** |

### 2.2 Valeur des positions ouvertes

La formule utilisée par le backend est :

```typescript
export function sumOpenPositionsValue(
  positions: MarkablePosition[],
  markets?: Map<string, MarketLifecycleState>,
): number {
  return positions.reduce((total, position) => {
    const market = markets?.get(position.conditionId);
    const mark = getPositionMarkPrice(position, 0, market ?? null);
    return total + position.quantity * mark;
  }, 0);
}
```

Avec `bookBid = 0`, le mark price tombe sur `executable_bid_vwap`.

Recalcul : **positionsValue = 48.13677 pUSD**.

### 2.3 Equity affiché

`equity = cash + positionsValue = 0.58609 + 48.13677 = **48.72286 pUSD**`.

## 3. Écart n°1 — P&L total vs equity (audit initial)

| Méthode | Equity |
|---|---|
| `cash + positionsValue` | **48.72 pUSD** |
| `capital_initial + openPnlSum + closedPnlSum` | 50 + 1.17826 − 8.54850 = **42.63 pUSD** |
| **Écart** | **+6.09 pUSD** |

Les champs `realized_pnl` / `unrealized_pnl` stockés ne reflétaient pas exactement la variation de `cash + valeur des positions`. Cet écart venait surtout de l'utilisation de `unrealized_pnl` obsolète en BDD au lieu d'un recalcul au mark price courant dans `getSnapshot()`.

## 4. Écart n°2 — Cash théorique vs cash BDD (audit initial)

Recalcul du cash à partir des 244 exécutions `filled` / `partial` sim :

| Flux | Montant |
|---|---|
| Débits achats (`BUY` : `fill_price * fill_quantity + fees`) | **193.77 pUSD** |
| Crédits ventes (`SELL` : `fill_price * fill_quantity - fees`) | **137.04 pUSD** |
| Cash attendu depuis 50 pUSD | 50 − 193.77 + 137.04 = **−6.73 pUSD** |
| Cash réel en BDD | **+0.59 pUSD** |
| **Écart** | **+7.32 pUSD** |

**Anomalie principale identifiée à l'époque.** Le solde cash était supérieur de 7.32 pUSD à ce que les exécutions indiquaient.

## 5. Causes confirmées (investigation post-audit)

Analyse approfondie du code et de la BDD — causes réelles retenues :

| # | Cause | Gravité | Confirmée |
|---|---|---|---|
| C1 | **Double vente TRAILING** sur la même position (ex. `#5894` : 2 SELL filled en 270 ms, même quantité) — le chemin `beginClose` « resumed » laissait passer un 2ᵉ signal avec le même `closingAttemptSeq` | Critique | Oui |
| C2 | **Absence de `baseline_capital`** — le replay utilisait `sim_initial_capital` sans capital de référence stocké au reset ; impossible de réconcilier proprement | Haute | Oui |
| C3 | **`openPnlSum` stale** — somme des `unrealized_pnl` persistés ≠ mark price utilisé pour `positionsValue` | Moyenne | Oui |
| C4 | Reset sans baseline, idempotence partielle sur `finalize` | Moyenne | Partiellement |
| C5 | Réservations non libérées impactant le cash | — | **Non** (réservations n'affectent pas `simulation_balances`) |

## 6. Conclusion initiale (avant correctifs)

- Le P&L affiché (open / closed) était cohérent avec les formules du code prises isolément.
- Le capital affiché (`equity`) était correct étant donné le cash et la valeur des positions ouvertes.
- **Le cash n'était pas cohérent avec les flux d'exécution** : écart de **+7.32 pUSD**.
- Causes opérationnelles probables : double finalisation de vente, baseline absent, affichage P&L ouvert désaligné.

---

## 7. Correctifs implémentés (2026-06-16)

### 7.1 Prévention

| Correctif | Fichier(s) |
|---|---|
| Blocage d'un 2ᵉ `claim` SELL tant qu'une vente `placing`/`partial` existe sur la position | `packages/core/src/services/execution.service.ts` |
| Idempotence renforcée : retour anticipé si exec déjà `filled` / `failed` / `cancelled` | `execution.service.ts` |
| Ventes plafonnées à `pos.quantity` ; achats refusés si état position invalide | `execution.service.ts` |
| Delta incrémental CLOB (`size_matched − déjà fillé`) au lieu du cumul brut | `packages/worker/src/clob/ws-user-events.ts`, `startup-reconciler.ts` |

### 7.2 Comptabilité et réconciliation

| Correctif | Fichier(s) |
|---|---|
| Colonne **`baseline_capital`** sur `simulation_balances` (fixée au reset) | `SimulationBalance.ts`, migration |
| **`replaySimCashDelta()`** — rejoue le ledger ; ignore les ventes excédentaires | `packages/core/src/simulation/accounting.ts` |
| **`ensureCashIntegrity()`** — `cash = baseline + replay(exécutions)` ; corrige si drift > 0,01 pUSD | `packages/core/src/services/simulation.service.ts` |
| Appel automatique au **démarrage du worker** | `packages/worker/src/index.ts` |
| **`openPnlSum`** recalculé au mark price dans `getSnapshot()` | `simulation.service.ts` |
| Seed initial aligné sur `simInitialCapital` | `packages/core/src/seed/defaults.ts` |

### 7.3 Tests et outil de vérification

| Élément | Fichier |
|---|---|
| Tests idempotence, double claim, réconciliation | `packages/core/src/services/execution.service.test.ts` |
| Tests replay ledger | `packages/core/src/simulation/accounting.test.ts` |
| Script de contrôle BDD | `tools/verify-sim-cash.ts` |

### 7.4 Recommandations initiales — statut

| Recommandation (§7 initial) | Statut |
|---|---|
| Tracer les resets | **Partiel** — `baseline_capital` + `updated_at` ; pas d'historique dédié |
| Sécuriser `adjustCash` | **Fait** — garde-fous `claim`/`finalize` + réconciliation |
| Contrôle de cohérence périodique | **Fait** — `ensureCashIntegrity()` au boot worker + `tools/verify-sim-cash.ts` |
| Auditer les exécutions récentes | **Fait** — cause C1 identifiée sur position `#5894` |

---

## 8. Validation post-correctifs

**Méthode** : interrogation directe PostgreSQL + `tools/verify-sim-cash.ts`  
**Date** : 2026-06-16 ~13:00 UTC+2

### 8.1 Cohérence cash

| Métrique | Valeur | Seuil | Résultat |
|---|---|---|---|
| `sim_initial_capital` | 50 pUSD | — | OK |
| `baseline_capital` (DB) | 50 pUSD | = capital config | OK |
| Cash stocké | **13.6271 pUSD** | — | — |
| Cash attendu (baseline + replay) | **13.6271 pUSD** | — | OK |
| **Drift** | **0.0000 pUSD** | ≤ 0,01 pUSD | **OK** |

### 8.2 Cohérence equity / P&L

| Métrique | Valeur |
|---|---|
| Valeur positions ouvertes | 51.8120 pUSD |
| Equity (`cash + positions`) | **65.4391 pUSD** |
| Open P&L (recalculé mark) | −1.0360 pUSD |
| Closed P&L | +16.4751 pUSD |
| `baseline + openPnl + closedPnl` | **65.4391 pUSD** |
| **Écart equity vs P&L** | **0.0000 pUSD** |

L'écart n°1 de l'audit initial (+6.09 pUSD) est **corrigé** par le recalcul de `openPnlSum` au snapshot.

### 8.3 Portefeuille sim courant

| Élément | Valeur |
|---|---|
| Positions ouvertes | 20 |
| Positions fermées | 24 |
| Exécutions filled/partial | 150 (126 BUY, 24 SELL) |
| Exécutions failed (sans impact cash) | 34 |

> **Note** : l'historique diffère de l'audit initial (244 exécutions / 86 positions) — session sim ultérieure ou activité continue après mise en place des correctifs. Les métriques de validation portent sur l'état **courant** de la BDD.

### 8.4 Verdict

| Contrôle | Statut |
|---|---|
| Cash = baseline + replay(exécutions) | **Validé** |
| Equity = baseline + openPnl + closedPnl | **Validé** |
| Double vente bloquée à la source | **Validé** (tests + garde-fous) |
| Réconciliation au démarrage worker | **En place** |

**Commande de re-vérification** :

```bash
npx tsx tools/verify-sim-cash.ts
```

Sortie attendue : `✓ Cash cohérent avec le ledger (écart ≤ 0,01 pUSD).`

---

## 9. Conclusion finale

- Les anomalies de l'audit initial (drift cash **+7.32 pUSD**, écart equity/P&L **+6.09 pUSD**) ont des causes identifiées et des correctifs déployés.
- L'état actuel de la BDD est **cohérent** : drift cash **0 pUSD**, écart equity/P&L **0 pUSD**.
- Aucun refactor global n'est requis ; surveillance via `verify-sim-cash.ts` et logs worker (`simulation cash reconciled`) suffisent.

---

*Audit initial : lecture seule. Sections 7–9 : correctifs et validation post-patch (2026-06-16).*

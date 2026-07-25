# Audit — Alignement Sim / Live

**Date** : 11 juin 2026  
**Dernière mise à jour** : 11 juin 2026 — correctifs ASL-1 à ASL-6 implémentés  
**Périmètre** : `packages/core`, `packages/worker`, `packages/backend`  
**Objectif** : vérifier si la pipeline **simulation** reproduit fidèlement la pipeline **live**, à l’exception de l’exécution des ordres (moteur sim vs CLOB).  
**Méthode** : lecture des sources (`src/` uniquement), analyse croisée des pipelines et des branches `mode === 'sim' | 'real'`.

---

## 1. Synthèse exécutive

**Verdict** : sim et live **partagent la même architecture de pipeline**. Ce n’est pas deux systèmes parallèles, mais **un seul worker** avec des branches sur la même chaîne de traitement.

| Aspect | Aligné ? |
|--------|----------|
| Graphe pipeline (queues, processeurs, statuts) | ✅ Oui |
| Décision copy (move-events → order-signals) | ✅ Oui |
| Stratégie de sortie (SL/TP/trailing/pre-close/kill switch) | ✅ Oui |
| Résolution marché → `pending_resolution` | ✅ Oui |
| Watchdogs (`closing`, réservations, placing sim) | ✅ Oui |
| Exécution des ordres | ⚠️ Partiel — FAK simulé contre le book (tick, min size, partiels, rejets) ; latence non modélisée |
| Source de cash pour le sizing | ❌ Non (ledger sim vs pUSD réel) — intentionnel |
| Comptabilité post-fill | ❌ Non (`adjustCash` sim uniquement) — intentionnel |
| Infra de suivi exécution | ❌ Non (WS user + réconciliation live) — intentionnel |
| Rachat post-résolution | ❌ Non (fill synthétique vs relayer on-chain) — intentionnel |

**Modèle mental correct** :

> Sim = même pipeline que live pour la décision et les transitions d’état ; seuls changent l’exécution, la source de cash, la comptabilité et l’infra de suivi live.

**État post-correctifs** : les 6 problèmes opérationnels identifiés (ASL-1 à ASL-6) ont été corrigés. ASL-4 a depuis été **implémenté** : la sim reproduit désormais la sémantique FAK du live (tick size, taille minimale, fills partiels limités à la profondeur du book, rejets `order_not_matched`). Seule la latence réseau reste non modélisée (fill instantané sur le snapshot courant du book).

---

## 2. Architecture commune

### 2.1 Graphe pipeline (identique sim / live)

```
MoveDetector
  → move-events (Redis)
  → CopyProcessor
      → order-signals (entrées / sorties copy)
      → close-signals (SL/TP/trailing/pre-close/kill switch / manuel)
  → Executor A / Executor B
      → execution-results (Redis)
  → ResultsConsumer → ExecutionService.finalize()
  → POST backend / WebSocket UI

MarketResolutionWatcher (30 s)
  → pending_resolution
  → RedemptionHandler (15 s)
      → execution-results

ClosingWatchdog (15 s, seuil 3 min)
PlacingJanitor (60 s, exec sim placing orphelines)
ReservationJanitor (60 s, TTL réservation 180 s)
```

### 2.2 Cycle de vie des positions (identique)

```
pending ──fill──► open ──┬── SL/TP/… ──► closing ──► closed
   │                     │
   │                     └── marché résolu ──► pending_resolution ──► closed (REDEMPTION)
   │ (réservation expirée / échec entrée)
   ▼
cancelled / failed
```

Statuts : `packages/core/src/types/index.ts` (`CopiedPositionStatus`).

### 2.3 Point de branchement central

Le routage exécution se trouve dans l’Executor :

```typescript
// packages/worker/src/processors/executor.ts — resolveExecution()
if (signal.mode === 'sim') {
  return this.simulateFill(signal);
}
if (!risk.realTradingEnabled) {
  return this.failedResult(signal, 'real_trading_disabled');
}
return this.realExecutor.execute(signal, this.connectionManager);
```

Le `CopyProcessor` traite sim et real **dans la même boucle** ; seul le champ `mode` sur le signal diffère.

---

## 3. Divergences intentionnelles (par zone)

### 3.1 Exécution des ordres

| | Sim | Live |
|---|-----|------|
| Moteur | `simulateFill()` — matching FAK contre le book (tick, min size, partiels) | `RealExecutor` — CLOB FAK + parse fill |
| Latence | Instantané (snapshot du book) | Réseau + matching CLOB |
| Fills partiels | Oui (FAK simulé, profondeur au prix limite) | Oui (FAK) |
| Rejets CLOB | Oui (`tick_size_fetch_failed`, `price_rounded_to_zero`, `below_min_order_size`, `order_not_matched`) | Oui |
| Canal complémentaire | Aucun | WS user Polymarket + réconciliation REST |

**Limite résiduelle (ASL-4)** : seule la latence réseau n’est pas modélisée — le FAK simulé matche le snapshot courant du book, alors qu’un ordre live est en concurrence avec d’autres takers pendant le round-trip.

**Fichiers** : `packages/worker/src/processors/executor.ts`, `packages/worker/src/clob/real-executor.ts`

### 3.2 Sizing et paramètres de risque

Même code, **configurations séparées** via `packages/core/src/risk/policy.ts` :

| Paramètre | Sim | Live |
|-----------|-----|------|
| Mode sizing | `simSizingMode`, `simCopyRatio`, … | `realSizingMode`, `realCopyRatio`, … |
| SL/TP/trailing | `simSlPercent`, … | `realSlPercent`, … |
| Limites | `simMaxOpenPositions`, … | `realMaxOpenPositions`, … |
| Tags marché | `simAllowedMarketTags` | `realAllowedMarketTags` |

**Source de cash pour le sizing** :

- **Sim** : `SimulationBalance` (`resolveSimEntryBalances`)
- **Live** : solde pUSD réel (`fetchRealPusdBalance`, cache 10 s)

**Fichiers** : `packages/core/src/sizing/entry-sizing.ts`, `packages/worker/src/processors/copy-processor.ts`

### 3.3 Comptabilité post-fill

Dans `ExecutionService.finalize()` :

- **Sim** : `simulationService.adjustCash()` à chaque fill (débit achat / crédit vente)
- **Live** : pas de mouvement cash local — l’état on-chain fait foi

**Fichier** : `packages/core/src/services/execution.service.ts`

### 3.4 Rachat post-résolution

| | Sim | Live |
|---|-----|------|
| Mécanisme | Fill synthétique immédiat (`payoffPerShare` 0 ou 1) | Relayer on-chain via `POST /api/internal/redeem` |
| Échec possible | Non | Oui — enqueue `redemption_failed`, retry au poll suivant |

**Fichier** : `packages/worker/src/processors/redemption-handler.ts`

### 3.5 Infra live uniquement

| Composant | Rôle | Présent en sim ? |
|-----------|------|------------------|
| `UserChannelManager` | Fills temps réel via WS user | Non |
| `reconcilePlacingExecutions` | Rattrapage exec `placing` via REST CLOB | Non |
| `syncUserSubscriptions` | Abonnements WS par `conditionId` real | Non |
| `invalidateRealBalanceCache` | Refresh solde pUSD après fill | Non |

**Fichiers** : `packages/worker/src/clob/user-channel-manager.ts`, `packages/worker/src/clob/startup-reconciler.ts`, `packages/worker/src/polymarket/sync-user-subscriptions.ts`

### 3.6 Activation des modes

| Mode | Condition |
|------|-------------|
| Sim | `watchlist.simEnabled` |
| Live | `watchlist.realEnabled` **et** `risk.realTradingEnabled` |

---

## 4. Problèmes identifiés et correctifs

### ASL-1 — Fallback silencieux `real` → `simulateFill` ✅ Corrigé

**Fichier** : `packages/worker/src/processors/executor.ts` — `resolveExecution()`  
**Gravité initiale** : Critique

**Problème** : si `realTradingEnabled` était `false` avec un signal `mode: 'real'` en file, le signal était exécuté par le moteur de simulation mais finalisé comme position real.

**Correctif** : retour explicite `failed` avec erreur `real_trading_disabled` — jamais de simulation pour un signal real.

---

### ASL-2 — Rachat live bloqué après échec on-chain ✅ Corrigé

**Fichiers** :

- `packages/worker/src/processors/redemption-handler.ts`
- `packages/core/src/services/execution.service.ts` — `claimUnlessFilled()`

**Gravité initiale** : Haute

**Problème** : échec on-chain après `claim` → exec `placing` ou `failed` bloquait les retries.

**Correctif** :

1. `claimUnlessFilled` reprend les exec `placing` / `live_on_clob` et reset les exec `failed` de type `REDEMPTION` vers `placing`
2. `redeemOnChain` enqueue un résultat `failed` (`redemption_failed`) au lieu de retourner silencieusement
3. Vérification `winningOutcome` **avant** le `claim` (évite les exec `placing` orphelines)

---

### ASL-3 — Exécutions sim `placing` orphelines ✅ Corrigé

**Fichiers** :

- `packages/core/src/services/execution.service.ts` — `loadOrphanPlacingSim()`
- `packages/worker/src/watchdogs/placing-janitor.ts`

**Gravité initiale** : Moyenne

**Problème** : exec sim `placing` sans source de vérité externe, jamais nettoyées après annulation/échec de la position.

**Correctif** : `PlacingJanitor` (60 s) détecte les exec sim `placing` dont la position a quitté l’état attendu (`pending` pour BUY, `closing` pour SELL, `pending_resolution` pour REDEMPTION) et appelle `finalize({ status: 'failed', error: 'placing_orphan' })`.

**Extension (2026-07)** : détecte aussi les BUY `placing` encore sur position `pending` dont la réservation est absente, expirée ou âgée (`SIM_BUY_PLACING_STALE_MS` = 60 s) — ferme le trou où ni le janitor ni l’executor ne récupéraient avant le TTL réservation (180 s).

---

### ASL-4 — Simulation trop optimiste vs live ✅ Corrigé (sémantique FAK simulée)

**Fichiers** :

- `packages/core/src/pricing/vwap.ts` — `simulateFakFill()` (matching FAK pur, testé)
- `packages/worker/src/processors/executor.ts` — `simulateFill()` réécrit miroir de `RealExecutor.execute()`
- `packages/worker/src/polymarket/api-client.ts` — `fetchTickSize()` (endpoint public CLOB)
- `packages/worker/src/polymarket/connection-manager.ts` — `fetchBook()` (book complet)
- `packages/worker/src/clob/real-executor.ts` — `resolveTickSizeCached` exporté (cache partagé sim/live)

**Gravité initiale** : Moyenne — limite connue

**Problème** : la sim remplissait toujours intégralement au VWAP du book, sans tick size, taille minimale, fills partiels ni rejets CLOB — surestimation systématique du live sur marchés illiquides.

**Correctif** : `simulateFill()` reproduit désormais le pipeline live étape par étape :

1. Book + VWAP (même source que live), `no_liquidity` si vide
2. Garde de slippage identique (blocage entrées/TP, warn sur sorties forcées)
3. Tick size via l’endpoint public CLOB (cache partagé avec le live) — `tick_size_fetch_failed` en cas d’échec
4. Prix limite arrondi au tick — `price_rounded_to_zero`
5. Taille minimale (`MIN_ORDER_SHARES`) — `below_min_order_size`
6. **Matching FAK simulé** (`simulateFakFill`) : seuls les niveaux du book à prix égal ou meilleur que le prix limite sont consommés → fill partiel possible, `order_not_matched` si aucun niveau
7. Frais calculés sur la quantité réellement remplie

Les fills partiels sim empruntent le même chemin `finalize()` que les fills partiels live (moyenne pondérée, quantités delta).

**Limite résiduelle (volontaire)** : latence réseau non modélisée — le matching s’exécute sur le snapshot courant du book.

---

### ASL-5 — Retry close stratégie consomme le job sans retraiter ✅ Corrigé

**Fichiers** :

- `packages/core/src/orders/close-signal.ts` — `buildCloseOrderSignal()`
- `packages/worker/src/processors/executor.ts` — `beginClose(..., signal.closingAttemptSeq)`

**Gravité initiale** : Moyenne — sim et live

**Problème** : retry Redis d’un close SL/TP après `beginClose` échouait car `closingAttemptSeq` absent du signal.

**Correctif** : `closingAttemptSeq` toujours présent sur le signal (défaut `pos.closingAttemptSeq + 1`) ; l’executor le passe à `beginClose` pour reprendre une position déjà `closing`.

---

### ASL-6 — Fermeture manuelle UI sans rollback Redis ✅ Corrigé

**Fichier** : `packages/backend/src/routes/positions.ts`

**Gravité initiale** : Basse — sim et live

**Problème** : `POST /api/positions/:id/close` sans rollback si enqueue Redis échoue.

**Correctif** : try/catch + `markFailed(id)` aligné sur le pattern de `internal.ts` (`retry-close`).

---

## 5. Positions bloquées — matrice sim / live (post-correctifs)

| Scénario | Sim | Live | Auto-fix |
|----------|-----|------|----------|
| Réservation OK, enqueue Redis échoue | `pending` ~3 min → `cancelled` | Idem | Janitor |
| Crash entre `beginClose` et finalize | `closing` ~3 min → `failed` | Idem | ClosingWatchdog |
| Retry close stratégie après `beginClose` | Reprise via `closingAttemptSeq` | Idem | Immédiat |
| Exec `placing` orpheline | `finalize failed` (placing_orphan) | Réconciliation REST/WS | PlacingJanitor / reconcile |
| Rachat on-chain échoue post-claim | N/A | Retry au poll suivant | claimUnlessFilled + failed enqueue |
| Job en dead letter Redis | Manuel (replay) | Idem | Non |
| Signal `real` avec trading désactivé | N/A | `failed` (`real_trading_disabled`) | Immédiat |
| Close UI, Redis down | `failed` (rollback) | Idem | Immédiat |
| Marché illiquide (SL/TP/force-close skip) | Reste `open` | Idem | Non (volontaire) |

---

## 6. Tableau de couverture des watchdogs

| Statut / cible | Watchdog | Intervalle | Seuil | Sim | Live |
|----------------|----------|------------|-------|-----|------|
| `pending` | ReservationJanitor | 60 s | TTL 180 s | ✅ | ✅ |
| `closing` | ClosingWatchdog | 15 s | 3 min | ✅ | ✅ |
| Exec `placing` sim orpheline | PlacingJanitor | 60 s | état position incohérent | ✅ | — |
| `pending_resolution` | — | — | — | ❌ | ❌ |
| Exec `placing` (real) | reconcilePlacingExecutions | Startup + reconnect WS | — | — | ✅ |

---

## 7. Plan de correction — statut

| Priorité | ID | Action | Statut |
|----------|-----|--------|--------|
| 1 | ASL-1 | Rejeter explicitement les signaux `real` si `!realTradingEnabled` | ✅ Fait |
| 2 | ASL-2 | Débloquer redemption live après échec on-chain | ✅ Fait |
| 3 | ASL-5 | Reprise close stratégie sur retry (`closingAttemptSeq`) | ✅ Fait |
| 4 | ASL-3 | Janitor exec `placing` sim orphelines | ✅ Fait |
| 5 | ASL-6 | Rollback Redis sur `POST /positions/:id/close` | ✅ Fait |
| 6 | ASL-4 | Documenter la limite sim, puis modéliser FAK (tick, min size, partiels, rejets) | ✅ Fait |

---

## 8. Signaux de monitoring recommandés

- Positions par `(mode, status)` avec alerte si :
  - `closing` > 3 min
  - `pending` > 5 min
  - `pending_resolution` > 1 h
- Exécutions `placing` > N minutes (sim **et** real)
- Exécutions `failed` avec `error IN ('real_trading_disabled', 'redemption_failed', 'placing_orphan')`
- Taille des dead letters (`*:dead`) par queue
- État WS user (`reconnect exhausted`)
- Positions `failed` non retryées

---

## 9. Références code

| Fichier | Rôle |
|---------|------|
| `packages/worker/src/processors/copy-processor.ts` | Entrées/sorties copy, réservation |
| `packages/worker/src/processors/executor.ts` | Branchement sim/real, `simulateFill`, `resolveExecution` |
| `packages/worker/src/clob/real-executor.ts` | Exécution CLOB live |
| `packages/core/src/services/execution.service.ts` | `claim`, `claimUnlessFilled`, `finalize`, `loadOrphanPlacingSim` |
| `packages/core/src/services/reservation.service.ts` | Réservation, janitor, exposition |
| `packages/core/src/risk/policy.ts` | Paramètres sim/real séparés |
| `packages/core/src/sizing/entry-sizing.ts` | Résolution cash sim vs real |
| `packages/core/src/orders/close-signal.ts` | `buildCloseOrderSignal` avec `closingAttemptSeq` |
| `packages/worker/src/processors/redemption-handler.ts` | Rachat post-résolution |
| `packages/worker/src/clob/startup-reconciler.ts` | Réconciliation exec `placing` real |
| `packages/worker/src/clob/user-channel-manager.ts` | WS user + reconcile au reconnect |
| `packages/worker/src/watchdogs/closing-watchdog.ts` | Déblocage `closing` |
| `packages/worker/src/watchdogs/placing-janitor.ts` | Nettoyage exec `placing` sim orphelines |
| `packages/worker/src/watchdogs/reservation-janitor.ts` | Déblocage `pending` |
| `packages/backend/src/routes/positions.ts` | Close manuel UI (avec rollback Redis) |
| `packages/backend/src/routes/internal.ts` | `retry-close` avec rollback |
| `docs/pipeline-copy-trading.md` | Documentation pipeline bout-en-bout |

---

## 10. Conclusion

Sim et live **sont alignés sur la pipeline de décision et d’état**. L’intention « sim = live sauf exécution » est respectée au niveau architecture.

Les écarts restants sont **intentionnels** (cash, compta, infra WS, latence). Les 6 problèmes opérationnels identifiés à l’audit initial ont été corrigés sans modifier le graphe pipeline, et la sim modélise désormais la sémantique FAK du CLOB (tick size, taille minimale, fills partiels, rejets).

**Recommandation** : le trading live à taille significative peut être activé après revue des signaux de monitoring (section 8).

---

*Audit initial : 11/06/2026 — analyse uniquement.*  
*Correctifs ASL-1 à ASL-6 : 11/06/2026 — implémentés dans `packages/core`, `packages/worker`, `packages/backend`.*  
*ASL-4 (modélisation FAK en sim) : 11/06/2026 — `simulateFill` miroir de `RealExecutor` (tick size, min size, fills partiels, rejets).*

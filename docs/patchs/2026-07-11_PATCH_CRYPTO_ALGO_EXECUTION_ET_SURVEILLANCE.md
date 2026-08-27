# PATCH — Crypto-algo : exécution, file worker, surveillance

**Date :** 2026-07-11 → 2026-07-12  
**Version cible :** Polywatch v1.1  
**Statut :** ✅ Implémenté (correctifs code) — validation continue et phases 3–5 en attente

---

## 1. Contexte

### Symptôme utilisateur

Sur l’**Historique surveillance** (fenêtre 5m, ex. BTC/XRP/SOL 16:50→16:55), les positions algo apparaissent en **`pending`** ou **`cancelled`** avec **`@ 0.0000`**, donnant l’impression qu’aucune position n’a été prise.

### Clarifications métier

| Affichage UI | Signification réelle |
|--------------|---------------------|
| `NO` / `YES` | Direction du signal détectée — **pas** l’absence de trade |
| `pending @ 0.0000` | Réservation créée, ordre **non encore exécuté** |
| `cancelled @ 0.0000` | Tentative abandonnée **sans fill** |

### Audit BDD (fenêtre 10:50–10:55 AM ET / 16:50 locale)

- L’algo **détecte bien des signaux** (ex. BTC : NO cohérent avec Down 61,5¢ à l’ouverture ; marché résolu Down).
- **Multiples tentatives** par marché (7–8 lignes `cancelled` + 1 `pending`).
- **0 ligne `executions`** pour ces positions → le worker n’a jamais traité les ordres.
- **File Redis saturée** : `order-signals` ~377 entrées, `order-signals:processing` = 0.
- **Chaîne d’échec** : signal → réservation 3 min → enqueue Redis → worker ne consomme pas → expiration janitor → `cancelled`.

### Causes racines identifiées

#### Session antérieure (position #20583)

1. Exécution worker échoue (`CLOB book error: 404`).
2. `re_entry_limit` consommé à l’**enqueue** (pas au fill) → bloque toute la fenêtre.
3. Worker non abonné aux tokens algo DB (seulement grille Gamma).

#### Session 2026-07-11 (persistance « positions bloquées »)

4. **Backlog `order-signals`** — centaines de signaux `COPY_OPEN` morts (sim copy trading désactivé) bloquant les ordres algo sur l’ancienne file partagée.
5. **File `algo-order-signals` non consommée** — code déployé mais worker non redémarré, ou worker **jamais opérationnel** (voir §2.10).
6. **Inondation de doublons** — la stratégie ré-émet le même signal à chaque tick ; `resumeEntryFromReservation` ré-enfilait sans déduplication (~759 entrées pour ~47 signaux uniques).
7. **Sizing sim trop bas** — ordres `ALGO_OPEN` rejetés pour MOS sur marchés 5m à prix extrêmes.
8. **Worker bloqué au boot** — `await syncBookSubscriptions()` (centaines de carnets REST Up/Down) empêchait le démarrage des consommateurs Redis pendant plusieurs minutes.

---

## 2. Ce qui a été fait

### 2.1 Fix re-entry — compteur au fill confirmé

Le quota `re_entry_limit` ne se consomme plus à l’enqueue, mais après un **fill confirmé** (position `open`).

| Package | Fichiers |
|---------|----------|
| crypto-algo | `strategy/strategy-runner.ts`, `strategy/re-entry-throttle.ts`, `index.ts` |
| core | `redis/algo-reentry-fill.ts` |
| worker | `algo-reentry-fill.ts`, `processors/results-consumer.ts` |

**Canal Redis :** `algo-reentry-fill` (publié par le worker sur `ALGO_OPEN` filled).

**Tests :** `re-entry-throttle.test.ts` (7 tests OK).

---

### 2.2 Phase 1 — Sync worker sur sélections algo DB

Union des tokens **algo DB** + **grille Gamma** pour les abonnements carnet WS.

| Package | Fichiers |
|---------|----------|
| core | `services/algo-selection-book-assets.ts`, `services/index.ts` |
| worker | `polymarket/sync-book-subscriptions.ts` |

**Log attendu :** `algoSelectionAssetIds` dans les logs worker.

**Tests :** `algo-selection-book-assets.test.ts` (2 OK).

---

### 2.3 Phase 2 — Ensure book avant ALGO_OPEN

Retry REST CLOB 404 (500 ms / 1 s / 2 s) + subscribe WS avant exécution `ALGO_OPEN` BUY.

| Package | Fichiers |
|---------|----------|
| worker | `polymarket/ensure-book-ready.ts`, `processors/executor.ts` |

**Tests :** `ensure-book-ready.test.ts` (3 OK).

---

### 2.4 Fix rafale Gamma API au démarrage

Erreurs `fetchGammaMarketList failed` / `UND_ERR_CONNECT_TIMEOUT` lors du chargement massif des positions (non liées aux fixes CLOB).

| Changement | Détail |
|------------|--------|
| Skip fetch | `resolveMany` n’appelle Gamma que si métadonnées manquantes ou marché proche clôture (< 60 s) |
| Concurrence | Max **8** requêtes Gamma en parallèle |
| Timeout | Gamma porté à **30 s** |

| Package | Fichiers |
|---------|----------|
| core | `services/market.service.ts`, `polymarket/market-metadata.ts` |

**Tests :** `market.service.test.ts` (`needsGammaRefreshForResolve`, 10 tests OK).

---

### 2.5 Amélioration produit — raisons d’échec dans l’historique surveillance

Trois points pour informer l’utilisateur **pourquoi** une position n’a pas été exécutée.

#### A. `close_reason` en BDD

| Événement | `close_reason` |
|-----------|----------------|
| Janitor (réservation TTL expirée) | `reservation_expired` |
| Release pipeline (erreur après reserve) | `reservation_released` |

| Package | Fichiers |
|---------|----------|
| core | `positions/reservation-close-reasons.ts`, `services/reservation.service.ts` |

#### B. Enrichissement API positions surveillance

Nouveaux champs sur `AlgoSurveillancePositionSummary` :

- `closeReason`
- `executionErrorSim` / `executionErrorReal`
- `skipReason` (`pending_execution` si `pending` sans exécution)

Ré-enrichissement à la lecture des snapshots figés via `enrichAlgoSurveillancePositions()`.

| Package | Fichiers |
|---------|----------|
| core | `services/algo-surveillance.types.ts`, `services/algo-surveillance-positions.ts`, `services/algo-surveillance.service.ts` |

#### C. Affichage UI

Message orange sous chaque position dans **Historique surveillance** :

- *Non exécutée : réservation expirée (ordre non traité à temps)*
- *Non exécutée : en attente d'exécution (file worker)*
- *Exécution échouée : …* (ex. `placing_orphan`)

| Package | Fichiers |
|---------|----------|
| frontend | `components/SurveillanceHistoryCard.tsx`, `lib/algo-surveillance-positions.ts`, `lib/execution.ts`, `styles.css` |

**Tests :**

- `reservation.service.test.ts` (janitor + release `close_reason`)
- `algo-surveillance-positions.test.ts` (core)
- `algo-surveillance-positions.test.ts` (frontend)

**Limite :** les positions déjà `cancelled` **sans** `close_reason` en base n’affichent le libellé qu’à partir des **nouvelles** fenêtres post-déploiement.

---

### 2.6 Outils opérationnels (initiaux)

| Script | Rôle |
|--------|------|
| `tools/flush-redis-queues.ts` | Purge files worker (voir §2.7 pour `algo-order-signals`) |
| `tools/_audit-redis-queues.ts` | État des files Redis |
| `tools/_audit-window-1650*.ts` | Audit BDD fenêtre surveillance 16:50 |
| `tools/_audit-market-20583.ts` | Audit position algo bloquée (session antérieure) |

#### Procédure vider la file

```powershell
# 1. Arrêter le worker
# 2. Aperçu
npx tsx tools/flush-redis-queues.ts
# 3. Purge
npx tsx tools/flush-redis-queues.ts --confirm --release-reservations
# 4. Relancer npm run dev (backend + worker + crypto-algo + frontend)
# 5. Vérifier
npx tsx tools/_audit-redis-queues.ts
```

---

### 2.7 File dédiée `algo-order-signals`

Isolation des ordres algo de la file copy `order-signals` pour éviter le blocage par le backlog COPY.

| Package | Fichiers |
|---------|----------|
| core | `queue/worker-queues.ts` (`ALGO_ORDER_SIGNALS`) |
| crypto-algo | `index.ts` (enqueue sur `algo-order-signals`) |
| worker | `index.ts` (consommateur dédié + `recoverOrphans`) |
| tools | `flush-redis-queues.ts`, `_audit-redis-queues.ts` |

**File Redis :** `algo-order-signals` (+ `:processing`, `:dead`).

---

### 2.8 Garde réservation expirée dans l’executor

Fail-fast sur les BUY d’entrée (`COPY_OPEN`, `COPY_INCREASE`, `ALGO_OPEN`) si la réservation est absente ou past TTL (backlog stale).

| Package | Fichiers |
|---------|----------|
| worker | `processors/executor.ts` (`rejectExpiredEntryReservation`) |
| core | `services/reservation.service.ts` (`expiresAt` sur `ReserveResult`) |
| frontend | `lib/execution.ts` (libellé `reservation_expired`) |

**Tests :** `executor.test.ts` (suite « entry reservation guard »).

---

### 2.9 Migration sizing sim algo (MOS 5m)

Relevé du plancher sim pour permettre le bump au MOS marché sur fenêtres 5m.

| Migration | Effet |
|-----------|-------|
| `BumpSimAlgoEntrySizing1700000000053` | `sim_entry_usdc_amount` ≥ 10, `sim_max_position_size_usdc` ≥ 15 |

| Package | Fichiers |
|---------|----------|
| core | `migrations/BumpSimAlgoEntrySizing1700000000053.ts`, `database/data-source.ts` |

**Appliquer :** `npm run migrate`

---

### 2.10 Déduplication enqueue + boot worker non bloquant

Correctifs découverts lors du diagnostic « le problème persiste » (session 2026-07-11 soir).

#### A. Déduplication signaux Redis

La stratégie et le chemin `resumeEntryFromReservation` ré-enfilent le même `signalId` à chaque tick. Nouvelle méthode **`enqueueUnique()`** : marqueur Redis `SET NX` + TTL aligné sur l’expiration de la réservation → au plus **une copie** par signal dans la file.

| Package | Fichiers |
|---------|----------|
| core | `worker-shared/redis-queue.ts` (`enqueueUnique`) |
| core | `sizing/resume-reserved-entry.ts` |
| crypto-algo | `processors/algo-entry-pipeline.ts` |

**Tests :** `resume-reserved-entry.test.ts` (dont test `enqueueUnique`).

#### B. Démarrage worker sans blocage sync carnets

`syncBookSubscriptions()` au boot charge des centaines de carnets REST (404, timeouts) et **bloquait** l’atteinte de « Polywatch worker started » / des consommateurs Redis. Passage en **fire-and-forget** : les consommateurs démarrent immédiatement ; les carnets se chargent en arrière-plan et à la demande via `ensureBookReady`.

| Package | Fichiers |
|---------|----------|
| worker | `index.ts` (`void syncBookSubscriptions(...).then(...).catch(...)`) |

**Symptôme corrigé :** `algo-order-signals: 700+`, `processing: 0`, aucun client Redis `BRPOPLPUSH`.

---

### 2.11 Outils d’audit (session diagnostic)

| Script | Rôle |
|--------|------|
| `_audit-pending-algo.ts` | Positions pending + réservations (fix join `crypto_symbol`) |
| `_audit-sizing-config.ts` | Paramètres sizing sim + dernières migrations |
| `_audit-worker-throughput.ts` | Profondeur file, doublons, réservations expirées |
| `_audit-worker-liveness.ts` | Consommateurs Redis, delta file sur 8 s |
| `_audit-redis-clients.ts` | Liste clients Redis et commandes actives |
| `_audit-recent-outcomes.ts` | Exécutions algo récentes par statut/erreur |
| `_audit-algo-markets-ui.ts` | Règles auto-track + sélections enabled |
| `_audit-markets-prices-live.ts` | Audit live `GET /api/algo/markets-prices` vs BDD |

---

### 2.12 Validation opérationnelle (session 2026-07-11)

| Vérification | Résultat |
|--------------|----------|
| Drainage files après fix worker | `algo-order-signals` 759 → **0**, `execution-results` 721 → **0** |
| Consommateurs Redis | **5** clients `BRPOPLPUSH` actifs |
| Exécutions algo post-fix | **8 filled**, 18 `order_not_matched`, 7 `placing_orphan` nettoyés, 1 `reservation_expired` |
| Worker status | `alive: true`, 4 sélections évaluables, WS connecté |
| API marchés (18:46 UTC) | **4 live + 4 futurs** (`/api/algo/markets-prices`), cohérent BDD |
| Cause listes UI vides | Backend arrêté ou JWT expiré — **pas** un problème de config (4 règles + 4 sélections OK) |

**Action requise après déploiement code :** redémarrer **`npm run dev`** (Ctrl+C puis relance) pour charger worker/crypto-algo à jour.

---

## 3. Reste à faire

### 3.1 Priorité haute — opérationnel

| Action | Statut |
|--------|--------|
| Diagnostiquer worker (processing = 0) | ✅ Fait — boot bloqué + pas de consommateurs |
| Vider / drainer la file | ✅ Fait — drainage automatique post-fix ; purge manuelle optionnelle via `flush-redis-queues.ts` |
| Valider en live fenêtre 5m | ⚠️ Partiel — fills confirmés ; surveillance continue recommandée sur plusieurs fenêtres |
| Redémarrer stack après chaque patch worker/algo | 📋 Procédure — obligatoire (`tsx watch` ne suffit pas toujours si process bloqué) |

### 3.2 Phases planifiées (non codées)

| Phase | Objectif |
|-------|----------|
| **Phase 3** | Pub/sub `algo-selections-changed` au rollover auto-track (worker réabonne sans attendre le cycle sync) |
| **Phase 4** | Abstention `entry_in_flight` + cooldown post-échec exécution (éviter rafales de réservations sur file saturée) |
| **Phase 5** | Tests E2E fenêtre 5m complète (signal → fill → surveillance) |

### 3.3 Améliorations produit optionnelles

| Sujet | Détail |
|-------|--------|
| Rétroactif `close_reason` | Script one-shot pour taguer les `cancelled` sans raison (heuristique : pas d’exécution + réservation expirée) |
| Indicateur file worker | Badge ou compteur Redis dans l’UI surveillance |
| Doc utilisateur | Mettre à jour `docs/crypto-algo.md` avec la sémantique `pending` / `cancelled` / messages d’échec |
| `flush-redis-queues` | Définir `close_reason = reservation_released` lors du purge manuel (aligné janitor) |
| UI listes marchés vides | Afficher une erreur explicite si `/algo/markets-prices` échoue (au lieu de `[]` silencieux) |

### 3.4 Documentation technique

| Fichier doc | Statut |
|-------------|--------|
| `docs/crypto-algo.md` | À aligner : file `algo-order-signals`, `enqueueUnique`, boot worker, garde `reservation_expired` |
| `docs/pipeline-copy-trading.md` | N/A (hors scope) |
| `docs/modele-donnees.md` | À documenter `close_reason` réservation + champs surveillance |
| **Ce patch** | ✅ Mis à jour 2026-07-12 |

---

## 4. Synthèse des fichiers touchés

```
packages/core/src/
  positions/reservation-close-reasons.ts          (nouveau)
  redis/algo-reentry-fill.ts                      (nouveau)
  queue/worker-queues.ts                          (modifié — ALGO_ORDER_SIGNALS)
  worker-shared/redis-queue.ts                    (modifié — enqueueUnique)
  sizing/resume-reserved-entry.ts                 (modifié)
  sizing/resume-reserved-entry.test.ts            (modifié)
  services/algo-selection-book-assets.ts          (nouveau)
  services/algo-surveillance-positions.ts         (modifié)
  services/algo-surveillance.service.ts           (modifié)
  services/algo-surveillance.types.ts             (modifié)
  services/market.service.ts                      (modifié)
  services/reservation.service.ts                 (modifié — expiresAt)
  polymarket/market-metadata.ts                   (modifié)
  migrations/BumpSimAlgoEntrySizing1700000000053.ts (nouveau)
  database/data-source.ts                         (modifié)

packages/crypto-algo/src/
  strategy/strategy-runner.ts                     (modifié)
  strategy/re-entry-throttle.ts                   (modifié)
  index.ts                                        (modifié — file algo-order-signals)
  processors/algo-entry-pipeline.ts             (modifié — enqueueUnique)

packages/worker/src/
  index.ts                                        (modifié — consommateur algo + boot async)
  polymarket/ensure-book-ready.ts                 (nouveau)
  polymarket/sync-book-subscriptions.ts           (modifié)
  algo-reentry-fill.ts                            (nouveau)
  processors/executor.ts                          (modifié — garde reservation_expired)
  processors/executor.test.ts                     (modifié)
  processors/results-consumer.ts                  (modifié)

packages/frontend/src/
  components/SurveillanceHistoryCard.tsx          (modifié)
  lib/algo-surveillance-positions.ts              (modifié)
  lib/execution.ts                                (modifié — reservation_expired)
  styles.css                                      (modifié)

tools/
  flush-redis-queues.ts                           (modifié — algo-order-signals)
  _audit-redis-queues.ts                          (modifié)
  _audit-pending-algo.ts                          (modifié)
  _audit-sizing-config.ts                         (nouveau)
  _audit-worker-throughput.ts                     (nouveau)
  _audit-worker-liveness.ts                       (nouveau)
  _audit-redis-clients.ts                         (nouveau)
  _audit-recent-outcomes.ts                       (nouveau)
  _audit-algo-markets-ui.ts                       (nouveau)
  _audit-markets-prices-live.ts                   (nouveau)
  _audit-window-1650*.ts                          (nouveau)
  _audit-market-20583.ts                          (nouveau)
```

---

## 5. Checklist déploiement

- [x] Redémarrer **backend**, **worker**, **crypto-algo** après patch
- [x] Vérifier `algo-order-signals` ≈ 0 après reprise normale
- [x] Confirmer consommateurs Redis actifs (`BRPOPLPUSH`)
- [ ] Observer **plusieurs** fenêtres 5m : signal → fill ou message d’échec explicite en UI
- [ ] Confirmer absence de re-gonflement file (>10× doublons signalId)
- [ ] Confirmer absence de spam `fetchGammaMarketList failed` au boot
- [ ] Mettre à jour la doc technique (`docs/crypto-algo.md`, `modele-donnees.md`)
- [ ] Appliquer migration sizing si pas fait : `npm run migrate`

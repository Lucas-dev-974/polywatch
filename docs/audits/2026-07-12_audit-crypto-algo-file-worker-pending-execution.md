# Audit — Crypto-algo : file worker bloquée, positions `pending` / non exécutées

**Date :** 2026-07-11 → 2026-07-12  
**Version :** Polywatch v1.1  
**Périmètre :** pipelines surveillance / détection / exécution crypto-algo (mode **simulation**), files Redis worker, interaction worker ↔ crypto-algo  
**Statut :** ✅ Problème résolu opérationnellement + correctifs code (patch 2026-07-11) ; surveillance continue recommandée  

**Documents liés :**
- Patch détaillé : [`docs/patch-v1-1/2026-07-11_PATCH_CRYPTO_ALGO_EXECUTION_ET_SURVEILLANCE.md`](../patch-v1-1/2026-07-11_PATCH_CRYPTO_ALGO_EXECUTION_ET_SURVEILLANCE.md)
- Doc module : [`docs/crypto-algo.md`](../crypto-algo.md)

---

## 1. Problème rencontré

### 1.1 Symptômes utilisateur

Sur l’**Historique surveillance** (fenêtres 5m), les positions algo apparaissaient en :

| Affichage UI | Signification réelle |
|--------------|----------------------|
| `pending @ 0.0000` | Réservation créée, ordre **pas encore exécuté** par le worker |
| `cancelled @ 0.0000` | Tentative abandonnée **sans fill** (souvent TTL réserve expirée) |
| `YES` / `NO` | Direction du **signal** — pas l’absence de trade |

Impression métier : « aucune position n’a été prise », alors que la détection fonctionnait.

### 1.2 Symptômes runtime (logs)

```
[worker] CLOB book error: 404  … book refresh failed
[crypto-algo] fetchGammaMarketList failed … DOMException [TimeoutError]
```

Ces erreurs donnaient l’impression que le serveur « coincait ». En réalité :

- **Gamma timeout** et **CLOB 404** : asynchrones, catchés, non fatals (bruit + ralentissements locaux).
- **Vrai blocage trading** : le worker **ne consommait plus** (ou pas assez vite) la file Redis des ordres algo.

### 1.3 Preuve BDD / Redis (sessions 2026-07-11 et 2026-07-12)

Chaîne d’échec observée à plusieurs reprises :

```
signal détecté
  → ReservationService.reserve (TTL 180s) + position pending
  → enqueue Redis algo-order-signals
  → worker ne drain pas (ou boot bloqué / process mort côté consumers)
  → TTL expire → janitor → cancelled (sans ligne executions / ou failed tardif)
```

Snapshots typiques :

| Indicateur | Avant correction / incident | Après intervention 2026-07-12 |
|------------|-----------------------------|-------------------------------|
| `algo-order-signals` | 113–700+ | **0** |
| `algo-order-signals:processing` | 0 | 0 |
| Clients Redis `BRPOPLPUSH` | **0** | **5** |
| Positions `pending` ALGO_OPEN | plusieurs, sans exécution | **[]** |
| Fills `ALGO_OPEN` sim | absents ou sporadiques | confirmés post-restart |

---

## 2. Pourquoi ça s’est produit

Plusieurs causes se sont **empilées**. Les correctifs du patch 2026-07-11 traitent les causes structurelles ; l’incident du 2026-07-12 matin est une **réapparition opérationnelle** (worker sans consumers) sur une stack déjà patchée.

### 2.1 Cause racine #1 — File partagée saturée par le copy (historique)

Avant la file dédiée, les ordres algo partageaient `order-signals` avec le copy trading. Un backlog de centaines de `COPY_OPEN` morts (sim copy désactivé) **bloquait** les `ALGO_OPEN` : consommateur séquentiel unique.

### 2.2 Cause racine #2 — Worker boot bloqué sur sync carnets

`await syncBookSubscriptions()` au démarrage chargeait des centaines de carnets REST Up/Down (404, timeouts). Tant que cette sync n’avait pas fini, les `startConsumer()` Redis n’étaient pas atteints → file qui grossit, `processing: 0`, aucun `BRPOPLPUSH`.

### 2.3 Cause racine #3 — Inondation de doublons Redis

La stratégie ré-émet le même signal à chaque tick ; le chemin `resumeEntryFromReservation` / force-reenqueue ré-enfilait sans déduplication robuste → centaines d’entrées pour quelques signalIds uniques (ex. 113 jobs / 24 ids ≈ 4.7×).

Mécanisme aggravant encore présent (risque résiduel) : `enqueueEntrySignal` force un `enqueue` plain si le marqueur dedup existe mais `hasBuyExecution()` est false. **Quand le worker est down**, cela **contourne** la déduplication et re-gonfle la file.

### 2.4 Cause racine #4 — Quota re-entry consommé trop tôt (session antérieure)

`re_entry_limit` était décrémenté à l’**enqueue**, pas au fill → une tentative échouée (ex. CLOB 404) brûlait le quota et bloquait toute la fenêtre.

### 2.5 Cause racine #5 — Worker non abonné aux tokens algo DB

Le worker n’abonnait que la grille Gamma Up/Down ; les tokens des sélections algo en BDD pouvaient manquer de carnet au moment de l’exécution.

### 2.6 Causes secondaires (bruit, pas le blocage principal)

| Erreur | Origine | Impact réel |
|--------|---------|-------------|
| `CLOB book error: 404` | Token 5m pas encore publié / carnet absent sur REST | Warn dans `refreshBook` ; job ALGO_OPEN ralenti via `ensureBookReady` (retries) |
| `fetchGammaMarketList` TimeoutError | Gamma API lente / timeout 30s | Return `[]` ; abstention possible sur **une** eval ; pas de freeze global |

### 2.7 Rôle de la réserve 180s (clarification métier)

`RESERVATION_TTL_MS = 180_000` n’est **pas** un paramètre de stratégie. C’est un **hold de capital** :

1. Crée la position `pending`
2. Bloque le notional USDC (cash / exposition)
3. Empêche un doublon actif sur le même marché
4. Donne au worker **3 minutes** pour exécuter l’ordre enfilé

Si la file n’est pas drainée dans ce délai → expiration volontaire → `cancelled` / `reservation_expired`, pour ne pas laisser du cash bloqué indéfiniment.

### 2.8 État mort `pending` + BUY `placing` (2026-07-12 soir) — ✅ corrigé

Cas distinct du backlog file (§2.1–2.3) : le worker **consomme** le signal et `claim` une exec sim en `placing`, mais sort sans pousser de résultat dans `execution-results` (abort lock position). Ni `PlacingJanitor` (position encore `pending`) ni `PendingEntryJanitor` (BUY déjà présent) ne récupéraient → blocage jusqu’au TTL 180 s.

**Correctif** : [`docs/patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md`](../patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md) — fail-fast executor post-claim + `loadOrphanPlacingSim` étendu (`SIM_BUY_PLACING_STALE_MS` = 60 s).

---

## 3. Solutions mises en place

### 3.1 Correctifs code (patch 2026-07-11)

Documentés exhaustivement dans le patch lié. Synthèse :

| # | Solution | Effet |
|---|----------|--------|
| 1 | Compteur **re-entry au fill** (`algo-reentry-fill` pub/sub) | Quota non brûlé sur échec d’enqueue |
| 2 | Union tokens **algo DB + grille Gamma** pour WS worker | Carnets dispo pour marchés algo |
| 3 | `ensureBookReady` avant `ALGO_OPEN` BUY (retries 0.5 / 1 / 2 s) | Tolère 404 CLOB transitoires sur tokens 5m |
| 4 | File dédiée **`algo-order-signals`** | Isolation du backlog copy |
| 5 | `enqueueUnique` (SET NX + TTL réserve) | Limite les doublons par signal |
| 6 | Boot worker : `syncBookSubscriptions` en **fire-and-forget** | Consumers Redis démarrent immédiatement |
| 7 | Garde `reservation_expired` dans l’executor | Fail-fast sur backlog stale |
| 8 | Burst Gamma contrôlé (concurrency 8, skip si métadonnées fraîches, timeout 30s) | Moins de spam timeout au boot |
| 9 | `close_reason` + champs surveillance UI (`skipReason`, `executionErrorSim`) | Visibilité « pourquoi non exécuté » |
| 10 | Migration sizing sim (`BumpSimAlgoEntrySizing1700000000053`) | Plancher MOS 5m (mode fixed USDC) |

### 3.2 Intervention opérationnelle (2026-07-12 matin)

Malgré le patch, la stack live a de nouveau présenté **0 consumers** et une file à ~68–113.

Actions effectuées :

1. **Purge Redis** : `npx tsx tools/flush-redis-queues.ts --confirm --release-reservations`  
   - 68 `algo-order-signals` purgés  
   - 3 réservations libérées / pending annulés  
2. **Arrêt propre** des process Polywatch (concurrently / worker / crypto-algo / backend / frontend)  
3. **Relance** `npm run dev`  
4. **Vérification** :
   - log `Polywatch worker started` + `initial book subscription sync complete`
   - **5× `BRPOPLPUSH`**
   - `algo-order-signals = 0` (stable)
   - `PENDING []`
   - fills `ALGO_OPEN` sim confirmés (ex. executions #75637–75642)

### 3.3 Outils d’audit utilisés

| Script | Rôle |
|--------|------|
| `tools/_audit-redis-queues.ts` | Profondeurs files + samples |
| `tools/_audit-redis-clients.ts` | Clients Redis / commandes actives |
| `tools/_audit-worker-liveness.ts` | Delta file 8s + consumers bloqués |
| `tools/_audit-pending-algo.ts` | Pending + réservations + execs |
| `tools/_audit-recent-outcomes.ts` | Agrégats filled / failed |
| `tools/flush-redis-queues.ts` | Purge contrôlée |

---

## 4. Documentation technique

### 4.1 Chaîne nominale (sim)

```
crypto-algo                    Redis                         worker
───────────                    ─────                         ──────
StrategyRunner.evaluate
  → runAlgoEntryPipeline
  → ReservationService.reserve (180s)
  → enqueueEntrySignal
       ──────────────────────► algo-order-signals
                                                             Executor.handle
                                                               ensureBookReady
                                                               simulateFill
       ◄────────────────────── execution-results
                                                             ResultsConsumer → open
       ◄── algo-reentry-fill (pubsub) ──────────────────────
```

Process distincts : **crypto-algo** (détection), **worker** (exécution / exits), **backend** (API / UI). Pas de partage in-memory des carnets entre crypto-algo et worker.

### 4.2 Inventaire files Redis (algo)

| File / clé | Producteur | Consommateur | Concurrence | Risque |
|------------|------------|--------------|-------------|--------|
| `algo-order-signals` | crypto-algo, PendingEntryJanitor | worker | **1** (boucle séquentielle) | Backlog → `reservation_expired` |
| `algo-order-signals:processing` | `BRPOPLPUSH` | recoverOrphans au boot | — | Jobs orphelins si crash mid-job |
| `algo-order-signals:dead` | après 3 retries | replay manuel | — | Perte jusqu’à replay |
| `algo-order-signals:enqueued:{key}` | `enqueueUnique` | TTL | — | Contournable si force-reenqueue |
| `execution-results` | Executor | ResultsConsumer | 1 | Retarde `open` + re-entry |
| `close-signals` | StrategyProcessing | executorB | 1 | Exits derrière copy |

**Important :** ce n’est pas BullMQ. Pattern custom list Redis (`RPUSH` / `BRPOPLPUSH` / `LREM`).

### 4.3 Points de code critiques

| Sujet | Emplacement |
|-------|-------------|
| TTL réserve 180s | `packages/core/src/types/index.ts` (`RESERVATION_TTL_MS`) |
| Reserve + pending | `packages/core/src/services/reservation.service.ts` |
| File names | `packages/core/src/queue/worker-queues.ts` |
| Consumer séquentiel | `packages/core/src/worker-shared/redis-queue.ts` |
| Dedup + force-reenqueue | `packages/core/src/sizing/enqueue-entry-signal.ts` |
| Boot non bloquant | `packages/worker/src/index.ts` (`void syncBookSubscriptions(...)`) |
| ensureBookReady | `packages/worker/src/polymarket/ensure-book-ready.ts` |
| CLOB 404 | `packages/worker/src/polymarket/api-client.ts` → catch `connection-manager.refreshBook` |
| Gamma list + timeout | `packages/core/src/polymarket/market-metadata.ts` (`fetchGammaMarketList`) |

### 4.4 Mode simulation (spécificités audit)

- Sim algo **n’est pas** gateée par `simCopyTradingEnabled` (seulement `COPY_*`).
- Exécution via `Executor.simulateFill` (FAK sur book forcé).
- Tables d’analyse : `copied_positions` (`mode=sim`, `reason=ALGO_OPEN`), `executions`, `position_reservations`, `simulation_balance`, `algo_surveillance_snapshots`, `algo_price_ticks`.
- Config observée post-migration : `sim_sizing_mode=fixed_shares` × 5, `sim_entry_usdc_amount=10`, max 15 USDC. Les notionals ~3–4 USDC = 5 shares × prix (attendu).

### 4.5 Procédure de reprise (runbook)

```powershell
# 1. État
npx tsx tools/_audit-redis-queues.ts
npx tsx tools/_audit-redis-clients.ts
npx tsx tools/_audit-worker-liveness.ts

# 2. Si algo-order-signals > 50 et 0 BRPOPLPUSH :
#    Arrêter la stack (Ctrl+C sur npm run dev)
npx tsx tools/flush-redis-queues.ts --confirm --release-reservations

# 3. Relancer
npm run dev

# 4. Critères de santé
#    - log: "Polywatch worker started"
#    - ≥ 5 clients Redis en cmd=brpoplpush
#    - algo-order-signals ≈ 0 (pas de re-gonflement >10× doublons)
#    - fills ALGO_OPEN ou close_reason explicite en UI
```

**Note :** après un patch worker/crypto-algo, un redémarrage complet est obligatoire. `tsx watch` ne suffit pas si le process est coincé avant les consumers.

---

## 5. Risques résiduels / suite

| Priorité | Sujet | Statut |
|----------|-------|--------|
| P1 | Force-reenqueue de `enqueueEntrySignal` quand worker down → re-flood | ✅ Corrigé — bounded retry (cooldown 45s, max 2) |
| P2 | Phase 3 patch : pub/sub `algo-selections-changed` | ✅ Implémenté |
| P2 | Phase 4 : abstention `entry_in_flight` + cooldown post-échec | ✅ Partiel — anti-spam resume + cooldown 30s |
| P2 | Phase 5 : E2E fenêtre 5m | Non codé |
| P3 | Alignement doc `crypto-algo.md` / `modele-donnees.md` avec file dédiée + `close_reason` | Partiel |
| P2 | État mort `pending` + BUY sim `placing` orphelin (sans résultat execution-results) | ✅ Corrigé — patch 2026-07-12 soir |
| Ops | Surveiller plusieurs fenêtres 5m après chaque restart | Recommandé |

---

## 6. Conclusion

Le symptôme « positions algo pending / cancelled @ 0 » n’était **pas** une panne de détection : c’était une **rupture de la chaîne d’exécution** (file Redis non consommée, parfois aggravée par boot bloqué, file partagée copy, et doublons).

Les erreurs Gamma / CLOB 404 dans les logs sont surtout du **bruit opérationnel** ; elles peuvent ralentir un job ou une eval, mais le blocage observé en live était l’**absence de consumers worker**.

Correctifs structurels livrés (patch 2026-07-11) + purge + restart (2026-07-12) ont rétabli :

- consumers Redis actifs  
- file algo à 0  
- fills sim `ALGO_OPEN`  

La santé durable dépend du maintien de consumers vivants et du traitement des risques résiduels (force-reenqueue, Phase 4 abstention).

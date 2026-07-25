# Issues ouvertes — Polywatch v0.6

**Date** : 13 juin 2026 (mis à jour 14/06/2026 08:10)
**Méthode** : vérification de chaque issue auditée en lisant le code source (`packages/core`, `packages/worker`, `packages/backend`) et en le confrontant à la documentation Polymarket / CLOB.

> **Note importante** : les audits `AUDIT-SL-PNL-SPREAD-2026-06-12.md`, `AUDIT-MARCHE-FERME-CLOSED-2026-06-12.md` et `AUDIT-OPTIMIZATIONS-2026-06-12.md` ont été rédigés avant l'implémentation de correctifs supplémentaires. La vérification code révèle que **3 issues SL étaient déjà corrigées** (SL-1, SL-2, SL-3) mais marquées comme "non implémentées" dans l'audit.

> **Mise à jour du 13/06/2026** : **16 issues corrigées** (SL-4 à SL-8, MF-1/2/4/5, OPT-1/4/5/7/8/9/11/14). Voir section 5 pour le détail.
>
> **Patch 13/06/2026 20:33** : **6 issues supplémentaires corrigées** (MF-3, OPT-3, OPT-6, OPT-15, UserWS). Voir section 6.
>
> **Patch 14/06/2026 06:00** : **2 issues corrigées** (FL-1, FL-2). Voir section 7.
>
> **Patch 14/06/2026 06:10** : **1 issue corrigée** (OPT-10). Voir section 8.
>
> **Patch 14/06/2026 08:10** : **2 issues corrigées** (OPT-2, OPT-12). Voir section 9.
>
> **Mise à jour du 14/06/2026 (vérification code)** : le plan `WORKER-STARTUP-ECONNREFUSED-PLAN-2026-06-14.md` est entièrement implémenté (backend-ready Redis probe, refresh automatique du trading context, retrait de `wait-on` pour `dev:worker`). Voir section 10.
>
> **Mise à jour du 14/06/2026 (vérification code)** : l'`AUDIT-POLYMARKET-COMPLIANCE-2026-06-14.md` contient plusieurs points déjà corrigés ou partiellement obsolètes. Seuls 3 points résiduels restent à valider : test on-chain de la redemption, nommage `pusdNumberToRaw` utilisé pour des shares, et fragilité SQLite sur la double finalisation. Voir section 11.
>
> **Mise à jour du 18/06/2026 (audit v0.8)** : correctifs Phase A implémentés — `OPEN_LIKE` frontend aligné, `onReconnectExhausted` opérationnel, métrique `circuit_breaker_open` câblée, refactor copy-processor/strategy-processing/internal router, ESLint + tests frontend, script `validate:redemption`. Voir section 13.

---

## 1. Issues SL / PnL / Spread — vérifiées

| ID | Sévérité | Sujet | Code vérifié | Verdict |
|----|----------|-------|--------------|---------|
| **SL-4** | 🔴 Haute | Carnet illiquide → `trigger = 0`, `closure = undefined` | `strategy-processing.ts` L250-268 : appel `evaluateCloseLogic(pos, market, risk, 0)` avec 4 args seulement → `closure` non passé, SL hybride désactivé | ✅ **Corrigé le 13/06** |
| **SL-5** | 🟡 Moyenne | Ordre close exige `bidVwap > 0` | `strategy-processing.ts` L417 : `if (closeReason && bidVwap && bidVwap > 0)` | ✅ **Corrigé le 13/06** |
| **SL-6** | 🟢 Basse | `entryBidVwap === 0` → `triggerPnlPercent = 0` | `vwap.ts` L110-111 : garde `if (entryBidVwap === 0) return 0` | ✅ **Corrigé le 13/06** |
| **SL-7** | 🟡 Moyenne | Kill switch `force_close_all` skip illiquide | `strategy-processing.ts` L158-161 : `if (bidVwap <= 0) continue` | ✅ **Corrigé le 13/06** |
| **SL-8** | 🟢 Basse | UI : ticks absents si illiquide | `strategy-processing.ts` L268 : `return null` → pas de tick PnL | ✅ **Corrigé le 13/06** |

### ❌ Issues corrigées (audit obsolète sur ces points)

| ID | Assertion audit | Code réel constaté |
|----|----------------|--------------------|
| **SL-1** | SL uniquement sur métrique « marché » | `policy.ts` L286-289 : **SL hybride OR** `effectiveTrigger <= -slPercent OR effectiveClosure <= -slPercent` |
| **SL-2** | TP / trailing idem | `policy.ts` L293-304 : **TP en AND** (trigger AND closure) ; trailing sur **`peakClosurePnlPercent`** |
| **SL-3** | Pré-clôture perte sur `trigger < 0` | `policy.ts` L374-377 : **hybride OR** `trigger < 0 OR closure < 0` |

### ❓ Questions produit en attente

| ID | Question | Options |
|----|----------|---------|
| **V1** | SL hybride **OR** clôture | Déjà implémenté (OR) |
| **V2** | TP : **OR** ou **AND** avec clôture | Déjà implémenté (AND) |
| **V3** | Trailing : pic **clôture** ou dual | Déjà implémenté (peakClosurePnlPercent) |
| **V4** | % clôture SL : avec ou sans frais | Déjà implémenté (`closurePnlPercent` avec frais) |
| **V5** | Illiquide : éval sur dernier mark | ✅ **Implémenté le 13/06** — SL-4 utilise `pos.executableBidVwap` persisté |
| **V6** | Seuil entrée 0,90 → resserrer à 0,95 ? | Config utilisateur |

---

## 2. Issues Marché Fermé / Closed — vérifiées

| ID | Sévérité | Sujet | Code vérifié | Verdict |
|----|----------|-------|--------------|---------|
| **MF-1** | 🔴 Haute | `closed=1` non détecté comme état terminal | `lifecycle.ts` L43-47 : `isMarketSettled` retourne `false` quand `!winningTokenId`, même si `closed=1` | ✅ **Corrigé le 13/06** |
| **MF-2** | 🔴 Haute | Position coincée `open` + `illiquid` | Conséquence directe de MF-1 — pas de carnet (404 CLOB), pas de résolution | ✅ **Corrigé le 13/06** |
| **MF-3** | 🟡 Moyenne | UI affiche expiration sans état marché | `position.ts` : ajout des champs `marketResolved`/`marketClosed` + badge lifecycle dans `OpenPositionRow.tsx` | ✅ **Corrigé le 13/06** |
| **MF-4** | 🟡 Moyenne | `isMarketSettled` ignore `closed=1` | `lifecycle.ts` L43-47 : retourne `false` quand marché fermé mais pas résolu | ✅ **Corrigé le 13/06** (fusionné avec MF-1) |
| **MF-5** | 🟡 Moyenne | Pas de fallback mark price pour marché fermé | Aucun fallback pour `closed=1, resolved=0` | ✅ **Corrigé le 13/06** |

---

## 3. Issues Optimisations — vérifiées

| ID | Priorité | Sujet | Code vérifié | Verdict |
|----|----------|-------|--------------|---------|
| **OPT-1** | 🟡 Moyenne | Requêtes N+1 Strategy (3 requêtes par cycle ~100ms) | `strategy-processing.ts` L113-119 : `positions.find` + `riskService.getConfig` + `refreshMarketsNearEnd` | ✅ **Corrigé le 13/06** |
| **OPT-2** | 🟢 Basse | Recomptage positions actives (COUNT SQL à chaque réservation) | `reservation.service.ts` : cache mémoire avec TTL 10s + `invalidateActiveCount()` appelé par les événements de cycle de vie | ✅ **Corrigé le 14/06** |
| **OPT-3** | 🟡 Moyenne | Index manquants sur 4 requêtes fréquentes | `CopiedPosition.ts`, `Execution.ts`, `Market.ts`, `MoveEvent.ts`, `PositionReservation.ts` : `@Index()` ajoutés | ✅ **Corrigé le 13/06** |
| **OPT-4** | 🔴 Haute | Circuit breaker API Polymarket (appels externes sans protection) | `move-detector.ts` L97-99 : `catch { log.error; return []; }` — pas de breaker | ✅ **Corrigé le 13/06** |
| **OPT-5** | 🟡 Moyenne | Reconnexion WS arrêtée après 5 tentatives | `websocket-book.ts` L292-295 : `WS_MAX_RECONNECT_ATTEMPTS = 5` → arrêt définitif | ✅ **Corrigé le 13/06** |
| **OPT-6** | 🟡 Moyenne | Timeout RPC (appels sans limite de temps) | `polygon.ts` : `POLYGON_RPC_TIMEOUT_MS = 30_000` sur `FetchRequest.timeout` | ✅ **Corrigé le 13/06** |
| **OPT-7** | 🟢 Basse | Alerte dead-letter (jobs en dead-letter sans notification) | `redis-queue.ts` L65-68 : seulement `log.error` | ✅ **Corrigé le 13/06** |
| **OPT-8** | 🔴 Haute | Métriques métier (aucune métrique Prometheus personnalisée) | `backend/src/index.ts` L38-39 : seulement `collectDefaultMetrics` | ✅ **Corrigé le 13/06** |
| **OPT-9** | 🟢 Basse | Health check trop simple | `backend/src/index.ts` L69-71 : `{ status: 'ok', timestamp }` | ✅ **Corrigé le 13/06** |
| **OPT-10** | 🟢 Basse | Documentation métriques manquante | `docs/metrics.md` créé le 14/06 | ✅ **Corrigé le 14/06** |
| **OPT-11** | 🟡 Moyenne | Cache LRU sans limite de taille | `real-executor.ts` L19 : `new Map(...)` sans maxSize | ✅ **Corrigé le 13/06** |
| **OPT-12** | 🔵 Futur | Redis HA (point de défaillance unique) | `packages/core/src/redis/factory.ts` : `createRedis()` supporte Sentinel via `REDIS_SENTINEL_NAME`/`REDIS_SENTINEL_HOSTS` | ✅ **Corrigé le 14/06** |
| **OPT-13** | Migration PostgreSQL (SQLite limité) | `data-source.ts` : `createDialectAwareDataSource()` + patch datetime→timestamp | ✅ **Corrigé le 18/06** |
| **OPT-14** | 🟢 Basse | Compression WebSocket désactivée | `websocket.ts` L10-12 : pas de `perMessageDeflate` | ✅ **Corrigé le 13/06** |
| **OPT-15** | 🟢 Basse | Appels redondants `fetchAndPersist` | `market.service.ts` : TTL cache (15s) avec LRU eviction max 500 entrées | ✅ **Corrigé le 13/06** |

---

## 4. Récapitulatif des issues (post-patch 14/06 08:10)

| Sévérité | SL/PnL/Spread | Marché Fermé | Optimisations | **Total** |
|----------|:-------------:|:------------:|:-------------:|:---------:|
| 🔴 Haute | 0 | 0 | 0 | **0** |
| 🟡 Moyenne | 0 | 0 | 0 | **0** |
| 🟢 Basse | 0 | 0 | 0 | **0** |
| 🔵 Futur | 0 | 0 | 0 | **0** |
| ❓ Produit | 1 | 0 | 0 | **1** |
| **Restantes** | **1** | **0** | **0** | **1** |
| ⚠️ Non vérifiées | 0 | 0 | 0 | **0** |

**Total des issues restantes : 1** (contre 26 avant correctifs)
**Issues corrigées le 13/06/2026 : 22** (SL-4 à SL-8, MF-1/2/3/4/5, OPT-1/3/4/5/6/7/8/9/11/14/15, UserWS)
**Issues corrigées le 14/06/2026 : 5** (FL-1, FL-2, OPT-10, OPT-2, OPT-12)

---

## 5. Correctifs appliqués le 13/06/2026 (première vague)

| Correctif | Fichier(s) | Ce qui a été implémenté |
|-----------|-----------|------------------------|
| **SL-4 — Illiquide → closure DB** | `strategy-processing.ts` | `evaluateCloseLogic` reçoit `trigger/closure/peak/peakClosure` calculés depuis `pos.executableBidVwap` persisté quand carnet vide |
| **SL-5 — Close sans bid live** | `strategy-processing.ts` | Émission close-signal avec fallback `pos.executableBidVwap ?? pos.entryPrice` quand `bidVwap = 0` |
| **SL-6 — entryBidVwap=0** | `vwap.ts` | Commentaire documentant le sentinel 0 ; l'évaluation hybride utilise `closure` comme fallback |
| **SL-7 — Kill switch illiquide** | `strategy-processing.ts` | `forceCloseAllPositions` utilise `pos.executableBidVwap ?? pos.entryPrice` comme fallback au lieu de skip |
| **SL-8 — Ticks illiquides** | `strategy-processing.ts` | Émission d'un tick PnL avec les dernières valeurs DB persistées quand carnet vide (au lieu de `null`) |
| **MF-1 — closed=1 terminal** | `lifecycle.ts` | `isMarketSettled` retourne `true` si `closed && !acceptingOrders`, même sans `winningTokenId` |
| **MF-2 — Position coincée** | `strategy-processing.ts` | Force-close (`KILL_SWITCH`) des positions `open` sur marché terminal sans liquidité |
| **MF-4 — isMarketSettled** | `lifecycle.ts` | Fusionné avec MF-1 — même correctif |
| **MF-5 — Fallback mark** | `mark.ts` | `getPositionMarkPrice` gère les marchés terminaux sans `winningTokenId` via dernier bid ou `entryPrice` |
| **OPT-1 — Requêtes N+1** | `strategy-processing.ts` | `Promise.all` pour `riskService.getConfig()` + `refreshMarketsNearEnd()` en parallèle |
| **OPT-4 — Circuit breaker** | `circuit-breaker.ts` (nouveau), `move-detector.ts` | Circuit breaker 3 états (CLOSED/OPEN/HALF_OPEN) sur appels Data API ; log distinct quand ouvert |
| **OPT-5 — WS reconnect infini** | `websocket-book.ts` | Reconnexion indéfinie avec backoff exponentiel plafonné à 5 min ; warning après seuil dépassé |
| **OPT-7 — Alerte dead-letter** | `redis-queue.ts` | `notifyBackendAlert('warning', ...)` quand job passe en dead-letter après 3 retries |
| **OPT-8 — Métriques Prometheus** | `metrics.ts` (nouveau), `backend/src/index.ts` | 15 métriques custom : positions, SL/TP/trailing/kill-switch, spread, latence CLOB/Data API, circuit breaker, WS, illiquidité |
| **OPT-9 — Health check** | `backend/src/index.ts` | `/health` vérifie la connexion DB via `SELECT 1` ; retourne 503 si déconnecté |
| **OPT-11 — Cache LRU** | `real-executor.ts` | Éviction LRU à `MAX = 100` entrées + bump d'ordre sur accès |
| **OPT-14 — Compression WS** | `websocket-book.ts` | `perMessageDeflate` activé avec `zlibDeflateOptions: { level: 6 }` |
| **Tests lifecycle** | `lifecycle.test.ts` | 5 nouveaux tests : `isMarketTerminal`, `closed=1` sans winner, `isMarketRedeemable` distinct |

## 6. Correctifs appliqués le 13/06/2026 (patch 20:33)

| Correctif | Fichier(s) | Ce qui a été implémenté |
|-----------|-----------|------------------------|
| **MF-3 — UI état marché** | `position.ts`, `copied-position-presenter.ts`, `market.service.ts`, `OpenPositionRow.tsx` | Ajout des champs `marketResolved`/`marketClosed` dans les types frontend et backend ; badge de lifecycle affiché dans chaque ligne de position ouverte |
| **OPT-3 — Index manquants** | `CopiedPosition.ts`, `Execution.ts`, `Market.ts`, `MoveEvent.ts`, `PositionReservation.ts` | Ajout d'index composite TypeORM via `@Index()` sur les colonnes fréquemment interrogées (status+mode, conditionId, copiedPositionId+side+status, closed+acceptingOrders, expiresAt, processed) |
| **OPT-6 — Timeout RPC** | `polygon.ts` | `POLYGON_RPC_TIMEOUT_MS = 30_000` sur `FetchRequest.timeout` du provider ethers |
| **OPT-15 — Cache fetchAndPersist** | `market.service.ts` | TTL cache (15s) avec LRU eviction (max 500 entrées) pour éviter les appels Gamma redondants dans la même fenêtre de temps |
| **UserWS — Reconnexion infinie** | `websocket-user.ts` | Même pattern que `websocket-book.ts` : reconnexion indéfinie avec backoff exponentiel plafonné à 5 min, warning après seuil de 5 tentatives (au lieu d'arrêt définitif) |

### Correctifs déjà appliqués avant le 13/06 (non documentés dans les audits)

| Correctif | Fichier | Ce qui a été implémenté |
|-----------|---------|------------------------|
| **SL hybride OR** | `packages/core/src/risk/policy.ts` L286-289 | `evaluateSlTpTrailing` : SL fire si `trigger <= -sl OR closure <= -sl` |
| **TP hybride AND** | `packages/core/src/risk/policy.ts` L293-297 | TP fire seulement si `trigger >= tp AND closure >= tp` |
| **Trailing sur peakClosure** | `packages/core/src/risk/policy.ts` L300-304 | Trailing drawdown depuis `peakClosurePnlPercent` |
| **Pré-clôture hybride OR** | `packages/core/src/risk/policy.ts` L374-377 | `trigger < 0 OR closure < 0` pour `PRE_CLOSE_LOSS` |
| **`closurePnlPercent` avec frais** | `packages/core/src/pricing/vwap.ts` L141-150 | Nouvelle fonction exportée incluant les frais |
| **`peakClosurePnlPercent` persisté** | `packages/core/src/entities/CopiedPosition.ts` L56-57 | Nouveau champ en DB |
| **`peakClosurePnlPercent` calculé** | `packages/worker/src/processors/strategy-processing.ts` L327-329 | Peak tracking sur closure |
| **Tests hybrides** | `packages/core/src/risk/policy.test.ts` L72-229 | Cas #3444, #3403, TP AND, trailing drawdown |

---

## 7. Correctifs appliqués le 14/06/2026 (patch 06:00)

| Correctif | Fichier(s) | Ce qui a été implémenté |
|-----------|-----------|------------------------|
| **FL-1 — Pre-close liquidity gate** | `strategy-processing.ts` | `evaluateCloseLogic` reçoit `liquidityStatus`. Après `evaluateMarketExit`, si `closeReason === 'PRE_CLOSE_LOSS'` et `liquidityStatus === 'illiquid'`, le signal est annulé (`closeReason = null`). La position reste `open` et sera récupérée par le `RedemptionHandler` quand le marché sera settled. Évite les boucles de 150+ tentatives de vente vouées à l'échec (`no_liquidity`) sur les marchés courts dont le carnet s'est vidé. |
| **FL-2 — Failed position auto-redemption** | `copied-position.service.ts`, `redemption-handler.ts` | Nouvelle méthode `loadFailed()` qui charge les positions `failed` avec `quantity > 0`. `RedemptionHandler.processAll()` traite ces positions en plus des `pending_resolution` : si le marché est settled, le payoff (0 ou 1 par share) est crédité et la position passe en `closed`. Nettoie rétroactivement les positions coincées (ex. positions 3703/3707 — Bitcoin/Ethereum 5min — qui avaient consommé 2.04$ de cash sans jamais pouvoir vendre). |

### Contexte

Les marchés ultra-courts (5 minutes, type "Bitcoin Up or Down") voient leur carnet d'ordres se vider complètement à l'approche de la fin. Le pre-close se déclenchait, émettait un `PRE_CLOSE_LOSS`, mais l'executor échouait avec `no_liquidity` en boucle (150+ tentatives). La position passait en `failed` et le cash restait bloqué.

- **FL-1** empêche ce scénario : le pre-close n'est pas émis si le book est vide. La position attend la redemption.
- **FL-2** nettoie les positions déjà en `failed` : le `RedemptionHandler` les ramasse et les clôture au payoff réel du marché.

---

## 8. Correctifs appliqués le 14/06/2026 (patch 06:10)

| Correctif | Fichier(s) | Ce qui a été implémenté |
|-----------|-----------|------------------------|
| **OPT-10 — Documentation métriques** | `docs/metrics.md` (nouveau) | Documentation complète des 18 métriques Prometheus : nom, type, labels, description, buckets histogram, points d'instrumentation dans le code, exemples de requêtes PromQL, et suggestions d'alerting. |

---

## 9. Correctifs appliqués le 14/06/2026 (patch 08:10)

| Correctif | Fichier(s) | Ce qui a été implémenté |
|-----------|-----------|------------------------|
| **OPT-2 — Cache des compteurs de positions actives** | `packages/core/src/services/reservation.service.ts` | Cache mémoire avec TTL 10s pour éviter le `COUNT` SQL à chaque `reserve()`. La méthode `invalidateActiveCount(mode)` est appelée par les événements de cycle de vie (finalize, cancel, close) pour maintenir la cohérence. Le cache est un hint de performance — la transaction re-lit depuis la DB pour la décision finale. |
| **OPT-12 — Support Redis Sentinel/HA** | `packages/core/src/redis/factory.ts` (nouveau), `packages/worker/src/index.ts`, `packages/backend/src/redis.ts` | Nouvelle fonction `createRedis()` dans `@polywatch/core` qui supporte deux modes : (1) **Single-instance** via `REDIS_URL` (comportement actuel), (2) **Sentinel HA** via `REDIS_SENTINEL_NAME` + `REDIS_SENTINEL_HOSTS`. Le worker et le backend utilisent désormais `createRedis()` au lieu de `new Redis(config.redisUrl)`. Configuration : `retryStrategy` avec backoff, `maxRetriesPerRequest: null` pour les consommateurs bloquants. |

---

## 10. Plan ECONNREFUSED — statut : implémenté

Le plan `WORKER-STARTUP-ECONNREFUSED-PLAN-2026-06-14.md` a été entièrement mis en œuvre lors de la vérification code du 14/06/2026 :

| Élément | Fichier | Preuve dans le code |
|---|---|---|
| Backend publie `backend-ready` sur Redis après `server.listen` | `packages/backend/src/index.ts` L116-131 | `getRedis().publish('backend-ready', ...)` + clé volatile `EX 60` |
| Worker attend le signal avant de charger le contexte | `packages/worker/src/index.ts` L112-119 | `waitForBackendReady(redisSub, BACKEND_READY_TIMEOUT_MS)` |
| Refresh automatique du trading context au redémarrage backend | `packages/worker/src/index.ts` L198-222 | Debounce 5s + `refreshTradingContext()` + reconnexion user WS |
| Helper d'attente Redis | `packages/worker/src/clob/backend-readiness.ts` | `waitForBackendReady` avec fallback clé Redis + subscribe |
| `wait-on` retiré du script `dev:worker` | `package.json` L10 | `"dev:worker": "npm run dev -w @polywatch/worker"` |

**Verdict :** ce n'est plus une issue ouverte. Le document de plan devient une trace historique.

---

## 11. Points résiduels — audit compliance Polymarket CLOB v2

L'`AUDIT-POLYMARKET-COMPLIANCE-2026-06-14.md` a été relu ligne par ligne. La plupart des problèmes signalés sont **déjà corrigés** dans le code actuel ; seuls 3 points résiduels méritent une validation complémentaire :

| ID | Sujet | Code vérifié | Verdict | Prochaine action |
|---|---|---|---|---|
| **CMP-1** | Redemption : valider le passage on-chain par `execTransaction` du Safe/Proxy | `clob-redeem.ts` + script `npm run validate:redemption` | 🟡 **Résiduel** — outil manuel ajouté, test on-chain à exécuter par l'opérateur | `node scripts/validate-redemption-onchain.mjs --condition-id 0x... --outcome YES` |
| **CMP-2** | `pusdNumberToRaw(quantity)` utilisé pour des shares CTF | `packages/worker/src/processors/redemption-handler.ts` L144 : la fonction porte un nom trompeur, mais la scale (6 décimales) est bien celle des balances ERC1155 CTF. | 🟢 **Cosmétique** — pas de bug fonctionnel avéré. | Renommer ou documenter pour éviter la confusion. |
| **CMP-3** | Double finalisation SQLite | `execution.service.ts` : optimistic lock en place. Postgres disponible via `DATABASE_URL`. | 🟡 **Résiduel** — atténué ; Postgres recommandé en prod | Activer `DATABASE_URL` en production |

Les points suivants de l'audit compliance sont **confirmés corrigés / obsolètes** :

- **2.3 `timestamp`/`metadata`/`builder`** : commentaire explicite dans `real-executor.ts` L190-195 indiquant que le SDK les gère.
- **4.3 Division par zéro slippage guard** : protégé par `signal.referenceVwap > 0` dans `real-executor.ts` L132 et `executor.ts` L124.
- **4.4 Validation permissive réponses CLOB** : validation Zod via `clobOrderResponseSchema` dans `parse-fill-response.ts` L76-84.
- **4.5 Approbations vérifiées HTTP seulement** : `clob-approvals.ts` L142-162 attend le receipt on-chain et re-vérifie les allowances avant de répondre.

---

. **Réaligné le 14/06/2026 après vérification des plans ECONNREFUSED et de l'audit compliance. Mis à jour le 15/06/2026 après fix des liens Polymarket 404.***

---

## 12. Fix liens Polymarket 404 pour les marchés fils (15/06/2026)

### Problème
L'URL générée par Polywatch pour la position réelle ouverte sur **"France vs. Senegal: France O/U 2.5"** renvoyait une page 404 :

```
https://polymarket.com/fr/event/fifwc-fra-sen-2026-06-16-team-total-home-2pt5
```

Le `slug` stocké (`fifwc-fra-sen-2026-06-16-team-total-home-2pt5`) correspond au **marché fils**, pas à la page d'événement Polymarket. Polymarket s'attend au slug de l'événement parent (`fifwc-fra-sen-2026-06-16-more-markets`).

### Correctif
| Fichier | Changement |
|---|---|
| `packages/core/src/polymarket/url.ts` | `buildPolymarketMarketUrl` accepte désormais `eventSlug` en priorité, puis `marketSlug`, puis `conditionId`. |
| `packages/core/src/polymarket/market-metadata.ts` | Extraction du `eventSlug` depuis `events[0].slug` de la réponse Gamma API. |
| `packages/core/src/services/market.service.ts` | Propagation de `eventSlug` dans `ResolvedMarket` et persistance en base. |
| `packages/core/src/entities/Market.ts` | Nouvelle colonne `event_slug`. |
| `packages/core/src/polymarket/url.test.ts` | Tests unitaires du nouveau builder. |
| `packages/core/src/polymarket/market-metadata.test.ts` | Vérification que `eventSlug` est bien extrait d'un payload Gamma. |

### Résultat
L'URL générée pour la position est maintenant :

```
https://polymarket.com/event/fifwc-fra-sen-2026-06-16-more-markets
```

La base locale a également été patchée pour ce market (`condition_id = 0x4a060c12a1d21dd649782746b6e25b50c116af357ba288f366a99ed2eadcb025`) en attendant le prochain démarrage du backend / worker.

### Vérifications effectuées
- Tests unitaires : 17 passés (`url.test.ts`, `market-metadata.test.ts`, `market.service.test.ts`).
- Build `core`, `backend`, `worker` : OK.
- Linter : aucune erreur.

---

## 13. Audit codebase v0.8 — correctifs du 18/06/2026

| Correctif | Fichier(s) | Détail |
|-----------|-----------|--------|
| **OPEN_LIKE frontend** | `packages/frontend/src/lib/position.ts` | Ajout de `'failed'` dans `OPEN_LIKE_STATUSES` — aligné sur `core/positions/mark.ts` |
| **onReconnectExhausted** | `packages/worker/src/polymarket/websocket-user.ts` | Alerte opérateur déclenchée une fois après dépassement de `WS_MAX_RECONNECT_ATTEMPTS` |
| **circuit_breaker_open** | `circuit-breaker.ts`, `move-detector.ts`, `metrics.ts`, `internal/watchlist-routes.ts` | `onStateChange` + `POST /api/internal/metrics/circuit-breaker` |
| **Logs silencieux** | `packages/backend/src/index.ts`, `internal/positions-routes.ts` | pino sur Redis `backend-ready` et balance PUSD |
| **Refactor copy-processor** | `processors/copy/*.ts` | `CopyEntryPipeline`, `CopyExitPipeline`, `CopyRiskGate` |
| **Refactor strategy** | `processors/strategy/*.ts` | `KillSwitchMonitor`, `PnlTickPublisher`, `PositionExitEvaluator` |
| **Refactor internal API** | `routes/internal/*.ts`, `trading-wallet-resolver.ts` | Sous-routers + `resolveTradingWalletContext()` |
| **Frontend qualité** | `EventsPanel`, `move-events/*`, `useFormSave`, `position.test.ts` | Extraction composants, hook, tests Vitest, ESLint |
| **Compliance locale** | `package.json` | `npm run test:compliance` pour `tools/e2e/` |
| **CMP-1 outil** | `scripts/validate-redemption-onchain.mjs` | `npm run validate:redemption` — validation manuelle on-chain |

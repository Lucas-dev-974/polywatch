# Package `@polywatch/crypto-algo` — Gestion et Trading Algorithmique

Ce module implemente la couche d'automatisation algorithmique pour la decouverte et le suivi automatique de marches sur Polymarket, operant en parallele du copy-trading traditionnel.

---

## 1. Vue d'ensemble du fonctionnement

Le systeme crypto-algo fonctionne via deux mecaniques principales :
- **Auto-Track** : Decouverte dynamique de marches (ex: marches Up/Down a 5 min/15 min) selon des regles basees sur des symboles crypto et des intervalles.
- **Strategie** : Evaluation temps reel (via WebSocket et polling Gamma) des marches suivis pour generer des signaux d'achat et de vente, reutilisant le pipeline d'execution et de gestion de risques de `@polywatch/core`.

```
WebSocket (Polymarket) -> Discovery des marches -> 
|
Strategy Evaluation (Momentum) -> Generation signaux Algo -> 
|
Publication WebSocket (real-time %) -> Backend API -> Frontend UI
```

Toutes les executions et les positions associees a la couche algorithmique sont rattachees a une watchlist entry sentinelle ayant l'adresse `'crypto-algo'` (`CRYPTO_ALGO_TRADER_ADDRESS`). Cela permet de les integrer naturellement dans l'interface de copy-trading classique sans perturber le modele de donnees.

**Execution sim** : meme pre-ordre que le reel (`prepareFakMarketOrder`), tunables `GlobalConfig` (latence, auto-impact, preflight, shadow). Voir [simulation-execution.md](./simulation-execution.md).

---

## 2. Processus et boucles d'arriere-plan

| Composant | Cadence | Role |
|-----------|---------|------|
| `StrategyRunner` | `CRYPTO_ALGO_POLL_MS` (30s par defaut) + events WS | Evalue periodiquement et sur chaque mise a jour WebSocket les strategies actives sur tous les marches selectionnes |
| `CryptoAlgoPriceFeed` | Temps reel (WS CLOB) | S'abonne aux flux de prix des marches suivis, met en cache le top-of-book et debounce a 5s les mises a jour pour limiter la charge |
| `AutoTrackJanitor` | Adaptatif | Nettoie les selections expirees/resolues et declenche de nouvelles decouvertes de marches via l'auto-track |
| `SurveillanceJanitor` | Periodique | Archive et met a jour le statut des cibles de surveillance dont la cloture traine |
| `RuntimeStatusPublisher` | 30s | Publie le statut de fonctionnement du module dans Redis (`crypto-algo:runtime-status`) |

---

## 3. Strategies de trading

### NaiveMomentumStrategy (`naive-momentum`)
Strategie d'entree par **bande de prix** sur le token achete (Up pour YES, Down pour NO), avec garde liquidite/spread.

- **Prix de mark** : mid WebSocket du token Up en priorite si le carnet est **frais** (<= `cryptoAlgoMaxBookAgeMs`, defaut 15 s) et **bilaterale** ; Gamma en fallback uniquement. Un ecart WS/Gamma eleve est logge mais **n'est plus bloquant**.
- **Regle d'entree (bande activee, defaut)** : entree si le **prix du token achete** est strictement dans `(entryPriceMin, entryPriceMax)` — defaut **(0,50 ; 0,80)** :
  - **YES** si `0,50 < prix Up < 0,80`
  - **NO** si `0,50 < prix Down < 0,80` (equivalent : `0,20 < prix Up < 0,50`)
  - Hors bande -> abstention `price_band`
- **Mode legacy (bande desactivee)** : retour au seuil momentum `baseThreshold` (defaut 0,55) avec ajustement spread : `adjustedThreshold = baseThreshold + (spreadAbs x spreadAdjustmentFactor)`. Abstention `neutral_zone` si le prix est entre les seuils.
- **Garde liquidite / spread (fail-closed)** : appliquee sur le carnet du **token que le signal acheterait** (Up pour YES, Down pour NO). Le carnet cible doit etre **frais et bilateral** ; sinon abstention `illiquid_book` (absent/unilateral) ou `stale_book` (perime). Si bilateral frais, le spread absolu est compare au max par intervalle (ex. 0,05 pour 5m) -> `spread_gate` si trop large. **Pas d'entree a l'aveugle** sans carnet cible liquide.
- **Filtre courbe descendante (optionnel, defaut off)** : apres candidat YES/NO et garde liquidite cible, mesure `delta = mid(t_last) - mid(t_first)` sur le **token achete** (Up pour YES, Down pour NO) sur `cryptoAlgoCurveLookbackMs` (defaut 10 s, max 60 s). Si `delta < -cryptoAlgoCurveMinDelta` (defaut -0,01) -> abstention `curve_descending`. Flat ou montee OK. Historique insuffisant (< 3 points WS ou span < 50 % lookback) -> **fail-open** (pas de blocage). Necessite carnet WS (`MidHistoryBuffer` in-memory) ; warm-up ~lookback apres activation ou reconnect.
- **Validation somme YES+NO ~ 1.0** : uniquement sur le chemin Gamma (le chemin WS valide bid/ask coherents).
- **Abstentions structurees** : `price_band`, `curve_descending`, `neutral_zone`, `spread_gate`, `illiquid_book`, `stale_book`, `re_entry_limit`, `sl_quota_reached`, `no_outcome_prices`, etc. — propagees au runtime-status et a `algo_price_ticks.last_abstain_reason` (format `code` ou `code:detail`).
- **Concurrence** : une seule evaluation a la fois par `conditionId` (serialisation WS debounce + polling).
- **Debounce WS** : timers annules a l'unsubscribe / clearTopOfBook.

Patch bande : [`patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md`](./patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md).  
Patch courbe : [`patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md`](./patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md), durcissement [`patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md`](./patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md).

### Filtre courbe descendante (detail)

Ordre d'evaluation dans `NaiveMomentumStrategy.evaluate` :

```
bande / threshold → candidat YES|NO
  → liquidite carnet cible (illiquid / stale)
  → gate courbe (si enabled)
  → spread max intervalle
  → signal
```

| Situation | Resultat (filtre courbe) |
|-----------|--------------------------|
| Token cible en baisse (`delta < -minDelta`) | `curve_descending` |
| Flat ou montee | OK (autres gates) |
| Historique WS insuffisant | fail-open |
| Filtre desactive | ignore |

Configuration : Settings → Crypto algo → Général (toggle + lookback + min delta). Constantes code : `CURVE_MIN_POINTS=3`, `CURVE_SAMPLE_INTERVAL_MS=500`, `CURVE_BUFFER_MAX_MS=60000`.

### Fenetre d'entree effective (marches courts)

Sur un marche **5m**, la fenetre reelle d'entree est nettement plus courte que 5 minutes :
- decouverte auto-track (~quelques secondes apres l'ouverture) ;
- cache Gamma TTL via **`CryptoConfig`** uniquement (`cryptoAlgoGammaCacheTtlShortMs` / `cryptoAlgoGammaCacheTtlDefaultMs`, resolvers core) — **10 s** pour les intervalles <= 15m (30 s pour 1h+) ; `applyRiskTunables` obligatoire avant `start()` ;
- `cryptoAlgoMinTimeToClose` resolu par defaut a `max(preClose, timeExit) + 30 s` -> **150 s** d'interdiction d'entree en fin de marche (pre-close 120 s + buffer).

Fenetre utile typique ~ **2 min 20**. Pour elargir : fixer `cryptoAlgoMinTimeToClose` explicitement (sans toucher aux defauts pre-close, qui protegent la sortie).

---

## 4. Pipeline d'entree algorithmique (`algo-entry-pipeline.ts`)

Pour chaque signal genere, le pipeline d'entree execute les etapes suivantes :
1. Determination du mode (`sim` ou `real` selon l'etat du systeme).
2. Verification du **quota SL** (configurable via `cryptoAlgoSlQuotaEnabled` / `cryptoAlgoSlQuotaPerMarket`, defaut : desactive) : compte les sorties SL **des le declenchement** (`closing_reason = 'SL'` via `beginClose`), pas seulement a la cloture finale. Bloque aussi toute nouvelle entree tant qu'une position algo est deja `open` ou `closing` sur le marche (regle cross-outcome : pas de YES+NO simultanes). Si le quota est atteint ou une position est exposee, abstention `sl_quota_reached` avec detail `open_position_on_market` ou `sl_slots_consumed`. Cache TTL configurable (`cryptoAlgoSlQuotaCacheTtlSeconds`, defaut 30s).
3. Verification du verrou de **re-entree** (configurable via `cryptoAlgoReentryWindowMs` / `cryptoAlgoMaxEntriesPerWindow`, defaut : duree de l'intervalle marche, max 1 enqueue reussi par `conditionId:outcome`) — cle Redis `crypto-reentry:{conditionId}:{YES|NO}` via `packages/core/src/redis/crypto-reentry-throttle.ts`.
4. Calcul de la taille de la position via `getCryptoAlgoSizingParams` (sizing dedie crypto-algo : `fixed_usdc` ou `fixed_shares`), plafonnee par `getCryptoMaxPositionSizeUsdc`.
5. Reservation transactionnelle du capital (`ReservationService`).
6. Emission d'un `OrderSignal` FAK dans la file Redis **`algo-order-signals`** (file dediee, isolee du copy-trading `order-signals`).

### Sizing dedie crypto-algo

Le crypto-algo dispose de son propre mode de sizing, independant du copy trading :

| Parametre | Defaut | Description |
|-----------|--------|-------------|
| `cryptoAlgoSizingMode` | `fixed_usdc` | Mode de sizing : `fixed_usdc` ou `fixed_shares` |
| `cryptoAlgoEntryUsdcAmount` | 10 | Montant fixe en USDC par entree (mode `fixed_usdc`) |
| `cryptoAlgoEntryShareCount` | null | Nombre fixe de shares par entree (mode `fixed_shares`) |

Resolution via `getCryptoAlgoSizingParams()` dans `packages/core/src/risk/crypto-algo-tunables.ts`.

### Durcissement execution (v1.1, juillet 2026)

| Mecanisme | Role |
|-----------|------|
| `enqueueUnique` + **bounded retry** | Max 2 re-enqueues / reserve, cooldown 45 s si worker down |
| `hasInFlightBuy` | Pas de force-reenqueue tant qu'un BUY est `placing`/`partial` |
| Resume anti-spam | Si marqueur dedup actif ou BUY in-flight -> noop (pas de nouvelle reserve) |
| Cooldown post-echec | `ALGO_OPEN` BUY `failed` -> cle Redis `algo-entry-cooldown:{conditionId}:{mode}` TTL 30 s |
| `algo-selections-changed` | Pub/sub apres janitor ; worker debounce `syncBookSubscriptions` (mutex) |
| `worker:heartbeat` | SET EX 60 s cote worker ; expose via `GET /api/algo/worker-queue-status` |
| Post-claim fail-fast | Executor : abort apres `claim` -> `position_lock_timeout` (plus d'exec sim orpheline en `placing`) |
| PlacingJanitor stale pending | BUY sim `placing` + `pending` + reservation stale/absente (> `SIM_BUY_PLACING_STALE_MS` = 60 s) -> `placing_orphan` |

Patch detaille : [`patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md`](./patchs/2026-07-12_PATCH_PENDING_PLACING_ORPHAN.md). badge profondeur `algo-order-signals` dans le panneau *Historique surveillance* (ok / warning / critical).

**Tests autonomes :** `npm run test:e2e:crypto:hardening` (pg-mem + MockRedis).

### Durcissement reset simulation (v1.1)

`POST /api/simulation-balance/reset` aligne Redis sur la DB sim :

| Etape | Action |
|-------|--------|
| Pre-delete | `collectSimRedisPurgeHints` — snapshot cles dedup sim depuis reservations / pending algo |
| Delete DB | `copied_positions`, `executions`, `position_reservations` mode `sim` |
| Post-commit | `purgeSimExecutionRedisState` — `LREM` jobs sim, marqueurs cibles, cooldown `*:sim` |
| Notify | WebSocket `simulation_reset` + pub/sub Redis `simulation-reset` |

Le pipeline (`resolveEntryEnqueueBlocked`) libere la reservation si l'enqueue echoue apres reserve, sauf BUY in-flight ou marqueur dedup encore actif (job probablement en file).

Implementation : `packages/core/src/redis/sim-reset-redis-hygiene.ts`, `packages/core/src/sizing/entry-enqueue-result.ts`.

Tests : `npm run test:e2e:crypto:sim-reset` · Plan : [`plans/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md`](./plans/2026-07-12_PLAN_SIM_RESET_REDIS_HYGIENE.md)

---

## 5. Configuration & Variables d'environnement

Les variables suivantes sont configurees au niveau du monorepo ou dans le fichier `.env` :
- `CRYPTO_ALGO_POLL_MS` : Frequence de polling pour le StrategyRunner (par defaut `30000` ms).
- `DATABASE_URL` : Base de donnees partagee PostgreSQL.
- `REDIS_URL` : URL de la base Redis.
- `BACKEND_URL` : URL du serveur backend pour les notifications de statut et d'executions.

### Parametres de Risque (`CryptoConfig` / `GlobalConfig`)
- `cryptoAlgoEnabled` : Activation globale de l'execution algorithmique.
- `cryptoAlgoStrategies` : Liste JSON des strategies actives (ex: `["naive-momentum"]`).
- `cryptoAlgoSlBidPoints` / `cryptoAlgoTpBidPoints` : Overrides SL/TP en **bid absolu** (points de probabilite) pour marches binaires. `null` = defaults par intervalle (5m : SL 0,10 / TP 0,12). `0` ou negatif = desactive. Seuil calcule au fill : `slBidAbsolute = entryBidVwap - slBidPoints`, `tpBidAbsolute = min(entryBidVwap + tpBidPoints, 0.99)`. Garde binaire obligatoire (`byInterval != null`). Garde frais TP (`closurePnl >= 0`). Recalcule sur `ALGO_INCREASE`. Voir `docs/patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`.
- `cryptoAlgoTrailingBidPoints` / `cryptoAlgoTrailingActivationBidPoints` : Overrides trailing en bid absolu. `null` = defaults par intervalle.
- `cryptoAlgoPreCloseEnabled` : Active la pre-cloture pour les positions algo. `null` = herite du mode.
- `cryptoAlgoPreCloseSeconds` : Fenetre pre-close en secondes. `null` = resolution par interval via `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` (120s pour 5m, 180s pour 15m, 240s pour 30m, 300s pour 1h, 600s pour 4h/1d).
- `cryptoAlgoPreCloseKeepEnabled` : Active le keep des positions gagnantes en pre-close. `null` = herite du mode.
- `cryptoAlgoPreCloseKeepBidThreshold` : Seuil de bid pour le keep. `null` = herite du mode.
- `cryptoAlgoMinTimeToClose` : secondes minimum avant cloture pour autoriser une entree.
- `cryptoAlgoReentryWindowMs` : fenetre anti re-entree (ms) par `conditionId:outcome`. `null` = duree de l'intervalle (ex. 5m -> 300 000 ms), sinon 1 h.
- `cryptoAlgoMaxEntriesPerWindow` : max enqueues reussis par fenetre et par outcome (YES/NO separes). `null` = 1. Un skip pipeline ne consomme pas de slot.
- `cryptoAlgoSlQuotaEnabled` : Active le quota SL par marche. Quand active, les sorties SL consomment un slot des le declenchement ; une seule position algo ouverte par marche ; blocage cross-outcome une fois le quota atteint. Defaut : `false`.
- `cryptoAlgoSlQuotaPerMarket` : Nombre maximum de sorties SL declenchees sur un meme marche avant blocage des nouvelles entrees. Defaut : `1`.
- `cryptoAlgoSlQuotaCacheTtlSeconds` : TTL du cache du compteur SL (secondes). Evite de frapper la DB a chaque cycle d'evaluation. Defaut : `30`.
- `cryptoAlgoSizingMode` : Mode de sizing dedie crypto-algo (`fixed_usdc` ou `fixed_shares`, defaut `fixed_usdc`).
- `cryptoAlgoEntryUsdcAmount` : Montant fixe en USDC par entree crypto-algo (defaut 10).
- `cryptoAlgoEntryShareCount` : Nombre fixe de shares par entree crypto-algo (nullable, pour mode `fixed_shares`).
- Plafond de taille : `getCryptoMaxPositionSizeUsdc(crypto, mode)` (parametres sim/real sur `CryptoConfig`).

### Tunables strategie & pipeline (UI CryptoAlgo, migrations `0040` + `0056`)

Colonnes `null` = defaut code ; JSON `null` / `{}` = tables hardcodees (GET API normalise toujours `{}` -> `null`) ; objet partiel = merge par cle d'intervalle (`5m`, `10m`, ... `1d`). Resolution : `packages/core/src/risk/crypto-algo-tunables.ts`. Hot-reload via Redis `config-changed`. Les placeholders UI (`CODE_DEFAULT_*`) restent des copies locales synchronisees avec core (evite de tirer Node dans le bundle Vite) ; test anti-derive sur les tables core.

| Champ | Defaut code | Role |
|-------|-------------|------|
| `cryptoAlgoEntryPriceBandEnabled` | `true` | Bande d'entree active (remplace le threshold momentum pour la direction) |
| `cryptoAlgoEntryPriceMin` | 0.55 | Borne basse **exclusive** sur le prix du token achete |
| `cryptoAlgoEntryPriceMax` | 0.80 | Borne haute **exclusive** sur le prix du token achete |
| `cryptoAlgoCurveFilterEnabled` | `false` | Filtre courbe descendante (token achete en baisse → abstention `curve_descending`) |
| `cryptoAlgoCurveLookbackMs` | 10000 | Fenetre mid WS (ms). Max **60 000** (= `CURVE_BUFFER_MAX_MS`). Valeurs DB > max clampées à la lecture. |
| `cryptoAlgoCurveMinDelta` | 0.01 | Seuil descente (points de proba). Bloque si `delta < -seuil`. |
| `cryptoAlgoBaseThreshold` | 0.55 | Seuil momentum legacy — **ignore** si bande activee |
| `cryptoAlgoSpreadAdjustmentFactor` | 0.5 | Ajustement seuil selon spread (legacy uniquement) |
| `cryptoAlgoMinSpreadAbsForAdjustment` | 0.01 | Spread min pour ajustement |
| `cryptoAlgoMaxSpreadAbs` | 0.02 | Plafond spread si intervalle inconnu |
| `cryptoAlgoPriceSumTolerance` | 0.02 | Tolerance YES+NO (Gamma) |
| `cryptoAlgoWarnPriceDeviation` | 0.05 | Log ecart WS/Gamma |
| `cryptoAlgoMaxBookAgeMs` | 15000 | Fraicheur carnet WS |
| `cryptoAlgoSpreadAbsByInterval` | table code | JSON merge spread max par intervalle |
| `cryptoAlgoGammaCacheTtlShortMs` | 10000 | TTL Gamma <=15m |
| `cryptoAlgoGammaCacheTtlDefaultMs` | 30000 | TTL Gamma 30m+ |
| `cryptoAlgoGammaStaleOnErrorFactor` | 2 | Multiplicateur stale-on-error |
| `cryptoAlgoWsDebounceMs` | 5000 | Debounce evaluations WS |
| `cryptoAlgoPollMs` | env / 30000 | Poll fallback StrategyRunner |
| `cryptoAlgoTickIntervalMs` | 1000 | Intervalle PriceTickRecorder |
| `cryptoAlgoTickRetentionHours` | 24 | Retention ticks avant purge |
| `cryptoAlgoPriceTickRefQty` | 50 | Ref qty VWAP ticks |
| `cryptoAlgoExitDefaultsByInterval` | table code | JSON merge SL/TP/trailing par intervalle |
| `cryptoAlgoPreCloseSecondsByInterval` | table code | JSON merge fenetre SOFT |
| `cryptoAlgoMinTimeToCloseBufferSeconds` | 30 | Buffer entree min avant fin |
| `cryptoAlgoLastCloseableBidMaxAgeMs` | 60000 | Fraicheur last closeable bid (sorties / close bid / mark conservateur) — **branche runtime** via `resolveLastCloseableBidMaxAgeMs` |

Plan : [`plans/2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md`](./plans/2026-07-09_PLAN_UI_CRYPTO_ALGO_TUNABLES.md).

---

## 6. Sorties (SL/TP/Trailing/Pre-Close)

Les sorties algo (SL/TP/trailing/pre-close) sont evaluees par le **worker principal**
(`StrategyProcessing` -> `position-exit-evaluator.ts`), pas par crypto-algo.

### Phases de vie (exemple marche 5 min)

```
Ouverture ----> SL/TP/trailing (carnet liquide)
         ----> T-preClose : phase SOFT (PRE_CLOSE_LOSS perdantes, keep si gagnante)
         ----> endDate+   : retry si acceptingOrders, sinon redemption
```

### Pre-Close Keep

Le comportement pre-close est unifie entre copy trading et crypto-algo :

| Situation | Action |
|-----------|--------|
| Gagnante (bid >= keepBidThreshold) et keepEnabled | **Tenir** (keep) -> resolution |
| Gagnante (bid >= keepBidThreshold) et keepEnabled=false | **PRE_CLOSE_LOSS** (vente) |
| Perdante (bid < keepBidThreshold) | **PRE_CLOSE_LOSS** (vente) |
| Prix absent / perime | **PRE_CLOSE_LOSS** par securite |
| Qty < mos | Gate conserve -> redemption si invendable |

Le `keepEnabled` est desactive (`false`) par defaut pour les deux systemes, ce qui signifie que toutes les positions sont pre-cloturees par defaut. L'activation du keep permet de conserver les positions dont le bid est superieur au seuil configure.

### Parametres `CryptoConfig`

| Champ | Role |
|-------|------|
| `cryptoAlgoPreCloseEnabled` | Active la pre-cloture (`null` = herite du mode) |
| `cryptoAlgoPreCloseSeconds` | Secondes avant `endDate` pour la phase SOFT (`null` = table par intervalle, ex. 120 s pour 5m) |
| `cryptoAlgoPreCloseKeepEnabled` | Active le keep des positions gagnantes (`null` = herite du mode) |
| `cryptoAlgoPreCloseKeepBidThreshold` | Seuil bid pour tenir une gagnante (`null` = herite du mode) |

Resolution effective : `packages/core/src/risk/crypto-algo-exit.ts`.

---

## 7. Historique de prix (`PriceTickRecorder`)

Pendant la surveillance d'un marche actif, `PriceTickRecorder` enregistre des
ticks UP/DOWN a **1 Hz** dans la table `algo_price_ticks` (`AlgoPriceTick`),
avec metriques enrichies (spread, liquidite, positions ouvertes, etc.).

- API : `GET /api/algo/market-chart/:conditionId` (JWT) — courbe pour l'UI.
- Purge automatique des ticks selon `cryptoAlgoTickRetentionHours` (defaut 24 h).
- Inventaire detaille des champs metriques (algo vs non-crypto vs APIs Polymarket) :
  [`metriques-marche.md`](./metriques-marche.md).
- Voir aussi [`code/07-crypto-algo.md`](./code/07-crypto-algo.md).

### Timestamp et couverture temporelle

- `recordedAt` est explicitement fourni par `PriceTickRecorder` (egal au `now`
  du cycle de tick, pas au moment de l'insertion DB). Cela evite le decalage
  lie a la latence d'ecriture et garde le graphique aligne avec les
  horloges de marche.
- Le `PriceTickRecorder` demarre des qu'une cible est decouverte par
  `refreshSurveillanceTargets()` (`buildSurveillanceTargets`), sans attendre le
  snapshot d'ouverture. Le callback `onOpenCaptured` du
  `MarketSurveillanceRecorder` reste un second chemin idempotent ; les deux
  appels convergent sans doublon de ticks grace a la garde
  `activeMarkets.has(conditionId)`.
- Le dernier tick est autorise jusqu'a `marketEndMs + tickIntervalMs` (grace
  period d'un intervalle), de facon a capturer le point final meme si le timer
  a derive legerement au-dela de la cloture officielle.

---

## 8. Modules runtime (complément)

| Module | Rôle |
|--------|------|
| `surveillance-targets.ts` | `buildSurveillanceTargets` — fusion sélections actives + marchés futurs auto-track pour `MarketSurveillanceRecorder` |
| `signal-state-registry.ts` | Dernier signal / dernière abstention par `conditionId` (enrichit `algo_price_ticks`) |
| `position-context-cache.ts` | Cache batch positions algo ouvertes (`count`, exposure, uPnL) rafraîchi toutes les 5 s |
| `algo-percent-publisher.ts` | Push live % Up/Down → `POST /api/internal/market-pct-updates` (batch, flush 250 ms) |
| `algo-chart-tick-publisher.ts` | Push ticks chart → `POST /api/internal/algo-chart-ticks` (WS `algo_chart_tick`) |
| `curve-descending-gate.ts` | `evaluateCurveDescendingGate` — `delta = last.mid − first.mid` ; `pass` / `insufficient` / `descending` |
| `post-entry-mid-logger.ts` | Samples mid +1s/+5s/+30s après fill ALGO_OPEN → table `post_entry_mid_samples` ; cancel si position fermée (`algo-position-closed`) |
| `scripts/monitor.ts` | CLI offline monitoring (DB+Redis → JSON) ; lancé aussi via `POST /api/system/crypto-algo-monitor` |

**Abstentions** (`AbstainReasonCode`, 15) : `neutral_zone`, `spread_gate`, `illiquid_book`, `no_outcome_prices`, `invalid_price_sum`, `stale_book`, `no_price_source`, `invalid_interval`, `unknown_outcomes`, `missing_token`, `re_entry_limit`, `sl_quota_reached`, `price_band`, `curve_descending`, `curve_insufficient`.

**Timers `index.ts`** : selection refresh, strategy poll, market janitor, surveillance refresh/janitor, price-tick cleanup, position-context 5 s, heartbeat 30 s, post-entry mid (+1/+5/+30), rétention samples mid (horaire).

---

## 9. Rapport d'optimisation (sim)

Analyse agreegee des positions `ALGO_OPEN` en simulation : PnL par `close_reason`,
whipsaw SL, buckets d'entree, leviers et recommandations `crypto_algo_*`.

- **Preview live** : `GET /api/algo/optimize-report` (dialog Crypto Algo, non persiste).
- **Hub persiste** : page **Rapports** + `POST /api/reports/generate` — voir [`rapports-analyse.md`](./rapports-analyse.md).
- **Builder** : `loadCryptoAlgoOptimizeReport` -> `buildCryptoAlgoOptimizeReport` (`@polywatch/core`).
- **Apply** : `buildRecommendedCryptoAlgoConfig` + `PUT /api/config/crypto` avec garde fingerprint.

Distinct des snapshots simulation (etat global portefeuille vs analyse algo typee).

---

## 10. Miroir weather-algo (C8)

`weather-algo` reprend les mêmes patterns (watchlist sentinelle, Redis ×3, heartbeat,
runtime-status, entry pipeline, auto-track janitor, `config-changed`) avec un drift
domaine volontaire : exit evaluator **in-package**, forecast/city-follow, poll-driven
(pas de price-feed / mid-history / curve gate), file `weather-order-signals`.

| Pattern partagé | Spécifique crypto |
|-----------------|-------------------|
| Watchlist sentinelle + seed | Adresse `'crypto-algo'` |
| Registry + stratégies | `naive-momentum` + bande/curve |
| Entry pipeline sizing/MOS/reserve | File `algo-order-signals`, reason `ALGO_OPEN` |
| SL/TP | Délégué au **worker** (pas d'exit evaluator local) |
| Price-feed WS + mid-history | Absent côté weather |

**Décision audit** : ne **pas** abstraire en `AlgoStrategyRunner` partagé —
documenter le miroir et converger par **copie consciente**. Toute PR qui modifie
`crypto-algo/strategy/strategy-runner.ts` (ou l'entry pipeline) doit indiquer si le
même fix s'applique à weather (convention `[mirror: weather-algo/…]`).

Détail weather : [`code/08-weather-algo.md`](./code/08-weather-algo.md) § Miroir crypto-algo.

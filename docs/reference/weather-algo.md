# Package `@polywatch/weather-algo` — Trading algorithmique météo

Module d'automatisation pour les marchés **température** Polymarket : sélection
par **ville**, prévisions Open-Meteo multi-modèles (stratégies forecast) ou
**consensus marché** (stratégie `weather-highest-yes`, sans forecast), BUY YES
sur le palier choisi par la stratégie active, sorties drift / bucket.

---

## 1. Vue d'ensemble

```
Villes surveillées (WeatherAutoTrackRule)
        │
        ▼
StrategyRunner (poll weatherAlgoPollMs)
        │  1. ExitEvaluator (sorties d'abord)
        │  2. discoverWeatherMarkets + forecast
        │  3. evaluateGroup par stratégie active (catalogue, first-wins)
        │  4. dedupSignalsByCityDate + applySelectionMode
        ▼
runWeatherEntryPipeline → weather-order-signals
        │
        ▼
worker Executor
```

**Unité de sélection** = ville + date cible (+ horizon). **Unité d'exécution** = sous-marché
(palier) choisi automatiquement. **Au plus `maxPositionsPerCityDate` positions ouvertes par triplet (ville, date cible, stratégie)** (défaut 1).

Positions rattachées à une watchlist sentinelle weather-algo. Snapshot forecast
d'entrée dans `WeatherPositionForecast`. Comme `crypto-algo`, l'adresse
sentinelle n'est pas pollée par le MoveDetector Data API.

---

## 2. Processus

| Composant | Cadence | Rôle |
|-----------|---------|------|
| `WeatherStrategyRunner` | `weatherAlgoPollMs` (défaut 30 min), **aligné sur une grille UTC** | Sorties puis entrées city-follow. Chaque cycle est planifié sur le prochain multiple de `pollMs` depuis minuit UTC (`Math.ceil(now/pollMs)×pollMs`), indépendant de l'heure de démarrage et stable d'un redémarrage à l'autre (ex. 15 min → :00/:15/:30/:45 UTC). Au boot, une passe d'exit **immédiate** réévalue les positions ouvertes (reprise) mais **aucun** cycle d'entrée n'est déclenché — le premier cycle complet se fait au prochain créneau aligné. Un cycle immédiat est en revanche forcé sur `config-changed` pour appliquer la config à chaud. |
| `WeatherExitEvaluator` | début de chaque cycle | Drift + bucket-exit (hysteresis) |
| `runWeatherEntryPipeline` | sur signal | Gate throttle re-entry + enqueue `WEATHER_OPEN` |
| Heartbeat / runtime-status | 30 s | Redis `weather-algo:heartbeat`, `weather-algo:runtime-status` |

Le polling du `WeatherStrategyRunner` est **phasé sur une grille horaire fixe** :
chaque cycle est planifié sur le prochain multiple de `weatherAlgoPollMs` depuis
minuit UTC (`Math.ceil(now/pollMs)×pollMs`), et non sur un intervalle relatif au
démarrage. Les polls tombent donc sur des créneaux stables et « propres » (ex.
15 min → :00/:15/:30/:45 UTC), indépendamment de l'heure de lancement du
process et sans dérive d'un redémarrage à l'autre. Au boot, une **passe d'exit
immédiate** réévalue les positions ouvertes (reprise), mais le premier cycle
complet s'exécute au prochain créneau aligné. Un changement de
config (`config-changed`) recrée le timer, le ré-aligne sur le prochain
créneau, **et** déclenche un cycle d'évaluation immédiat pour appliquer la
nouvelle config sans attendre.

Les sorties tournent **même si `weatherAlgoEnabled = false`** (positions ouvertes).

---

## 3. Stratégie & sorties

**Entrée** : pour chaque ville surveillée (métrique v1 = `highest_temp`), la
stratégie active choisit son bucket via `evaluateGroup` :
- **`weather-forecast`** (défaut live) : `pickBestEdgeBucket` — palier à plus
  grand edge YES parmi les buckets actifs ;
- **`weather-forecast-aligned`** : `selectForecastAlignedBucket` — palier dont
  la fourchette contient le forecast mean ;
- **`weather-highest-yes`** : bucket au **prix YES le plus élevé**
  (`yesPrice` ≥ `bag.minYesPrice`, défaut `0.5`) — consensus marché, **sans
  forecast** ; le signal porte `edge=0` et `confidence = min(1, yesPrice)`.
  - **`maxYesPrice`** (défaut `null` = désactivé) : plafond anti-fade — refuse d'entrer si `yesPrice > maxYesPrice` (upside vers la résolution trop fin). Abstention `yes_price_above_max`.
  - **`allowedComparisons`** (défaut `null` = toutes) : restreint les types de paliers éligibles (`exact`/`between`/`or_above`/`or_below`). Exclure `or_above`/`or_below` évite le biais de sur-achat (leur prix YES est cumulativement gonflé). Abstention `comparison_not_allowed`.

Puis **BUY YES uniquement** si l'edge dépasse le seuil dynamique (stratégies
forecast) **ou**, pour `weather-highest-yes`, si le prix YES atteint le seuil
`minYesPrice`. Plusieurs stratégies peuvent être activées (ordre catalogue =
priorité first-wins). Modes `single` / `multi` entre **villes** (`spread`
ignoré → traité comme `single`).

**Mode `single` (défaut)** : sélectionne **une seule paire (ville, date cible)** —
celle dont le signal a l'`edge` maximal — puis émet **tous les lanes gagnants**
(stratégies) pour cette paire. Cela permet à `weather-highest-yes` (edge=0)
d'être sélectionné comme fallback sur une date où aucune stratégie forecast
n'a de signal, au lieu d'être masqué par un signal forecast sur une *autre*
date de la même ville.

**Mode `multi`** : garantit au moins un signal par stratégie émettrice, puis
remplit les slots restants par edge descendant (max `weatherAlgoMaxSignalsPerEvent`).

**UI** : onglet **Stratégies** (checkboxes d'activation ; priorité first-wins =
ordre du catalogue, pas l'ordre de cochage). Params JSON
`weatherAlgoStrategies` / `weatherAlgoStrategyParams` — catalogue partagé dans
`@polywatch/core` (`strategy-catalog.ts`). **Chaque stratégie porte sa propre
config complète** (gates d'entrée, sizing, sorties, SL/TP/trailing, risk
limits, kill-switch) dans `weatherAlgoStrategyParams[strategyId]`.
Les colonnes `weatherAlgo*` legacy ne servent plus que de **fallback** au
backfill (migration `0107`/`0108`) et ne sont plus modifiables via l'API
(`weatherConfigUpdateSchema` rejette les champs per-strategy via `.strict()`).
Onglet **Paramètres** : uniquement les globaux structurels (toggles, `pollMs`,
`selectionMode`, `maxSignalsPerEvent`, recording/retention, `simInitialCapital`).
Les knobs nullables (`maxForecastStd`, `minForecastProbability`, `slPercent`,
`tpPercent`, `trailingPercent`, `trailingActivationPercent`) utilisent
`NullableNumberField` en UI — une valeur vide = `null` (désactivé) ; une
valeur `0` stockée est coercée à `null` au runtime par `getStrategyParams`.

**SL/TP/Trailing en pourcentage de la mise investie** : pour le weather-algo,
les seuils SL (`slPercent`), TP (`tpPercent`) et trailing (`trailingPercent` /
`trailingActivationPercent`) sont exprimés en **pourcentage du cost basis**
(prix d'entrée + frais) — la "mise investie" — et non en distance absolue de
prix (`bid points`). Le copy-trading et le crypto-algo utilisent la même
convention en pourcentage. SL déclenche quand le closure PnL ≤ `-slPercent` ;
TP quand ≥
`tpPercent` **et** trigger PnL ≥ 0 ; trailing arme quand le closure PnL ≥ `trailingActivationPercent`
et déclenche quand le drawdown depuis le pic de closure PnL ≥ `trailingPercent`.
Les défauts (`WEATHER_EXIT_DEFAULTS`) sont `slPercent: 20`, `tpPercent: 25`,
`trailingPercent: 10`, `trailingActivationPercent: 12`. Sur `CopiedPosition`,
les colonnes `sl_percent`/`tp_percent`/`trailing_percent`/
`trailing_activation_percent` stockent les seuils résolus à l'entrée.

**Sizing** : deux modes via `bag.sizingMode` — `fixed_usdc` (défaut, `bag.entryUsdc` USDC) ou `fixed_shares` (`bag.fixedShareCount` parts).

**Sorties** (paramètres lus depuis le bag de la stratégie d'origine, via
`snapshot.strategyId ?? pos.strategyId` ; legacy `null` → fallback
`resolveEnabledWeatherStrategies(risk)[0] ?? 'weather-forecast'`) :
- `WEATHER_FORECAST_CHANGE` si `|currentMean - entryMean| > bag.forecastChangeThreshold` — **non évaluée pour `weather-highest-yes`**
- `WEATHER_BUCKET_EXIT` si forecast hors palier **et** `bag.cityFollowSwitchMode = close_and_reenter` **après** `bag.bucketHysteresisPolls` polls consécutifs ; en mode `hold`, pas de close pour bucket leave — **non évaluée pour `weather-highest-yes`**
- Après close bucket/drift : throttle Redis `weather-reentry:{city}:{dateIso}:{mode}` pendant `bag.reentryThrottleMs`
- **Cap `maxReentriesPerCityDate`** (défaut 2) : nombre max d'entrées cumulées par (ville, date, stratégie, mode). `0` = illimité. Clé Redis `weather-entry-count:{city}:{dateIso}:{strategyId}:{mode}`.
- `reentryThrottleAfterSlMs` (défaut 30 min) : throttle spécifique posé par le **worker** (`position-exit-evaluator.ts`) après une sortie SL, distinct du throttle bucket/drift posé par l'exit evaluator. `0` = désactivé.

> **`weather-highest-yes`** (sans forecast) : drift (`WEATHER_FORECAST_CHANGE`)
> et bucket-exit (`WEATHER_BUCKET_EXIT`) sont **désactivés** — la position est
> tenue jusqu'à résolution. Seuls SL/TP/trailing (worker) s'appliquent. L'exit
> evaluator skip le fetch forecast pour cette stratégie (évite une fermeture
> fantôme via `entryForecastMean=0`).

**Kill-switch** : le `bag.killSwitchAction` (`block_entries` | `force_close_all` |
`block_and_notify`) est évalué **par stratégie** — le PnL journalière est
filtrée par `p.strategyId` dans `RiskService.checkKillSwitch`. L'entry pipeline
(`runMode`) appelle `checkKillSwitch('weather', mode, signal.strategyId)` avant
reserve ; si `blockEntries` → skip avec raison `'Kill-switch actif
(block_entries)'`. `force_close_all` reste géré par le `KillSwitchMonitor` du
worker (ferme uniquement les positions de la stratégie concernée). Les
limites `maxDailyLossUsdc` / `maxExposureUsdc` / `maxOpenPositions` /
`maxPositionSizeUsdc` sont aussi **par stratégie** — la réservation
(`ReservationService`) filtre positions et réservations par `strategyId`.

**Autres knobs per-strategy** (défauts `DEFAULT_WEATHER_STRATEGY_PARAMS`) :

| Knob | Défaut | Rôle |
|------|--------|------|
| `minTimeToClose` | `0` s | Temps minimum avant fermeture. |
| `minBidToAskRatio` | `0.9` | Ratio bid/ask minimum requis. |
| `signalScoreSizingEnabled` | `true` | Sizing par score de signal. Note : le weather force `multiplier: 1`, donc sans effet sur la taille. |
| `allowedMarketTags` | `[]` | Filtre des tags marché autorisés. |

---

## 4. Capacités

| Capacité | État |
|----------|------|
| Sélection par ville | Actif |
| BUY YES sur bucket forecast | Actif |
| BUY YES sur bucket au prix YES max (consensus, sans forecast) | Actif |
| Max positions par ville+date+stratégie (`maxPositionsPerCityDate`, défaut 1 ; `pending`/`open`/`closing`) | Actif |
| Sorties avant entrées (même cycle) | Actif |
| Close drift forecast | Actif |
| Pré-clôture avant résolution | Retiré |
| Bucket-exit `close_and_reenter` / `hold` | Actif |
| Hysteresis Redis `weather-bucket-hysteresis:{positionId}` | Actif |
| Re-entry throttle `weather-reentry:{city}:{dateIso}:{mode}` | Actif |
| Métrique forcée `highest_temp` | Actif |
| Expand / follow par `conditionId` | Retiré |
| `add_position` | Hors scope (coercé → `close_and_reenter`) |
| Persistance snapshots / ticks / eval / forecast history | Actif (toggles ON par défaut) |
| Onglet UI Données (cards, drill-down, purge) | Actif |
| Onglet UI **Backtest** (lancer runs, métriques, equity, positions) | Actif (domaine weather) |
| Onglet UI **Stratégies** (catalogue, activation, params) | Actif |
| Onglet UI **Villes → Données télécharger** (ingestion historique CLOB) | Actif |

---

## 5. Persistance données (backtest / audit)

Enregistrement **best-effort** pendant les cycles du runner (toggles ON par défaut) :

| Table | Contenu |
|-------|---------|
| `weather_forecast_history` | Révisions forecast (fetch réel uniquement) |
| `weather_market_snapshots` + `weather_bucket_ticks` | Contexte marché + prix YES/NO buckets actifs |
| `weather_evaluation_log` | Décisions signal/abstain |

Purge automatique **désactivée** (sur demande utilisateur). Cleanup manuel via l'UI (onglet **Données**) ou l'API.

**UI** : page Weather Algo → onglet **Données** (cards, cadence, drill-down, purge) ; toggles dans **Paramètres**.

Doc d’implémentation : [`weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md`](../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md).

### Ingestion historique CLOB (onglet Villes → Données télécharger)

Depuis l'onglet **Villes**, la section **Données télécharger** permet de charger en base l'historique des prix YES/NO des buckets météo d'une ville sur une période, via l'API CLOB Polymarket `/prices-history` (`startTs`/`endTs` + `fidelity`). Service : `WeatherHistoryIngestService` ; routes `/api/weather-algo-history/*` ; tables `weather_clob_price_history` + `weather_history_ingest_jobs`.

- **Découverte** : buckets de la ville sur la période via Gamma (`tag_slug=weather`, `closed`/`open`, `end_date_min/max`).
- **Fetch** : pour chaque bucket, YES et NO, `fetchPriceHistory({ assetId, startTs, endTs, fidelity })` (throttlé).
- **Persistance** : upsert idempotent (index unique `condition_id, side, recorded_at, fidelity_minutes, metric`) — relancer ne crée pas de doublons ; plusieurs intervalles (15 min, 1 h, …) peuvent coexister pour la même ville/date. Suppression ciblée par intervalle via `deleteCityInterval(city, fidelityMinutes)`.
- **Contraintes CLOB** : `startTs` + `endTs` obligatoires (sans `startTs` → HTTP 400). `startDate` dérivé du champ Gamma `startDate` (l'API ne renvoie plus `eventStartTime`) ; en dernier recours, fenêtre de 7 jours avant `endTs`. Granularité `fidelity` en minutes (testé jusqu'à 1 min). L'historique des marchés météo quotidiens (depuis ~mars 2026) reste disponible.
- **Limites** : série de prix `(t, p)` uniquement — pas d'order book, pas de volume/trades, pas d'OHLCV natif. Fenêtre de vie d'un bucket météo = quelques jours.
- **Point de settlement synthétique** : `/prices-history` ne renvoie **jamais** le payoff post-résolution (1.00 gagnant / 0.00 perdant, fixé par l'oracle). Pour un marché **résolu**, le service ajoute un point final synthétique à la série afin que le bucket gagnant atteigne 1.00. Le gagnant est détecté via `outcomePrices` (fast path, gate `closed`/`acceptingOrders`) ou via `fetchGammaMarket` (slow path, gate `gamma.resolved`). Le point est horodaté **après** le dernier trade de la série (jamais avant), pour rester le dernier point de la courbe.
- **Marge de résolution** : la fenêtre de fetch est étendue de `48 h` au-delà de `endDate` (`RESOLUTION_MARGIN_SEC`), car les marchés météo ne se règlent qu'après publication du résultat officiel — sans cette marge, le point de résolution serait coupé.
- **Affichage timeline** : les vues timeline (`getClobPriceHistoryTimeline` / `getBucketTicksTimeline`) récupèrent les `maxTicks` points **les plus récents** (tri DESC) puis les re-trient chronologiquement, pour ne jamais tronquer la queue de résolution.
- **Filtrage / suppression par intervalle — `weather_bucket_ticks`** : comme pour le CLOB, la timeline bucket accepte un filtre `fidelityMinutes` (sélecteur « Intervalle » **obligatoire** dans l'UI, pas d'option « Tous »), et la suppression ciblée **ville × intervalle** est possible via `deleteBucketTickCityInterval(city, fidelityMinutes)` (route `DELETE /api/weather-algo-data/bucket-ticks/interval?city=&fidelityMinutes=`). En backtest, `fidelityMinutes` (paramètre optionnel) filtre les `book_tick` — cf. [`backtest.md`](./backtest.md).

**Résolution `weather-highest-yes` en backtest** : la stratégie n'utilise pas de
forecast — elle résout via le prix YES final du marché. Si le tick de résolution
n'a pas de `yesPrice`, l'adapter applique `tick.yesPrice` → `pos.markPrice`
(mis à jour à chaque `book_tick`). **Pas de fallback `entryPrice` depuis
`engineVersion` 0.6.0** (warning `resolution_no_price_whatsoever` si aucun prix).

Doc API : [`api.md`](./api.md) § Weather Algo history. Modèle : [`modele-donnees.md`](./modele-donnees.md).

Le **backtest** s'exécute désormais uniquement en **`runner-sim`** (consolidation 2026-08-24) : regroupement des buckets par ville/date, `evaluateGroup`, dedup et selectionMode comme le runner live. Le mode `strategy` (ré-évaluation bucket par bucket, non équivalent live) a été retiré du moteur ; le champ `backtestExecutionMode` reste accepté par le schéma pour rétro-compat API mais est **ignoré**.

Voir [`backtest.md`](./backtest.md) (`engineVersion` ≥ `0.8.0` — entrée runner-sim
horodatée à la décision, coalesce 1 s, gardes marché résolu / prix stale / SL immédiat,
flush avant gardes, pairing `decidedAt`, `fill_price_clamped` après garde SL).

---

## 6. API & config

- Routes trading : [`api.md`](./api.md) § Weather Algo
- Routes données : [`api.md`](./api.md) § Weather Algo data (`/api/weather-algo-data/*`) et § Weather Algo history (`/api/weather-algo-history/*`)
- Routes backtest : [`api.md`](./api.md) § Backtest (`/api/backtest/*`) ; moteur : [`backtest.md`](./backtest.md)
- Config : [`configuration.md`](./configuration.md) § Weather Algo ; entité `WeatherConfig` ; présentation API `packages/core/src/risk/weather-config-api.ts`. **Per-strategy** : `WeatherStrategyParamsBag` + `getStrategyParams` dans `packages/core/src/weather/strategy-catalog.ts` ; getters `policy.ts` (`getWeatherMaxOpenPositions(cfg, mode, strategyId)`, etc.).
- Sorties / defaults intervalle : `packages/core/src/risk/weather-exit-params.ts` (`resolveWeatherEntryExitParams(risk, mode, marketInterval, strategyId)`)
- Kill-switch weather : `packages/core/src/services/risk.service.ts` (`checkKillSwitch('weather', mode, strategyId)`) ; gate entry : `packages/weather-algo/src/processors/weather-entry-pipeline.ts` `runMode`
- Redis : `weather-reentry-throttle.ts`, `weather-bucket-hysteresis.ts`
- Entités : [`modele-donnees.md`](./modele-donnees.md)
- Backtest : [`backtest.md`](./backtest.md)
- Détail technique package : [`../code/08-weather-algo.md`](../code/08-weather-algo.md)

Démarrage : `npm run dev:weather-algo` ou `npm run dev`.

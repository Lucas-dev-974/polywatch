# Configuration & exploitation

## 1. Variables d'environnement

Le fichier `.env` est chargé depuis la **racine du monorepo** par
`loadMonorepoEnv()` (`packages/core/src/config/env.ts`), qui localise la racine
en remontant jusqu'au `package.json` nommé `polywatch`. Partir de
[`.env.example`](../.env.example).

| Variable | Defaut | Utilise par | Description |
|----------|--------|-------------|-------------|
| `DATABASE_URL` | — | tous | URL PostgreSQL (obligatoire, ex: `postgresql://polywatch:polywatch@localhost:5432/polywatch`) |

| `BYPASS_SECRET_SECURITY` | `false` | backend | Si `true`, desactive les verifications de securite des secrets en local dev |
| `POLYGONSCAN_API_KEY` | — | backend / worker | Cle d'API Polygonscan pour l'historique on-chain (optionnel) |
| `JWT_SECRET` | dev fallback | backend | Secret de signature des access tokens (>= 32 car.) |
| `JWT_REFRESH_SECRET` | dev fallback | backend | Secret des refresh tokens |
| `SERVICE_TOKEN` | dev fallback | backend, worker, copy-trading, crypto-algo, weather-algo | Jeton d'auth des routes internes (`x-service-token`) |
| `MASTER_ENCRYPTION_KEY` | dev fallback | backend | Cle AES-256-GCM : 64 car. hex (sortie de `npm run generate-secrets`, recommande) ou chaine UTF-8 de 32 bytes (legacy — acceptee mais un `warn` est logue au boot) |
| `REDIS_URL` | `redis://localhost:6379` | backend, worker, copy-trading, crypto-algo, weather-algo | Connexion Redis |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | backend | Whitelist CORS (Express + Socket.IO), origines separees par des virgules |
| `PORT` | `3000` | backend | Port HTTP |
| `NODE_ENV` | `development` | backend | Affecte le rate-limit (1000 req/min ; les appels internes via `x-service-token` sont exemptes) |
| `BACKEND_URL` | `http://localhost:3000` | worker, copy-trading, crypto-algo, weather-algo | URL backend pour les callbacks internes |
| `WAIT_BACKEND_TIMEOUT_MS` | `60000` | scripts `dev:*` | Timeout d'attente `/health` avant démarrage frontend / workers |
| `BACKTEST_MARKETS_SERIES_LIMIT` | `500` | backend | Plafond de marchés renvoyés par `/api/backtest/markets-series` et `/runs/:id/markets-series` |
| `ADMIN_USERNAME` | `admin` | backend (seed) | Identifiant admin initial |
| `ADMIN_PASSWORD` | `changeme` | backend (seed) | Mot de passe admin initial |
| `POLYMARKET_DATA_API` | `https://data-api.polymarket.com` | backend, copy-trading | API positions/leaderboard (polling traders) |
| `POLYMARKET_GAMMA_API` | `https://gamma-api.polymarket.com` | backend, core | API metadonnees marches |
| `POLYMARKET_CLOB_API` | `https://clob.polymarket.com` | worker, core, copy-trading, crypto-algo | API order book / trading |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | worker, copy-trading, crypto-algo | WebSocket order book |
| `POLYMARKET_WS_USER_URL` | derive de `POLYMARKET_WS_URL` (`/ws/user`) | worker | WebSocket fills/ordres async (auth L2) |
| `MARKET_TICK_RETENTION_DAYS` | `30` | worker | Rétention des ticks `market_position_ticks` (jours) — *purge automatique désactivée* (voir note ci-dessous) |
| `MARKET_PRICE_TICK_RETENTION_DAYS` | `0` (pas de purge) | worker | Rétention des ticks `market_price_ticks` (jours) ; `0` = pas de purge |
| `MARKET_TICK_THROTTLE_MS` | `500` | worker | Throttle de persistance des ticks par asset (ms) |
| `MARKET_TICK_REF_QTY` | `100` | worker | Quantite de reference pour le calcul des VWAP executables stockes dans les ticks |
| `CRYPTO_ALGO_POLL_MS` | `30000` | crypto-algo | Frequence de polling pour le StrategyRunner (ms) |
| `ALGO_PRICE_TICK_REF_QTY` | `50` | crypto-algo | Quantite de reference pour les ticks de prix algo |
| `WEATHER_ALGO_POLL_MS` | `1800000` | weather-algo | Fréquence de polling pour le StrategyRunner météo (ms, defaut 30min) |
| `WEATHER_FORECAST_CACHE_TTL_MS` | `3600000` | weather-algo | TTL du cache de prévisions Open-Meteo (ms, defaut 1h) |
| `ALLOW_SYNCHRONIZE_PROD` | — | core | Si present, autorise `synchronize: true` en production (dangereux, reserve debug) |
| `SIM_EXECUTION_LATENCY_MS` | — | core / worker | Surcharge de la latence d'execution simulee (ms) ; ecrase la valeur de `GlobalConfig.simExecLatencyMs` |
| `POLYGON_RPC_URL` | `https://polygon-bor-rpc.publicnode.com` | core | URL RPC Polygon pour les verifications on-chain |
| `POLYMARKET_BRIDGE_URL` | `https://bridge.polymarket.com` | backend | URL du bridge Polymarket |
| `REDIS_SENTINEL_NAME` | — | core | Nom du master Redis Sentinel (si deploiement Sentinel) |
| `REDIS_SENTINEL_HOSTS` | `127.0.0.1:26379` | core | Hotess Redis Sentinel (separes par des virgules) |
| `REDIS_SENTINEL_PASSWORD` | — | core | Mot de passe Redis Sentinel (fallback sur `REDIS_PASSWORD`) |
| `REDIS_PASSWORD` | — | core | Mot de passe Redis (utilise aussi par Sentinel) |
| `REDIS_DB` | `0` | core | Index de base Redis |
> **Production** : changer imperativement tous les secrets. Les valeurs par
> defaut « dev fallback » ne doivent jamais etre utilisees en production.

> **Note — purge automatique des ticks désactivée** : la purge horaire par
> batches de `market_position_ticks` et `market_price_ticks` a été désactivée
> dans le worker (cf. `packages/worker/src/index.ts`). `MARKET_TICK_RETENTION_DAYS`
> reste la rétention théorique mais n'est plus appliquée automatiquement ; un
> nettoyage manuel via API/scripts reste possible.

## 2. Configuration isolée (4 tables)

Répartie en `global_config`, `copy_config`, `crypto_config`, `weather_config`, modifiable via `GET/PUT /api/config/{global|copy|crypto|weather}` (UI : page Réglages / heroes). Voir [`modele-donnees.md`](./modele-donnees.md) pour le détail des colonnes. Paramètres notables :

| Parametre | Effet |
|-----------|-------|
| `realTradingEnabled` | Active globalement le mode reel (sinon `real` ignore) |
| `simCopyTradingEnabled` | Active globalement le copy-trading en mode sim (sinon les entrees sim ignorees) |
| `maxOpenPositions` / `simMaxOpenPositions` / `realMaxOpenPositions` | Limites de positions ouvertes (globale et par mode) |
| `maxExposureUsdc` / `simMaxExposureUsdc` / `realMaxExposureUsdc` | Plafond d'exposition total (globale et par mode) |
| `maxDailyLossUsdc` / `simMaxDailyLossUsdc` / `realMaxDailyLossUsdc` | Perte maximale journaliere (globale et par mode) |
| `maxPositionSizeUsdc` / `simMaxPositionSizeUsdc` / `realMaxPositionSizeUsdc` | Taille maximale par position (globale et par mode) |
| `maxSlippagePercent` | Garde-fou de slippage a l'execution (ecart fill vs `referenceVwap` ask) ; sim et reel ; **modifiable UI** dans Parametres env (onglet Risk) et Configuration Crypto Algo (onglet General). Seul le slippage **defavorable** bloque (BUY plus cher / SELL plus bas que la reference) : un fill plus avantageux passe toujours. **Les sorties forcees (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `KILL_SWITCH`) ne sont pas bloquees par le slippage guard** : en marche illiquide elles peuvent donc s'executer sous le `lastTradePrice` connu, au prix d'un fill plus eloigne du bid affiche. |
| `exitSlippageGuardPercent` | Garde-fou de slippage specifique aux sorties (defaut 50%). Applique aux sorties forcees. |
| `slConfirmationTicks` | Nombre d'evaluations consecutives ou la condition SL doit etre vraie avant d'emettre le signal (defaut 2). Evite les faux positifs sur micro-pics de liquidite. |
| `simMinBidToAskRatio` / `realMinBidToAskRatio` | Ratio **bid VWAP / ask VWAP** minimum pour autoriser une **entree** copiee (`0` = filtre desactive ; defaut `0.9`) ; UI : **Configurer** -> onglet Entree |
| `simEntryDepthRetryMax` / `realEntryDepthRetryMax` | Retries si profondeur ask insuffisante pour la taille cible (defaut 3) |
| `simEntryDepthRetryDelayMs` / `realEntryDepthRetryDelayMs` | Delai entre retries profondeur en ms (defaut 1000) |
| `sim*` / `real*` SizingMode + montants | Calcul de la taille des copies |
| `simSizingMode` / `realSizingMode` | Mode de sizing copy trading : `fixed_ratio`, `fixed_usdc`, `fixed_shares`, `proportional_capital`, `kelly_fractional`, `risk_based` |
| `cryptoAlgoSizingMode` | Mode de sizing crypto-algo : `fixed_usdc`, `fixed_shares` (defaut `fixed_usdc`) |
| `cryptoAlgoEntryUsdcAmount` | Montant fixe d'entree crypto-algo en USDC (defaut 10) |
| `cryptoAlgoEntryShareCount` | Nombre fixe de shares par entree crypto-algo (nullable, pour mode `fixed_shares`) |
| `simCopyRatio` / `realCopyRatio` | Ratio de copie (multiplicateur de la taille du trader) |
| `simEntryUsdcAmount` / `realEntryUsdcAmount` | Montant fixe d'entree en USDC (mode `fixed_usdc`) |
| `simEntryShareCount` / `realEntryShareCount` | Nombre fixe de shares par entree (mode `fixed_shares`, defaut 5) |
| `simKellyFraction` / `realKellyFraction` | Fraction de Kelly pour le sizing (defaut 0.25) |
| `simRiskBudgetUsdc` / `realRiskBudgetUsdc` | Budget de risque en USDC (mode `risk_based`) |
| `simDefaultWinProbability` / `realDefaultWinProbability` | Probabilite de gain par defaut (mode Kelly, defaut 0.55) |
| `simInitialCapitalCrypto` | Capital initial sim **crypto** (pUSD). Préremplit le dialog de reset crypto ; mis à jour au reset de ce kind. |
| `simInitialCapitalWeather` | Capital initial sim **weather** (pUSD). Idem pour le périmètre weather. |
| `simInitialCapitalCopy` | Capital initial sim **copy** (pUSD). Idem pour le périmètre copy. |
| `simInitialCapital` | **Déprécié** (compat DB) — alias lecture API = `simInitialCapitalCrypto`. Préférer les trois champs ci-dessus. |
| `realCashOverride` | Surcharge manuelle du cash reel disponible (null = fetch on-chain) |
| `*SlPercent` / `*TpPercent` / `*TrailingPercent` | Declencheurs de sortie SL/TP/trailing en **pourcentage de la mise investie** (0-100). En marche illiquide, le dernier prix trade connu (`last_trade_price` du canal WS CLOB) est utilise comme reference conservatrice pour que le SL/trailing/kill-switch puisse se declencher meme si le bid affiche est un niveau fige. |
| `simSlEnabled` / `realSlEnabled` | Active/desactive le stop-loss pour le mode |
| `simTpEnabled` / `realTpEnabled` | Active/desactive le take-profit pour le mode |
| `simSlPercent` / `realSlPercent` | Stop-loss en % de la mise investie (defaut 20) |
| `simTpPercent` / `realTpPercent` | Take-profit en % de la mise investie (defaut 25) |
| `simSlCloseMaxRetries` / `realSlCloseMaxRetries` | Nombre maximum de tentatives automatiques de cloture pour les sorties forcees (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `KILL_SWITCH`) qui echouent avec `no_liquidity`, `order_not_matched` ou `tick_size_fetch_failed`. Defaut `5`. Le TP n'est pas retente automatiquement. |
| `simTrailingEnabled` / `realTrailingEnabled` | Active/desactive le trailing stop |
| `simTrailingPercent` / `realTrailingPercent` | Trailing stop en % de la mise investie (defaut 10) |
| `simTrailingActivationPercent` / `realTrailingActivationPercent` | Seuil d'activation du trailing en % de la mise investie (defaut 12, 0 = des l'entree) |
| `preCloseEnabled` / `simPreCloseEnabled` / `realPreCloseEnabled` | Active la logique de pre-cloture (globale et par mode) |
| `preCloseSeconds` / `simPreCloseSeconds` / `realPreCloseSeconds` | Fenetre en secondes avant `endDate` (defaut : 60) |
| `simPreCloseKeepEnabled` / `realPreCloseKeepEnabled` | Si active (`false` par defaut), les positions dont le bid est superieur au seuil `keepBidThreshold` restent ouvertes jusqu'a la resolution. Seules les positions sous le seuil sont pre-cloturees. |
| `simPreCloseKeepBidThreshold` / `realPreCloseKeepBidThreshold` | Seuil de bid (en points de probabilite) pour le keep. Si le bid de la position est >= ce seuil, la position est conservee (defaut 0.80). |
| `simMinTimeToClose` / `realMinTimeToClose` | Secondes minimum avant cloture pour autoriser une entree |
| `copyIncreaseEnabled` / `copyDecreaseEnabled` | Replication des inc/dec (global) |
| `simCopyIncreaseEnabled` / `realCopyIncreaseEnabled` | Replication des augmentations par mode |
| `simCopyDecreaseEnabled` / `realCopyDecreaseEnabled` | Replication des diminutions par mode |
| `maxIncreasesPerPosition` / `simMaxIncreasesPerPosition` / `realMaxIncreasesPerPosition` | Plafond d'augmentations (0 = illimite) |
| `simAllowedMarketTags` / `realAllowedMarketTags` | Whitelist de slugs Gamma pour filtrer les **entrees** copiees par type de marche (`[]` = tous) ; configurable separement en sim et reel (UI : **Configurer** -> onglet Entree) |
| `simMomentumFilterEnabled` / `realMomentumFilterEnabled` | Refuse la copie si le ask VWAP est inferieur au prix moyen du trader (position deja sous l'eau) ; desactive par defaut |
| `simCopyIncreaseSlProximityEnabled` / `realCopyIncreaseSlProximityEnabled` | Bloque les augmentations quand la position est proche du seuil SL |
| `simCopyIncreaseSlProximityPercent` / `realCopyIncreaseSlProximityPercent` | Pourcentage du seuil SL (ex: 80 = bloque a 80% de la distance SL) |
| `simSignalScoreSizingEnabled` / `realSignalScoreSizingEnabled` | Ajuste la taille d'entree selon le score de qualite du signal (active par defaut) |
| `killSwitchAction` / `simKillSwitchAction` / `realKillSwitchAction` | `block_entries` \| `force_close_all` \| `block_and_notify` (global et par mode) |
| `moveDetectorIntervalMs` | Intervalle du detecteur de mouvements (ms, defaut 2000) |
| `simAutoSnapshotEnabled` | Active les snapshots automatiques de simulation |
| `simAutoSnapshotIntervalSeconds` | Intervalle entre snapshots auto (secondes, min 60) |
| `simAutoSnapshotEmptySession` | Autorise un snapshot meme sans position ni execution (archive config-only) |
| `simSnapshotDecisionWindowHours` | Fenetre glissante (heures) pour exit attempts / move events dans les archives (defaut 24) |
| `simSnapshotMaxCount` | Nombre max de snapshots conserves (null = illimite) |
| `simSnapshotRetentionDays` | Supprime les snapshots plus vieux que N jours (null = pas de purge) |
| `realAutoSnapshotEnabled` | Active les snapshots automatiques en mode reel |
| `realAutoSnapshotIntervalSeconds` | Intervalle entre snapshots auto reels (secondes, min 60) |
| `realSnapshotDecisionWindowHours` | Fenetre glissante (heures) pour les archives reelles (defaut 24) |
| `realSnapshotMaxCount` | Nombre max de snapshots reels conserves (null = illimite) |
| `realSnapshotRetentionDays` | Supprime les snapshots reels plus vieux que N jours (null = pas de purge) |
| `cryptoAlgoSlQuotaEnabled` | Active le quota SL par marche (defaut `false`). Slots consommes des le declenchement SL ; max 1 position algo ouverte par marche ; blocage cross-outcome. |
| `cryptoAlgoSlQuotaPerMarket` | Nombre max de sorties SL declenchees avant blocage des nouvelles entrees (defaut `1`). |
| `cryptoAlgoSlQuotaCacheTtlSeconds` | TTL du cache compteur SL en secondes (defaut `30`). Evite de frapper la DB a chaque cycle. |

Migration : `AddCryptoAlgoSlQuotaConfig1700000000044` (colonnes sur `crypto_config` post-split).

#### Weather Algo (`weatherAlgo*`)

Parametres du trading algorithmique meteo, stockes dans `weather_config` et modifiables via `GET/PUT /api/config/weather` (UI : page Weather Algo). Voir aussi [`weather-algo.md`](./weather-algo.md).

**Architecture config** : depuis la refonte per-strategy, les paramètres sont
répartis en deux catégories :

1. **Globaux structurels** (colonnnes `weather_config`, onglet **Paramètres**) :
   toggles d'activation, polling, sélection, recording/retention, capital sim.
   Modifiables via `PUT /api/config/weather` (`weatherConfigUpdateSchema`).

2. **Per-strategy et per-env** (`simWeatherAlgoStrategyParams` /
   `realWeatherAlgoStrategyParams` JSON, onglet **Stratégies** scindé sim/réel) :
   chaque stratégie activée porte sa config complète — gates d'entrée, sizing,
   sorties, SL/TP/trailing, risk limits, kill-switch, pre-close — **pour chacun
   des deux environnements**. Bag typé
   `WeatherStrategyParamsBag` (`packages/core/src/weather/strategy-catalog.ts`),
   résolu au runtime par `getStrategyParamsForMode(cfg, strategyId, mode)`.
   Catalogue des params déclaratifs servi par `GET /api/weather-algo/strategy-catalog`.

Les colonnes `weatherAlgo*` legacy (minEdge, entryUsdc, forecastChangeThreshold,
…) ne sont plus lues au runtime — elles servent uniquement de **source au
backfill** (migrations `AddWeatherStrategyId1700000000106` /
`BackfillWeatherStrategyParams1700000000107` /
`BackfillWeatherStrategyRepair1700000000108`). Les colonnes legacy
`weatherAlgoStrategies` / `weatherAlgoStrategyParams` sont **figées** (lecture
seule) : `weatherConfigUpdateSchema` (`.partial().strict()`) accepte les 4
champs per-env **et** ces 2 champs legacy (dépréciés : pas de 400, **retirés
du patch** avant persist). Tout autre knob legacy (`weatherAlgoMinEdge`, …) →
400. Seul le fallback de rétrocompat (snapshots backtest anciens, colonne
per-env `undefined`/`null`/`''`) relit les 2 colonnes figées.

##### Globaux structurels (onglet Paramètres)

| Parametre | Defaut | Effet |
|-----------|--------|-------|
| `weatherAlgoEnabled` | `false` | Active/desactive les **entrees** weather-algo (les sorties drift / bucket / pre-close restent evaluees pour les positions ouvertes) |
| `weatherAlgoSimEnabled` | `true` | Autorise les entrees en mode simulation |
| `weatherAlgoRealEnabled` | `false` | Autorise les entrees en mode reel (requiert aussi `realTradingEnabled`) |
| `weatherAlgoSelectionMode` | `single` | Mode de selection entre **villes** : `single` (meilleure ville), `multi` (top N villes). Toute valeur non reconnue retombe sur `single`. |
| `weatherAlgoMaxSignalsPerEvent` | `3` | Max villes en mode `multi` |
| `weatherAlgoPollMs` | `1800000` | Intervalle de polling du StrategyRunner (ms, defaut 30min, min 10_000). Les polls sont **alignés sur une grille horaire UTC** : chaque cycle est planifié sur le prochain multiple de `weatherAlgoPollMs` depuis minuit UTC (`Math.ceil(now/pollMs)×pollMs`), indépendant de l'heure de démarrage (ex. 15 min → :00/:15/:30/:45 UTC), stable d'un redémarrage à l'autre. Au boot, une **passe d'exit immédiate** réévalue les positions ouvertes (reprise) mais aucun cycle d'entrée n'est déclenché : le premier cycle complet se fait au prochain créneau aligné. Hot-reload : le timer est recréé à chaud et ré-aligné sur le prochain créneau ; un cycle d'évaluation **immédiat** est quand même lancé sur `config-changed` (`kind` weather/global/absent) pour appliquer la nouvelle config sans attendre. Anti-overlap + pendingRerun si un cycle est déjà en cours. Surcharge aussi via env `WEATHER_ALGO_POLL_MS` au démarrage. |
| `weatherAlgoStrategies` | `["weather-forecast"]` | **Legacy, lecture seule (figé)** — liste des stratégies activées (IDs catalogue : `weather-forecast`, `weather-forecast-aligned`, `weather-highest-yes`). Non écrit par l'API ; fallback backfill/rétrocompat. |
| `simWeatherAlgoStrategies` | `["weather-forecast"]` | Stratégies actives **mode sim** (ordre = priorité first-wins) |
| `realWeatherAlgoStrategies` | `["weather-forecast"]` | Stratégies actives **mode real** (ordre = priorité first-wins) |
| `simWeatherAlgoStrategyParams` | `{}` | Map params par stratégie **mode sim** |
| `realWeatherAlgoStrategyParams` | `{}` | Map params par stratégie **mode real** |
| `weatherAlgoForecastHistoryRecordingEnabled` | `true` | Enregistre `weather_forecast_history` a chaque fetch Open-Meteo reel |
| `weatherAlgoMarketSnapshotRecordingEnabled` | `true` | Enregistre snapshots + bucket ticks a chaque cycle |
| `weatherAlgoEvaluationLogRecordingEnabled` | `true` | Enregistre le journal d'evaluation (signal/abstain) |
| `weatherAlgoForecastHistoryRetentionDays` | `90` | Retention purge horaire forecast history |
| `weatherAlgoMarketSnapshotRetentionDays` | `30` | Retention snapshots (cascade ticks) |
| `weatherAlgoEvaluationLogRetentionDays` | `90` | Retention evaluation log |
| `simInitialCapitalWeather` | — | Capital initial sim weather (pUSD) |

##### Per-strategy (onglet Stratégies → section de chaque stratégie)

Résolus via `getStrategyParamsForMode(cfg, strategyId, mode)` →
`WeatherStrategyParamsBag`, pour l'environnement sélectionné.
Knobs nullables (`slPercent`, `tpPercent`, `trailingPercent`,
`trailingActivationPercent`, `maxForecastStd`, `minForecastProbability`) :
UI `NullableNumberField` — vide/`0` = `null` (désactivé).

> **Distinction sim/real dans le bag weather** : depuis le plan per-env
> (2026-08-27), chaque environnement possède sa propre map params
> (`simWeatherAlgoStrategyParams` / `realWeatherAlgoStrategyParams`) et sa
> propre liste de stratégies. `getStrategyParamsForMode(cfg, strategyId, mode)`
> lit la map du `mode` demandé. Fallback legacy **uniquement** si la colonne
> per-env est `undefined` / `null` / `''` — `'[]'` / `'{}'` ne retombent pas
> (`'[]'` parse vers `['weather-forecast']`). Les getters
> `getWeather*(cfg, mode, strategyId)` et la capacité ville+date sont donc
> **découplés par mode** — une position sim n'épuise pas le slot réel.
>
> **UI** : onglet **Stratégies** (éditeur) + sélecteurs du **CapitalHero**
> partagent la config dashboard. Un PUT hero (`setActiveStrategy`) resynchronise
> les listes de l'onglet sans écraser des params locaux non sauvés.

| Clé bag | Defaut | Effet |
|---------|--------|-------|
| `minEdge` | `0.10` | Edge de base (forecast prob - market price) ; seuil effectif dynamique (`resolveDynamicMinEdge`) |
| `maxForecastStd` | `null` | Std dev max des modeles (°C, null = illimite) |
| `minForecastProbability` | `null` | Probabilité forecast min (null = illimité) |
| `minYesPrice` | `0.5` | Prix YES minimal pour entrer — **stratégie `weather-highest-yes` uniquement** (seuil de consensus) |
| `maxYesPrice` | `null` | Prix YES maximal pour entrer — **stratégie `weather-highest-yes` uniquement** (plafond anti-fade ; `null`/`0` = désactivé) |
| `sizingMode` | `fixed_usdc` | Mode de sizing (`fixed_usdc` uniquement) |
| `entryUsdc` | `10` | Montant fixe d'entree USDC |
| `entryDepthRetryMax` | `3` | Retries profondeur ask insuffisante |
| `entryDepthRetryDelayMs` | `1000` | Délai entre retries (ms) |
| `maxOpenPositions` | `10` | Max positions ouvertes (par stratégie) |
| `maxPositionsPerCityDate` | `1` | Max positions ouvertes simultanément pour un même couple (ville, date cible) |
| `maxPositionSizeUsdc` | `200` | Taille max par position (par stratégie) |
| `maxExposureUsdc` | `1000` | Plafond exposition stratégie |
| `maxDailyLossUsdc` | `100` | Perte journalière max (par stratégie) |
| `killSwitchAction` | `block_entries` | `block_entries` \| `force_close_all` \| `block_and_notify` (par stratégie) |
| `slEnabled` | `true` | Jambe SL (par stratégie) |
| `tpEnabled` | `true` | Jambe TP (par stratégie) |
| `trailingEnabled` | `true` | Jambe trailing (par stratégie) |
| `slPercent` | `null` | Seuil SL en % de la mise investie (null = hérite default 20%) |
| `tpPercent` | `null` | Seuil TP en % de la mise investie (null = hérite default 25%) |
| `trailingPercent` | `null` | Drawdown trailing en % de la mise investie (null = hérite 10%) |
| `trailingActivationPercent` | `null` | Gain en % pour armer le trailing (null = hérite 12%) |
| `slConfirmationTicks` | `2` | Evaluations consecutives SL avant signal |
| `slCloseMaxRetries` | `5` | Max tentatives cloture SL/TRAILING/PRE_CLOSE_LOSS/KILL_SWITCH |
| `forecastChangeThreshold` | `2` | Drift du forecast mean (°C) → `WEATHER_FORECAST_CHANGE` |
| `cityFollowSwitchMode` | `close_and_reenter` | `close_and_reenter` \| `hold` (`add_position` coercé) |
| `bucketHysteresisPolls` | `2` | Polls consecutifs hors palier avant `WEATHER_BUCKET_EXIT` |
| `reentryThrottleMs` | `1800000` | Pause apres close bucket/drift avant re-entree sur le même couple (ville, date cible) |
| `minTimeToClose` | `0` | Secondes minimum avant cloture pour autoriser une entree |
| `allowedMarketTags` | `[]` | Whitelist de slugs Gamma (vide = tous) |
| `signalScoreSizingEnabled` | `true` | Ajuste la taille d'entree selon le score de qualité du signal |
| `minBidToAskRatio` | `0.9` | Ratio bid/ask VWAP minimum pour autoriser une entree |

> **`weather-highest-yes` (sans forecast)** : les knobs forecast sont **inopérants**
> pour cette stratégie — `minEdge`, `maxForecastStd`, `minForecastProbability`
> (gates d'entrée), ainsi que `forecastChangeThreshold` et
> `bucketHysteresisPolls` (drift/bucket-exit désactivés en live). Seules les
> gates `minYesPrice` (prix YES ≥ seuil) et `maxYesPrice` (prix YES ≤ plafond,
> désactivé par défaut) s'appliquent à l'entrée ; SL/TP/trailing restent actifs.

UI : onglet **Paramètres** (globaux) + onglet **Stratégies** (activation +
params per-strategy, scindé sim/réel) + sélecteurs stratégie du CapitalHero +
onglet **Donnees** (exploration/purge, filtre `mode` sur le journal
d'évaluation). Voir
[`weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md`](../weather/plans/2026-08-08_IMPL-weather-market-data-persistence.md).

##### Colonnes legacy (source backfill, non modifiables API)

Les colonnes `weatherAlgoMinEdge`, `weatherAlgoMaxForecastStd`,
`weatherAlgoMinForecastProbability`, `weatherAlgoSizingMode`,
`weatherAlgoEntryUsdc`, `weatherAlgoForecastChangeThreshold`,
`weatherAlgoCloseBeforeResolutionHours`, `weatherAlgoCityFollowSwitchMode`,
`weatherAlgoBucketHysteresisPolls`, `weatherAlgoReentryThrottleMs`, etc.
restent présentes en DB pour le backfill initial (migrations `0107`/`0108`)
mais ne sont plus lues au runtime : hors schéma PUT → **400**. Distinct :
`weatherAlgoStrategies` / `weatherAlgoStrategyParams` restent dans le schéma
(acceptés puis **retirés** du patch) pour la rétrocompat GET / snapshots.

#### Bande d'entree crypto-algo (`cryptoAlgoEntryPrice*`)

Regle d'entree de la strategie `naive-momentum` quand `cryptoAlgoEntryPriceBandEnabled = true` (defaut) :

| Parametre | Defaut | Effet |
|-----------|--------|-------|
| `cryptoAlgoEntryPriceBandEnabled` | `true` | Active la bande ; si `false`, retour au seuil momentum `cryptoAlgoBaseThreshold` |
| `cryptoAlgoEntryPriceMin` | `0.55` | Prix minimum **exclusif** du token achete (Up ou Down) |
| `cryptoAlgoEntryPriceMax` | `0.80` | Prix maximum **exclusif** du token achete |

Exemples (bande par defaut) :

| Prix Up | Token achete | Resultat |
|---------|--------------|----------|
| 0,65 | Up (YES) | Entree YES |
| 0,85 | Up | Abstention `price_band` |
| 0,35 | Down (NO) | Entree NO |
| 0,56 | Up (YES) | Entree YES (au-dessus du min exclusif 0,55) |
| 0,55 exact | — | Abstention (borne stricte exclusive) |

Validation PATCH : `min < max`, chaque borne dans `[0,01 ; 0,99]`. Hot-reload via `config-changed`. Migration `AddCryptoAlgoEntryPriceBand1700000000056`.

Voir aussi [`crypto-algo.md`](./crypto-algo.md) et [`patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md`](../patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md).

#### Filtre courbe descendante (`cryptoAlgoCurve*`)

Apres detection d'une entree YES/NO (bande ou threshold), bloque l'achat si le **mid du token cible** (Up pour YES, Down pour NO) **baisse** sur la fenetre. Flat et montee autorises. Gate en **strategie** (abstain `curve_descending` trace sur les ticks).

| Parametre | Defaut | Effet |
|-----------|--------|-------|
| `cryptoAlgoCurveFilterEnabled` | `false` | Active le filtre courbe |
| `cryptoAlgoCurveLookbackMs` | `10000` | Fenetre de mesure (ms). **Max 60 000** (aligne buffer WS). Clamp runtime si valeur DB stale > max. |
| `cryptoAlgoCurveMinDelta` | `0.01` | Descente bloquante si `delta mid < -seuil` (points de proba) |

**Prerequis** : carnet WS actif (`MidHistoryBuffer` in-memory, mids bilateraux uniquement). Warm-up ~lookback apres activation ou reconnect WS. Historique insuffisant (< 3 points ou span < 50 % lookback) → fail-open (pas de blocage).

**Ordre des gates** : liquidite carnet cible → courbe (si on) → spread max.

Constantes code (non configurables) : `CURVE_MIN_POINTS=3`, `CURVE_SAMPLE_INTERVAL_MS=500`, `CURVE_BUFFER_MAX_MS=60000`.

Migration initiale : `AddCryptoAlgoCurveFilter1700000000061`.  
Patches : [`2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md`](../patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md), durcissement [`2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md`](../patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md).

### Filtre bid/ask a l'entree (`*MinBidToAskRatio`)

Evite de copier une entree lorsque le carnet est trop desequilibre : on paierait
l'**ask** mais ne pourrait revendre qu'au **bid**, avec une perte immediate
importante (spread extreme) que le SL ne couvre pas — le SL mesure le
**mouvement du bid** depuis l'entree, pas la perte vs le prix paye.

| Valeur | Effet |
|--------|-------|
| `0.90` (defaut) | Le bid executable pour la qty copiee doit valoir >= 90 % de l'ask |
| `0` | Filtre desactive (comportement anterieur) |

Calcul : `bidVwap / askVwap` sur la quantite cible finale, apres le triple-pass
VWAP de sizing (passe 3). Si le ratio est insuffisant ou si bid/ask = 0, l'entree est
ignoree (`entry skipped — bid/ask ratio below minimum` dans les logs copy-trading).
Sim et reel partagent la meme logique ; le seuil est configurable par mode.

> **Difference avec `maxSlippagePercent`** : le slippage compare le prix de fill
> a la reference ask au moment de l'ordre ; le ratio bid/ask verifie la
> **liquidite de sortie** avant meme de reserver la position.

### Pre-cloture

Ferme (ou tente de fermer) les positions avant la resolution du marche, dans
la fenetre `preCloseSeconds` avant `endDate`, ou tant que le CLOB accepte
encore des ordres apres `endDate`.

| Parametre | Effet |
|-----------|-------|
| `preCloseEnabled` | Active la logique de pre-cloture pour le mode (sim / reel) |
| `preCloseSeconds` | Fenetre en secondes avant `endDate` (defaut : 60) |
| `simPreCloseKeepEnabled` / `realPreCloseKeepEnabled` | Si active (`false` par defaut), les positions dont le bid est superieur au seuil `keepBidThreshold` restent ouvertes jusqu'a la resolution. Seules les positions sous le seuil sont pre-cloturees. |
| `simPreCloseKeepBidThreshold` / `realPreCloseKeepBidThreshold` | Seuil de bid (en points de probabilite) pour le keep. Si le bid de la position est >= ce seuil, la position est conservee (defaut 0.80). |

#### Surcharge crypto-algo (`cryptoAlgoPreClose*`)

Les positions `ALGO_OPEN` peuvent surcharger les parametres de pre-cloture du
mode (sim/real) via les colonnes `crypto_algo_pre_close_*` de `crypto_config` :

| Parametre | Effet |
|-----------|-------|
| `cryptoAlgoPreCloseEnabled` | `true` / `false` active ou desactive la pre-cloture pour les positions algo. `null` = herite du mode (`simPreCloseEnabled` / `realPreCloseEnabled`). |
| `cryptoAlgoPreCloseSeconds` | Fenetre en secondes. Si `null`, le code resout par interval de marche via la table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` : 120s pour 5m, 180s pour 15m, 240s pour 30m, 300s pour 1h, 600s pour 4h/1d. |
| `cryptoAlgoPreCloseKeepEnabled` | `null` = herite du mode. Si active, les positions gagnantes (bid >= seuil) sont conservees. |
| `cryptoAlgoPreCloseKeepBidThreshold` | Seuil de bid pour le keep. `null` = herite du mode. |

#### SL/TP crypto-algo en pourcentage de la mise (`cryptoAlgoSlPercent` / `cryptoAlgoTpPercent`)

Le SL/TP est calcule en **pourcentage de la mise investie** (0-100), coherent
avec le weather-algo et le copy-trading. `crypto_algo_sl_percent` /
`crypto_algo_tp_percent` dans `crypto_config` surchargent les defaults
d'intervalle (5m : SL 20 / TP 25).

- `null` = herite du default d'intervalle.
- `0` ou valeur negative = **desactive**.
- Le seuil est derive au fill depuis la base de cout (`entryPrice + frais`),
  par position : `slSeuil = cout * (1 - slPercent/100)`,
  `tpSeuil = min(cout * (1 + tpPercent/100), 0.99)`.

Voir `docs/reference/crypto-algo.md` et `docs/code/07-crypto-algo.md` pour le design.

#### Trailing crypto-algo en pourcentage de la mise (`cryptoAlgoTrailingPercent` / `cryptoAlgoTrailingActivationPercent`)

Le trailing stop utilise desormais un pourcentage de drawdown sur le PnL de
cloture. `crypto_algo_trailing_percent` et
`crypto_algo_trailing_activation_percent` dans `crypto_config` surchargent les
defaults d'intervalle. `null` = herite du default d'intervalle.

#### Suppression du SL/TP (`shouldSuppressSlTp`)

Le SL/TP/trailing est desactive (`suppressSlTp = true`) uniquement quand le
marche est **terminal** (`closed && !acceptingOrders`) ou **resolu**
(`resolved` / `winningTokenId` connu). Contrairement a
`isMarketAwaitingRedemptionExit`, le simple passage de `endDate` ne supprime
pas le SL/TP — le CLOB peut encore avoir des bids utilisables apres
`endDate` tant que `acceptingOrders` reste `true`. Voir
`packages/core/src/positions/redemption-wait.ts`.

Logique detaillee : `evaluatePreCloseExit` dans `packages/core/src/risk/exit-decision.ts`.
Pipeline : `docs/pipeline-copy-trading.md` (etape strategie + liquidity gate).

## 2.1 Configuration systeme (`system_config`)

Table cle/valeur d'infrastructure (timeouts worker, surveillance, auto-track,
backend, feature flags), distincte des 4 tables trading. UI : **Config systeme**
(heroes Sim/Reel). Seed : `packages/core/src/seed/system-config-defaults.ts`
(insert des cles manquantes uniquement). Cache processus TTL ~10 s.

| Cle | Defaut | Effet |
|-----|--------|-------|
| `worker.log.book_404_errors` | `false` | Si `true`, logue les warnings CLOB book HTTP 404 dans la console worker ; sinon silences (404 souvent transitoires sur tokens nouveaux/expires). Autres erreurs book toujours loguees. UI : Worker → Logs. |

Les timings `worker.*` numeriques sont charges au boot worker via
`initWorkerConfigCache`. Le flag de log ci-dessus est relu a la volee (cache
`SystemConfigService`).

## 3. Scripts npm

A la racine (`package.json`) :

| Script | Action |
|--------|--------|
| `npm run dev` | Lance core + backend + worker + copy-trading + crypto-algo + weather-algo + frontend via `concurrently` |
| `npm run build` | Build sequentiel : core -> backend -> worker -> copy-trading -> crypto-algo -> weather-algo -> backtest -> frontend |
| `npm run dev:copy-trading` | Lance uniquement `@polywatch/copy-trading` |
| `npm run dev:weather-algo` | Lance uniquement `@polywatch/weather-algo` |
| `npm test` | Tests unitaires des 8 packages (Vitest : core, backtest, worker, copy-trading, backend, frontend, crypto-algo, weather-algo) |
| `npm run migrate` | Execute `core/src/migrate.ts` (migrations PostgreSQL + seed) |
| `npm run db:drop-shadow-tables` | Supprime les tables shadow de migrations |
| `npm run generate-secrets` | Genere les 4 secrets `.env` |
| `npm run test:e2e` | Tests Playwright (`e2e/playwright.config.ts`) |
| `npm run test:e2e:crypto` | Tests E2E crypto-algo (Vitest, `e2e/crypto-algo/vitest.config.ts`) |
| `npm run test:e2e:crypto:real` | Tests E2E crypto-algo en mode reel (simulation reelle, `cross-env RUN_REAL_SIM_E2E=1`) |
| `npm run test:compliance` | Tests de conformite Vitest (`tools/e2e`) |
| `npm run dry-run:real` | Verifications pre-trading reel |
| `npm run spike:salt` | Script ponctuel (`scripts/archive/spike-clob-salt-dedup.ts`) |
| `npm run validate:redemption` | Validation on-chain des redemptions (`scripts/validate-redemption-onchain.mjs`) |

#### `validate:redemption`

Appelle `POST /api/internal/redeem` (backend + worker doivent tourner, trading reel configure).

```bash
npm run validate:redemption -- \
  --condition-id 0x... \
  --outcome YES \
  --asset-id <tokenIdCTF> \
  [--quantity 1] \
  [--neg-risk]
```

Variables : `BACKEND_URL` (defaut `http://127.0.0.1:3000`), `SERVICE_TOKEN` (obligatoire).  
`--asset-id` est **requis** pour les marches CTF standard (detection collateral dynamique depuis 2026-07-12).

Par package : `build` (`tsc`/`vite build`), `dev` (`tsx watch`/`vite`),
`start` (`node dist/index.js` pour backend/worker/copy-trading/crypto-algo), `test` (Vitest).

### Ordre de demarrage

`dev` execute d'abord un **pre-flight** (`scripts/dev-preflight.mjs`) qui verifie que le port backend (defaut 3000) est libre. Si le port est occupe :
- `/health` repond → message « stack deja en cours » ; arreter l'instance existante avant de relancer.
- `/health` ne repond pas → port zombie ; liberer le port ou definir `PORT`.

Ensuite `dev` demarre tout en parallele, mais :
- `dev:frontend` attend `GET /health` du backend via `scripts/wait-backend-health.mjs` (timeout **180 s**, honore `PORT`).
- worker, copy-trading et crypto-algo utilisent `waitForBackendReady` (signal Redis).
- Ces trois services requierent **Redis** et **PostgreSQL** disponibles.

Si PostgreSQL est indisponible ou une migration bloque, le backend peut rester en phase de boot (logs `boot phase: ...`) et le frontend peut encore expirer apres 180 s. Verifier les logs backend et l'etat de la base.

## 4. Dependances d'execution

- **Redis** — files de traitement et pub/sub. Indispensable au worker, copy-trading et crypto-algo.
- **Node.js >= 22** (types `@types/node@^22`).
- Acces reseau aux **APIs Polymarket** (Data, Gamma, CLOB, WebSocket).

## 5. Build & production

```bash
npm run build          # compile tous les packages
node packages/backend/dist/index.js        # API + WebSocket
node packages/copy-trading/dist/index.js   # detection copy → order-signals
node packages/worker/dist/index.js         # execution + sorties risque
node packages/crypto-algo/dist/index.js    # signaux algo crypto
node packages/weather-algo/dist/index.js   # signaux algo météo
# servir packages/frontend/dist via un serveur statique / reverse proxy
```

Le frontend appelle l'API en chemin relatif (`/api`) et le WebSocket sur `/` :
prevoir un reverse proxy (ou Vite proxy en dev) routant `/api` et le WebSocket
vers le backend `:3000`.

## 6. Sauvegarde

Un script de sauvegarde de la base est fourni : `scripts/backup-db.sh`
(PostgreSQL — utiliser `pg_dump` pour une sauvegarde coherente).

## 7. Tests

- **Unitaires** (Vitest) : nombreux `*.test.ts` dans `core` (pricing/VWAP,
  sizing, risk policy, accounting, poll-cycle, reservation…) et dans `backend`
  (crypto, wallet, relayer, ramp).
- **E2E** (Playwright) : `e2e/tests/login.spec.ts`.

## 8. Scripts d'exploitation (`tools/`)

Scripts d'investigation et de maintenance. Aucun n'est exposé comme route API ;
ils attaquent directement PostgreSQL / Redis. Pré-requis commun : `DATABASE_URL`
(chargé via `loadMonorepoEnv`), sauf indications contraires. Lancer avec `tsx tools/<script>.ts`.

> Seul `detect-stale-entry-timestamps.ts` est exposé dans `package.json`
> (`npm run audit:stale-entries`). Les autres se lancent en direct via `tsx`.

### Scripts réutilisables (diagnostic / maintenance)

| Script | Rôle | Dépendances |
|--------|------|-------------|
| `detect-stale-entry-timestamps.ts` | Détecte les positions algo dont le prix d'entrée ne correspond pas au carnet live à `opened_at` (flags `--hours`, `--min-lag-sec`, `--position`, `--json`). **Exposé via `npm run audit:stale-entries`** | PostgreSQL |
| `verify-sim-cash.ts` | Vérifie la cohérence du cash simulé en rejouant `replaySimCashDelta` depuis l'historique des exécutions vs `simulation_balances` (tolérance 0.01) — crypto/weather/copy | PostgreSQL + build `packages/core/dist` |
| `flush-redis-queues.ts` | Vide les files Redis worker (`order-signals`, `algo-order-signals`, `execution-results`). Dry-run par défaut, `--confirm` pour purger, `--release-reservations` en option | Redis + PostgreSQL |
| `backfill-close-reason-reservation-released.ts` | Rétro-tag des positions `ALGO_OPEN` annulées sans `close_reason` en `reservation_released` (dry-run par défaut, `--confirm` pour appliquer) | PostgreSQL |
| `audit-crypto-algo-exits.ts` | Audit analytique des positions fermées crypto-algo (joint markets, PnL, SL/TP, durée) | PostgreSQL |
| `audit-crypto-algo-exits-detail.ts` | Détail des positions `REDEMPTION` (sim, ALGO_OPEN) avec exécutions et timing vs `end_date` | PostgreSQL |
| `audit-summary.ts` | Synthèse simulation : cash, capital initial, positions groupées par statut, PnL réalisé/latent, mark-to-market | PostgreSQL |
| `analyze-config.ts` | Affiche les configs isolées courantes (`global`/`copy`/`crypto`/`weather`) et analyse la distribution du sizing pour entrées réussies vs échouées | PostgreSQL |
| `analyze-performance.ts` | Agrège les raisons d'échec d'exécution et échantillonne les exécutions failed (sim) | PostgreSQL |
| `audit-db-direct.ts` | Dump complet PostgreSQL : balances, copied_positions, exécutions (JSON par ligne) — vue brute de la DB | PostgreSQL |
| `weather-algo-audit.ts` | Audit positions / config weather-algo | PostgreSQL |
| `apply-weather-algo-fixes.ts` | Patch config weather en BDD | PostgreSQL |
| `diff-sim-real-snapshot.ts` | Garde CI mirroring sim/real | fichiers snapshot |
| `recover-stranded-redemption/` | Recovery on-chain positions stranded — voir README du dossier | Redis + chain |
| `e2e/` | Suites compliance Vitest (`npm run test:compliance`) | Vitest |

**Monitor crypto-algo** (`packages/crypto-algo/src/scripts/monitor.ts`) : CLI /
API `POST /api/system/crypto-algo-monitor` ; env `CRYPTO_MONITOR_DURATION_HOURS`
(1–48), `CRYPTO_MONITOR_INTERVAL_SECONDS`, `CRYPTO_MONITOR_OUTPUT_DIR`. Voir
[`crypto-algo.md`](./crypto-algo.md) § Monitor.

**E2E racine** : `e2e/tests/` (Playwright), `e2e/crypto-algo/`, `e2e/weather-algo/` ;
scripts npm `test:e2e`, `test:e2e:crypto`, `test:e2e:crypto:hardening`,
`test:e2e:crypto:sim-reset`, `test:e2e:weather`.

### Scripts ponctuels (investigation ciblée, IDs codés en dur)

Ces scripts contiennent des identifiants ou `condition_id` codés en dur — à éditer
avant réutilisation ou à supprimer une fois le diagnostic terminé.

| Script | Cible | Dépendances |
|--------|-------|-------------|
| `audit-position-28455-pg.ts` | Dump position #28455 (PostgreSQL direct via `pg`) | PostgreSQL |
| `audit-algo-tick-timestamps.ts` | 5 derniers ticks `algo_price_ticks` pour un `condition_id` codé en dur | PostgreSQL (localhost hardcodé) |
| `audit-redemption-sl-miss.ts` | Positions REDEMPTION de perte (IDs 16029, 16036) — prix d'entrée, SL, peak PnL | PostgreSQL |
| `audit-failed.ts` | Distribution des tailles d'ordre `below_min_order_size` (COPY_OPEN sim) | PostgreSQL |
| `analyze-db.ts` | Distribution des échecs `below_min_order_size` (min/max/avg qty) | PostgreSQL |
| `optimization-report.ts` | Rapport comparatif avant/après optimisation (stats figées, aucune lecture DB) | Aucune |

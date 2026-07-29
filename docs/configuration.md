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
| `SERVICE_TOKEN` | dev fallback | backend, worker, copy-trading, crypto-algo | Jeton d'auth des routes internes (`x-service-token`) |
| `MASTER_ENCRYPTION_KEY` | dev fallback | backend | Cle AES-256-GCM : 64 car. hex (sortie de `npm run generate-secrets`) ou chaine UTF-8 de 32 bytes |
| `REDIS_URL` | `redis://localhost:6379` | backend, worker, copy-trading, crypto-algo | Connexion Redis |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | backend | Whitelist CORS (Express + Socket.IO), origines separees par des virgules |
| `PORT` | `3000` | backend | Port HTTP |
| `NODE_ENV` | `development` | backend | Affecte le rate-limit (1000 req/min ; les appels internes via `x-service-token` sont exemptes) |
| `BACKEND_URL` | `http://localhost:3000` | worker, copy-trading, crypto-algo | URL backend pour les callbacks internes |
| `ADMIN_USERNAME` | `admin` | backend (seed) | Identifiant admin initial |
| `ADMIN_PASSWORD` | `changeme` | backend (seed) | Mot de passe admin initial |
| `POLYMARKET_DATA_API` | `https://data-api.polymarket.com` | backend, copy-trading | API positions/leaderboard (polling traders) |
| `POLYMARKET_GAMMA_API` | `https://gamma-api.polymarket.com` | backend, core | API metadonnees marches |
| `POLYMARKET_CLOB_API` | `https://clob.polymarket.com` | worker, core, copy-trading, crypto-algo | API order book / trading |
| `POLYMARKET_WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | worker, copy-trading, crypto-algo | WebSocket order book |
| `POLYMARKET_WS_USER_URL` | derive de `POLYMARKET_WS_URL` (`/ws/user`) | worker | WebSocket fills/ordres async (auth L2) |
| `MARKET_TICK_RETENTION_DAYS` | `30` | worker | Retention des ticks `market_position_ticks` (jours) ; purge horaire par batches |
| `MARKET_PRICE_TICK_RETENTION_DAYS` | `0` (pas de purge) | worker | Retention des ticks `market_price_ticks` (jours) ; `0` = pas de purge |
| `MARKET_TICK_THROTTLE_MS` | `500` | worker | Throttle de persistance des ticks par asset (ms) |
| `MARKET_TICK_REF_QTY` | `100` | worker | Quantite de reference pour le calcul des VWAP executables stockes dans les ticks |
| `CRYPTO_ALGO_POLL_MS` | `30000` | crypto-algo | Frequence de polling pour le StrategyRunner (ms) |
| `ALGO_PRICE_TICK_REF_QTY` | `50` | crypto-algo | Quantite de reference pour les ticks de prix algo |
| `WEATHER_ALGO_POLL_MS` | `1800000` | weather-algo | Fréquence de polling pour le StrategyRunner météo (ms, defaut 30min) |
| `WEATHER_FORECAST_CACHE_TTL_MS` | `3600000` | weather-algo | TTL du cache de prévisions Open-Meteo (ms, defaut 1h) |
| `ALLOW_SYNCHRONIZE_PROD` | — | core | Si present, autorise `synchronize: true` en production (dangereux, reserve debug) |
| `SIM_EXECUTION_LATENCY_MS` | — | core / worker | Surcharge de la latence d'execution simulee (ms) ; ecrase la valeur de `RiskConfig.simExecutionLatencyMs` |
| `POLYGON_RPC_URL` | `https://polygon-bor-rpc.publicnode.com` | core | URL RPC Polygon pour les verifications on-chain |
| `POLYMARKET_BRIDGE_URL` | `https://bridge.polymarket.com` | backend | URL du bridge Polymarket |
| `REDIS_SENTINEL_NAME` | — | core | Nom du master Redis Sentinel (si deploiement Sentinel) |
| `REDIS_SENTINEL_HOSTS` | `127.0.0.1:26379` | core | Hotess Redis Sentinel (separes par des virgules) |
| `REDIS_SENTINEL_PASSWORD` | — | core | Mot de passe Redis Sentinel (fallback sur `REDIS_PASSWORD`) |
| `REDIS_PASSWORD` | — | core | Mot de passe Redis (utilise aussi par Sentinel) |
| `REDIS_DB` | `0` | core | Index de base Redis |
> **Production** : changer imperativement tous les secrets. Les valeurs par
> defaut « dev fallback » ne doivent jamais etre utilisees en production.

## 2. Configuration du risque (`RiskConfig`)

Stockee en base (singleton), modifiable via `PUT /api/risk-config` (UI : page
Reglages). Voir [`modele-donnees.md`](./modele-donnees.md#riskconfig-risk_config)
pour la liste complete. Parametres notables et leurs effets :

| Parametre | Effet |
|-----------|-------|
| `realTradingEnabled` | Active globalement le mode reel (sinon `real` ignore) |
| `simCopyTradingEnabled` | Active globalement le copy-trading en mode sim (sinon les entrees sim ignorees) |
| `maxOpenPositions` / `simMaxOpenPositions` / `realMaxOpenPositions` | Limites de positions ouvertes (globale et par mode) |
| `maxExposureUsdc` / `simMaxExposureUsdc` / `realMaxExposureUsdc` | Plafond d'exposition total (globale et par mode) |
| `maxDailyLossUsdc` / `simMaxDailyLossUsdc` / `realMaxDailyLossUsdc` | Perte maximale journaliere (globale et par mode) |
| `maxPositionSizeUsdc` / `simMaxPositionSizeUsdc` / `realMaxPositionSizeUsdc` | Taille maximale par position (globale et par mode) |
| `maxSlippagePercent` | Garde-fou de slippage a l'execution (ecart fill vs `referenceVwap` ask) ; sim et reel ; **modifiable UI** dans Parametres env (onglet Risk) et Configuration Crypto Algo (onglet General). **Les sorties forcees (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `KILL_SWITCH`) ne sont pas bloques par le slippage guard** : en marche illiquide elles peuvent donc s'executer sous le `lastTradePrice` connu, au prix d'un fill plus eloigne du bid affiche. |
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
| `*SlBidPoints` / `*TpBidPoints` / `*TrailingBidPoints` | Declencheurs de sortie SL/TP/trailing en points de bid absolus. En marche illiquide, le dernier prix trade connu (`last_trade_price` du canal WS CLOB) est utilise comme reference conservatrice pour que le SL/trailing/kill-switch puisse se declencher meme si le bid affiche est un niveau fige. |
| `simSlEnabled` / `realSlEnabled` | Active/desactive le stop-loss pour le mode |
| `simTpEnabled` / `realTpEnabled` | Active/desactive le take-profit pour le mode |
| `simSlBidPoints` / `realSlBidPoints` | Stop-loss en points de bid absolus pour marches binaires (defaut 0.10) |
| `simTpBidPoints` / `realTpBidPoints` | Take-profit en points de bid absolus pour marches binaires (defaut 0.12) |
| `simSlCloseMaxRetries` / `realSlCloseMaxRetries` | Nombre maximum de tentatives automatiques de cloture pour les sorties forcees (`SL`, `TRAILING`, `PRE_CLOSE_LOSS`, `KILL_SWITCH`) qui echouent avec `no_liquidity`, `order_not_matched` ou `tick_size_fetch_failed`. Defaut `5`. Le TP n'est pas retente automatiquement. |
| `simTrailingEnabled` / `realTrailingEnabled` | Active/desactive le trailing stop |
| `simTrailingBidPoints` / `realTrailingBidPoints` | Trailing stop en points de bid absolus (defaut 0.05) |
| `simTrailingActivationBidPoints` / `realTrailingActivationBidPoints` | Seuil d'activation du trailing en points de bid absolus (defaut 0.06, 0 = des l'entree) |
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

#### Weather Algo (`weatherAlgo*`)

Parametres du trading algorithmique meteo, stockes dans `risk_config` et modifiables via `PUT /api/risk-config` (UI : page Weather Algo → onglet Parametres). Voir aussi [`weather-algo.md`](./weather-algo.md).

| Parametre | Defaut | Effet |
|-----------|--------|-------|
| `weatherAlgoEnabled` | `false` | Active/desactive les **entrees** weather-algo (les sorties drift/pre-close restent evaluees pour les positions ouvertes) |
| `weatherAlgoMinEdge` | `0.10` | Edge de base (forecast prob - market price) ; le seuil effectif est dynamique (`resolveDynamicMinEdge`) |
| `weatherAlgoMaxForecastStd` | `null` | Std dev max des modeles pour autoriser l'entree (°C, null = illimite) |
| `weatherAlgoSizingMode` | `fixed_usdc` | Mode de sizing (actuellement `fixed_usdc` uniquement) |
| `weatherAlgoEntryUsdc` | `10` | Montant fixe d'entree en USDC par position weather-algo |
| `weatherAlgoSelectionMode` | `single` | Mode de selection : `single` (meilleur edge), `multi` (top N), `spread` (meilleur YES + meilleur NO) |
| `weatherAlgoMaxSignalsPerEvent` | `3` | Max signaux par event en mode `multi` |
| `weatherAlgoForecastChangeThreshold` | `2` | Drift du forecast mean (°C) → close `WEATHER_FORECAST_CHANGE` |
| `weatherAlgoCloseBeforeResolutionHours` | `1` | Gate d'entrée + auto-close `WEATHER_PRE_CLOSE` dans cette fenêtre |
| `weatherAlgoPollMs` | `1800000` | Intervalle de polling du StrategyRunner (ms, defaut 30min) ; surcharge aussi via env `WEATHER_ALGO_POLL_MS` au demarrage |
| `weatherAlgoCityFollowSwitchMode` | `close_and_reenter` | Comportement si la prévision change de bucket (city-follow) : `close_and_reenter` (fermer et re-entrer), `hold` (seuil drift uniquement), `add_position` (ouvrir une position additionnelle, requiert mode multi) |

#### Bande d'entree crypto-algo (`cryptoAlgoEntryPrice*`)

Regle d'entree de la strategie `naive-momentum` quand `cryptoAlgoEntryPriceBandEnabled = true` (defaut) :

| Parametre | Defaut | Effet |
|-----------|--------|-------|
| `cryptoAlgoEntryPriceBandEnabled` | `true` | Active la bande ; si `false`, retour au seuil momentum `cryptoAlgoBaseThreshold` |
| `cryptoAlgoEntryPriceMin` | `0.50` | Prix minimum **exclusif** du token achete (Up ou Down) |
| `cryptoAlgoEntryPriceMax` | `0.80` | Prix maximum **exclusif** du token achete |

Exemples (bande par defaut) :

| Prix Up | Token achete | Resultat |
|---------|--------------|----------|
| 0,65 | Up (YES) | Entree YES |
| 0,85 | Up | Abstention `price_band` |
| 0,35 | Down (NO) | Entree NO |
| 0,52 | Up (YES) | Entree YES (zone auparavant neutre avec threshold 0,55) |
| 0,50 exact | — | Abstention (borne stricte) |

Validation PATCH : `min < max`, chaque borne dans `[0,01 ; 0,99]`. Hot-reload via `config-changed`. Migration `AddCryptoAlgoEntryPriceBand1700000000056`.

Voir aussi [`crypto-algo.md`](./crypto-algo.md) et [`patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md`](./patchs/2026-07-12_PATCH_CRYPTO_ALGO_ENTRY_PRICE_BAND.md).

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
Patches : [`2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md`](./patchs/2026-07-21_PATCH_CRYPTO_ALGO_CURVE_DESCENDING_GATE.md), durcissement [`2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md`](./patchs/2026-07-22_PATCH_CRYPTO_ALGO_CURVE_FILTER_HARDENING.md).

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
mode (sim/real) via les colonnes `crypto_algo_pre_close_*` de `risk_config` :

| Parametre | Effet |
|-----------|-------|
| `cryptoAlgoPreCloseEnabled` | `true` / `false` active ou desactive la pre-cloture pour les positions algo. `null` = herite du mode (`simPreCloseEnabled` / `realPreCloseEnabled`). |
| `cryptoAlgoPreCloseSeconds` | Fenetre en secondes. Si `null`, le code resout par interval de marche via la table `CRYPTO_INTERVAL_PRE_CLOSE_SECONDS` : 120s pour 5m, 180s pour 15m, 240s pour 30m, 300s pour 1h, 600s pour 4h/1d. |
| `cryptoAlgoPreCloseKeepEnabled` | `null` = herite du mode. Si active, les positions gagnantes (bid >= seuil) sont conservees. |
| `cryptoAlgoPreCloseKeepBidThreshold` | Seuil de bid pour le keep. `null` = herite du mode. |

#### SL/TP crypto-algo en bid absolu (`cryptoAlgoSlBidPoints` / `cryptoAlgoTpBidPoints`)

Pour les marches binaires (`*-updown-5m`), le mode % relatif est
**semantiquement inadapte** (protection inegale selon l'entry, TP
mathematiquement impossible pour les entries hautes, whipsaw). Un mode
**bid absolu** (en points de probabilite) est utilise exclusivement.

`crypto_algo_sl_bid_points` / `crypto_algo_tp_bid_points` dans
`risk_config` surchargent les defaults d'intervalle (5m : SL 0,10 /
TP 0,12).

- `null` = herite du default d'intervalle.
- `0` ou valeur negative = **desactive** le mode absolu.
- Sinon : seuil absolu calcule au fill depuis `entryBidVwap` :
  `slBidAbsolute = entryBidVwap - slBidPoints`,
  `tpBidAbsolute = min(entryBidVwap + tpBidPoints, 0.99)`.
- **Garde binaire** : les seuils absolus ne sont calcules que si
  `byInterval != null` (marche binaire reconnu). Jamais appliques aux
  marches non-binaires.
- **Garde frais TP** : TP declenche seulement si
  `executableBidVwap >= tpBidAbsolute AND closurePnl >= 0`.
- **Recalcul sur `ALGO_INCREASE`** : `entryBidVwap` etant recalcule a
  chaque augmentation, les seuils absolus sont aussi recalcules via le
  helper `resolveAbsoluteBidThresholds(pos)`.

Voir `docs/patchs/2026-07-06_PATCH_SL_TP_POINTS_ABSOLUS_BINAIRES.md`
pour le design complet et les decisions post-audit.

#### Trailing crypto-algo en bid absolu (`cryptoAlgoTrailingBidPoints` / `cryptoAlgoTrailingActivationBidPoints`)

Le trailing stop utilise desormais des points de bid absolus, comme le copy trading.
`crypto_algo_trailing_bid_points` et `crypto_algo_trailing_activation_bid_points`
dans `risk_config` surchargent les defaults d'intervalle. `null` = herite du default
d'intervalle.

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

## 3. Scripts npm

A la racine (`package.json`) :

| Script | Action |
|--------|--------|
| `npm run dev` | Lance core + backend + worker + copy-trading + crypto-algo + weather-algo + frontend via `concurrently` |
| `npm run build` | Build sequentiel : core -> backend -> worker -> copy-trading -> crypto-algo -> weather-algo -> frontend |
| `npm run dev:copy-trading` | Lance uniquement `@polywatch/copy-trading` |
| `npm run dev:weather-algo` | Lance uniquement `@polywatch/weather-algo` |
| `npm test` | Tests unitaires des 7 packages (Vitest) |
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

`dev` demarre tout en parallele, mais :
- `dev:frontend` attend `GET /health` du backend (`wait-on`, timeout 60 s).
- worker, copy-trading et crypto-algo utilisent `waitForBackendReady` (signal Redis).
- Ces trois services requierent **Redis** et **PostgreSQL** disponibles.

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

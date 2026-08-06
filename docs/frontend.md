# Frontend (SolidJS)

Le frontend (`packages/frontend`) est une SPA **SolidJS** buildée avec **Vite**.
Pas de bibliothèque de composants : le style repose sur `styles.css` (variables
CSS + classes utilitaires de type BEM).

## 1. Point d'entrée et navigation

- `src/index.tsx` — montage de l'application.
- `src/App.tsx` — racine : gère l'état de session (`isLoggedIn`) et la
  navigation entre les pages (`APP_PAGES`).

```typescript:packages/frontend/src/lib/ui-persistence.ts
export const APP_PAGES = ['simulation', 'real', 'leaderboard', 'markets', 'wallet', 'crypto-algo', 'weather-algo', 'system'] as const;
export const SYSTEM_PAGE_TABS = ['overview', 'reports', 'snapshots', 'e2e-tests', 'metrics', 'crypto-algo-monitor'] as const;
```

> Les anciennes pages `reports`, `e2e-tests`, `metrics`, `snapshots` ont été
> regroupées sous la page **Système** avec des onglets (`SYSTEM_PAGE_TABS`).

| Page | Composants principaux |
|------|-----------------------|
| **Simulation** | `SimulationPage` : onglets **Activité** (`SimHero`, `PositionCard`, `EventsPanel`, `ExecutionLog` — `algoKind` actif) et **Analytics** (`SimAnalyticsPanel` pour `copy`). Snapshots → page **Système** |
| **Réel** | `RealHero`, `PositionCard mode="real"`, `EventsPanel`, `ExecutionLog mode="real"` |
| **Leaderboard** | `Leaderboard` (+ panneau **Trader Insight** / `TraderProfilePage` — pas une page top-level) |
| **Marchés** | `MarketsPage` : filtres Gamma, métriques, `MarketChartDialog` → `UpDownPriceChart` |
| **Portefeuille** | `WalletPage` |
| **Crypto-Algo** | `CryptoAlgoPage` : marchés, surveillance, settings (`CryptoAlgoSettingsDialog` : General / Entrée / Sortie / Autotrack), Rapport + Hub Système |
| **Weather Algo** | `WeatherAlgoPage` : onglets Marchés / Positions / Villes / Paramètres — voir arbre §3 et [`weather-algo.md`](./weather-algo.md) |
| **Système** | `SystemPage` : Overview, Rapports, Snapshots, E2E, Metrics, **Crypto Algo Monitor** (`CryptoAlgoMonitorPage`) |

L'en-tête : navigation, `EnvSettingsDialog` / watchlist, `NotificationCenter`, déconnexion. `AlertBanner` au-dessus des pages.

## 2. Communication avec le backend

### REST — `src/api.ts`
Wrapper `api<T>(path, options)` :
- Ajoute `Authorization: Bearer <accessToken>`.
- Sur `401 invalid_token`, tente un **refresh** automatique (dédupliqué) puis rejoue.
- Cache GET (TTL 5/15/30 s) + dedupe in-flight ; retry **429** ×3 avec backoff.
- Façade configs isolées : `fetch*/update*` pour `/api/config/{global,copy,crypto,weather}` + `updateEnvSettings`.
- Inventaire routes backend : [`api.md`](./api.md) (les appels métier sont aussi dans `lib/` / `hooks/` / `stores/`).

### Temps réel — `src/socket.ts`
Connexion Socket.IO authentifiée par token (`handshake.auth.token`),
**reconnexion automatique** activée (back-off jusqu'à 30 s). Sur un
`connect_error: unauthorized` (token expiré), le socket rafraîchit le JWT via
`refreshSessionTokens()` (partagé avec `api.ts`) puis se reconnecte. Voir les
évènements dans [`api.md`](./api.md#websocket-socketio) : `position_update`,
`execution`, `pnl_tick`, `move_detected`, `alert`, `simulation_reset`,
`simulation_balance`, `simulation_snapshot_created`.

## 3. Arborescence des composants

```
src/
├── App.tsx, index.tsx, api.ts, socket.ts, styles.css
├── components/
│   ├── Login.tsx                 connexion
│   ├── EnvSettingsDialog.tsx     configuration par mode (sim/réel) depuis les heros
│   ├── EnvSettingsTabs.tsx      onglets Entrée / Sortie / Risque
│   ├── settings-sections.tsx / settings-fields.tsx
│   ├── MarketTagsSection.tsx     whitelist tags marché (CopyConfig)
│   ├── NotificationCenter.tsx    centre de notifications (store)
│   ├── WatchlistEditor.tsx       gestion de la watchlist
│   ├── SimHero.tsx / RealHero.tsx  barres « hero » compactes (modes)
│   ├── SimulationPage.tsx        page sim (Activité + Analytics)
│   ├── SimulationSnapshotsPanel.tsx  snapshots sim (page Système → Snapshots)
│   ├── SimSessionCard.tsx, SimSessionComparePanel.tsx, SimSessionCard.tsx (config diff preview), SnapshotConfigDiffPanel.tsx  gestion et comparaison de sessions, diff config
│   ├── SimSnapshot*  archives, filtres, graphique equity, comparaison et détail snapshots
│   ├── SimAnalyticsPanel.tsx, SimAnalytics*  analytics simulation (PnL par catégorie, tableaux, SimAnalyticsCategoryChart, SimAnalyticsChartSection, SimAnalyticsTable)
│   ├── SimMarketAnalyticsPanel.tsx, SimMarket*  analytics par marché (classement, répartition YES/NO, SimMarketAnalyticsChartSection, SimMarketAnalyticsRank, SimMarketAnalyticsTable, SimMarketYesNoBreakdown)
│   ├── SimExecutionSettingsDialog.tsx  réglages d'exécution simulation (latence, auto-impact, préflight, shadow)
│   ├── SimExecutionStatsPanel.tsx      statistiques d'exécution simulation (p50/p90 RTT, shadow fills)
│   ├── PositionCard.tsx          carte de positions par mode
│   ├── position/                 sous-composants de liste de positions
│   │   ├── PositionList.tsx, PositionRow.tsx, PositionTabsBar.tsx
│   │   ├── OpenPositionRow.tsx, ClosedPositionRow.tsx, AwaitingRedemptionPositionRow.tsx
│   │   ├── PositionRowPnl.tsx, PositionRowSizing.tsx, PositionRowIdentity.tsx
│   │   ├── PositionOpenRowMeta.tsx, OpenPositionRowPnl.tsx
│   │   ├── PositionCloseButton.tsx, PositionMarketLink.tsx, PositionPnlSummary.tsx
│   │   ├── PositionListFrame.tsx, PositionMarketSplitView.tsx
│   ├── EventsPanel.tsx           flux des mouvements détectés — prop `algoKind?` restreint la source (copy→moves, crypto→algo events, weather→placeholder)
│   │   ├── move-events/MoveEventFilters.tsx  filtres des mouvements (mode, source)
│   │   └── algo-events/AlgoEventRow.tsx      ligne d'événement algo dans EventsPanel
│   ├── ExecutionLog.tsx          journal des exécutions
│   ├── Leaderboard.tsx           classement traders
│   ├── MarketsPage.tsx           page marchés Gamma
│   ├── MarketCard.tsx, MarketMetricsPanel.tsx  cartes et métriques marché
│   ├── MarketsCryptoFilterBar.tsx, MarketsCryptoCurrencyFilterBar.tsx, MarketsIntervalSidebar.tsx, MarketsTagBar.tsx  filtres marchés
│   ├── MarketChartDialog.tsx, MarketChartDialogHost.tsx  dialogue de graphique marché
│   ├── MarketChartMeta.tsx, MarketChartMosMeta.tsx, MarketChartDebugPanel.tsx  métadonnées et debug graphique
│   ├── MarketSyncSettingsDialog.tsx  configuration de synchronisation des marchés (intervalles, backoff, concurrency)
│   ├── TraderProfilePage.tsx     page profil trader Polymarket
│   ├── TraderActivityTimelineChart.tsx, TraderCapitalEvolutionChart.tsx, TimeSeriesLineChart.tsx  graphiques trader et séries temporelles
│   ├── TraderFundingSection.tsx, TraderFundingTimelineChart.tsx  analyse financement
│   ├── TraderMarketBreakdownChart.tsx, TraderPnlEvolutionChart.tsx  répartition et PnL
│   ├── AlertBanner.tsx           bannière d'alerte (kill switch, santé book)
│   ├── WalletPage.tsx            page portefeuille
│   ├── WalletHistoryPanel/Section.tsx, WalletPolywatchExecutions.tsx
│   ├── WalletAccountsDialog.tsx  gestion des comptes wallet
│   ├── PolygonscanSettingsDialog.tsx gestion des paramètres d'historique Polygonscan
│   ├── BridgeDepositPanel.tsx    dépôt via bridge
│   ├── PusdTransferDialog.tsx, PusdTransferSummary.tsx, WithdrawTransferFields.tsx
│   ├── ClobCredentialsDialog.tsx credentials CLOB
│   ├── CredsFieldList.tsx, CredField.tsx
│   ├── MetaMaskButton.tsx        connexion MetaMask
│   ├── CryptoAlgoPage.tsx          page crypto-algo (marchés, surveillance, dialog Rapport)
│   ├── ReportsPage.tsx             hub rapports d'analyse
│   ├── CryptoAlgoReportViewer.tsx  viewer rapport algo partagé
│   ├── AnalysisReportComparePanel.tsx  comparaison snapshots rapports
│   ├── CryptoAlgoHeader.tsx        en-tête de la page crypto-algo
│   ├── CryptoAlgoLiveMarketsPanel.tsx  marchés actifs surveillés par l'algo
│   ├── CryptoAlgoInactiveMarketsPanel.tsx  marchés inactifs/supprimés
│   ├── CryptoAlgoFutureMarketsPanel.tsx   marchés futurs (auto-track à venir)
│   ├── CryptoAlgoPositionsPanel.tsx       positions ouvertes par l'algo
│   ├── CryptoAlgoExecutionsPanel.tsx      exécutions de l'algo
│   ├── CryptoAlgoCapitalDashboard.tsx     dashboard de capital algo
│   ├── CryptoAlgoSurveillancePanel.tsx    panneau de surveillance OHLC
│   ├── CryptoAlgoSettingsDialog.tsx       paramètres algo
│   │   ├── CryptoAlgoSettingsGeneralTab.tsx    kill-switch, stratégies, infra
│   │   ├── CryptoAlgoSettingsEntryTab.tsx      sizing, price-band, knobs entrée
│   │   ├── CryptoAlgoSettingsExitTab.tsx       SL/TP/trailing/pre-close
│   │   └── CryptoAlgoSettingsAutotrackTab.tsx  auto-track
│   ├── CryptoAlgoMonitorPage.tsx       moniteur système (Système → onglet)
│   ├── WeatherAlgoPage.tsx             shell weather (4 onglets)
│   │   ├── WeatherAlgoHeader.tsx / WeatherAlgoCapitalHero.tsx
│   │   ├── WeatherAlgoActiveMarketsPanel.tsx / WeatherAlgoDiscoverPanel.tsx
│   │   ├── WeatherAlgoPositionsPanel.tsx / WeatherAlgoExecutionsPanel.tsx
│   │   ├── WeatherAlgoAutoTrackTab.tsx / WeatherAlgoSettingsTab.tsx
│   │   └── WeatherCityGroup.tsx
│   ├── AlgoMarketCard.tsx, AlgoCarousel.tsx, AlgoCarouselNav.tsx
│   ├── AlgoMarketChartTrigger.tsx / SurveillanceHistoryCard.tsx
│   ├── UpDownPriceChart.tsx            ~1219 L — SVG Up/Down + overlays SL/TP/signals (pas canvas) ; helpers `lib/updown-*` ; consommateur `MarketChartDialog`
│   ├── JsonIntervalMapField.tsx
│   ├── E2eTestsPage.tsx / E2eRun*.tsx / E2eLivePositions.tsx
│   ├── TimeframeSelector.tsx
│   ├── TimeSeriesLineChart.tsx        graphique de séries temporelles (réutilisable)
│   ├── PositionMarketChartTrigger.tsx déclencheur de graphique pour position
│   ├── CollapsiblePanel.tsx      panneau rétractable générique
│   ├── Icon.tsx                  composant d'affichage d'icônes vectorielles SVG
│   ├── NavClock.tsx, CountdownTimer.tsx, CountdownContext.tsx composants d'horloge et compte à rebours
│   ├── ModeHeroBalanceStat.tsx   statistique de solde pour le mode hero
│   └── Dialog.tsx                coquille modale réutilisable
├── hooks/
│   ├── useDialog.ts              lock scroll + Escape (utilisé par Dialog)
│   ├── useClock.ts               horloge réactive (compte à rebours)
│   ├── useSimulationSnapshots.ts état vues Sessions/Snapshots, filtres, pagination, sélections multi-éléments
│   ├── useMarketChart.ts         état et données pour les graphiques de marché
│   ├── useMarketOrderSize.ts     taille minimale d'ordre par marché
│   ├── useExitAttempts.ts        tentatives de sortie d'une position
│   ├── useCryptoAlgoDashboard.ts données du dashboard crypto-algo
│   ├── useCryptoAlgoPositions.ts positions crypto-algo
│   ├── useCryptoAlgoExecutions.ts exécutions crypto-algo
│   ├── useCryptoAlgoSurveillance.ts surveillance crypto-algo
│   ├── useAlgoCarouselScroll.ts  défilement du carrousel algo
│   ├── useMarketsBrowse.ts       navigation et filtrage des marchés
│   ├── useMarketPnlSeries.ts     séries PnL par marché
│   ├── useTraderPnlSeries.ts     séries PnL par trader
│   ├── useChartWidth.ts          largeur réactive des graphiques
│   ├── useHorizontalResize.ts    redimensionnement horizontal
│   ├── useEasternTime.ts         fuseau horaire Eastern
│   ├── useFormSave.ts            sauvegarde de formulaire avec debounce
│   ├── useCopyFeedback.ts        retour visuel de copie
│   ├── useClobCredentials.ts     état des credentials CLOB
│   ├── useTradingWallet.ts      état du wallet de trading
│   ├── useMetaMaskAvailable.ts  disponibilité MetaMask
│   ├── useCredsSetupDialog.ts   dialogue de configuration des credentials
└── lib/                          helpers (position, date, wallet, bridge,
                                  pusd, clob-credentials, ethereum, execution,
                                  move-events, algo-events, algo-capital,
                                  algo-market-filters, algo-market-prices,
                                  algo-surveillance, algo-surveillance-positions,
                                  simulation-snapshots, sim-snapshot-compare,
                                  simulation-sessions, sim-session-compare,
                                  market-chart, market-chart-positions,
                                  market-analytics, trader-analytics,
                                  updown-price-chart, updown-chart-overlays,
                                  e2e-runs, exit-attempts, crypto-algo-health,
                                  redemption-wait, position-tooltips,
                                  market-sync-config, market-tags, market,
                                  markets-list, simulation, equity-chart,
                                  integration-settings, trader-insight,
                                  leaderboard-categories, sim-analytics-sort,
                                  metamask-relayer-withdraw, wallet, wallet-transfer,
                                  wallet-history, pusd-transfer, pusd-errors,
                                  bridge, bridge-metamask, erc20, ethereum,
                                  address, private-key, deposit-wallet-signing,
                                  debounce, clipboard, ui-persistence, date…)
```

Documentation dédiée : [`snapshots-simulation.md`](./snapshots-simulation.md).

### Filtre par type de marché (UI)

Dans **Configurer** (`EnvSettingsDialog`, bouton des heros Simulation/Réel),
onglet **Entrée** :

- **`MarketTagsSection`** : charge `GET /api/market-tags` (catégories nav +
  recherche optionnelle) et édite `simAllowedMarketTags` /
  `realAllowedMarketTags` via `PUT /api/config/copy`. Liste vide = copier tous
  les marchés ; sélection non vide = whitelist appliquée par le `CopyProcessor`
  sur les entrées uniquement.
- **Ratio bid/ask min à l'entrée** (`simMinBidToAskRatio` /
  `realMinBidToAskRatio`) : champ numérique 0–1 (défaut `0.90`). Refuse la copie
  si le bid exécutable pour la quantité cible est trop inférieur à l'ask — voir
  [configuration.md](./configuration.md#filtre-bidask-à-lentrée-minbidtoaskratio).
  `0` désactive le filtre.

## 4. Conventions UI

Documentées dans la skill `polywatch-frontend-ui`
(`.cursor/skills/polywatch-frontend-ui/SKILL.md`) :

- **`Dialog`** est la coquille modale unique (Portal, overlay, header, a11y) —
  ne pas réimplémenter le plumbing modal. Variantes : `dialog-settings` (640px),
  `dialog-creds` (480px).
- **Hero compact** : barre horizontale `.mode-hero` plutôt qu'un panneau titré
  avec `stat-card` (cf. `ModeSwitch`/`SimHero`/`RealHero`).
- **Extraction** : un formulaire de plus de ~3 champs va dans un dialog dédié ;
  les champs réutilisables dans un module `*-fields.tsx`.
- **Classes réutilisables** : `btn`, `input`, `input-mono`, `form-hint`,
  `badge`, `toggle-switch`, `empty-state`.
- **Langue** : libellés utilisateur en **français**, identifiants de code en
  anglais.
- **Responsive** : empiler les groupes hero sous 640px.

## 5. Flux temps réel typiques

| Interaction | Chemin |
|-------------|--------|
| Trader bouge → copie | WebSocket `move_detected` puis `position_update` / `execution` |
| Évolution PnL | `pnl_tick` met à jour le signal `pnlMap` de `PositionCard` ; les lignes lisent le tick via des accesseurs réactifs (`OpenPositionRow`) |
| PnL — secours | À défaut de `pnl_tick`, `PositionCard` recharge les positions ouvertes en REST toutes les **30 s** (valeurs persistées en base) |
| Clôture manuelle | `POST /api/copied-positions/:id/close` → `position_update` (`closing`) |
| Reset simulation | `POST /api/simulation-balance/reset` (`algoKind` requis) → dialog **kind-aware** (`NewSessionResetDialog`, config via `/config/{kind}`) → purge Redis **scopée** (+ drain `move-events` copy, purge `weather-reentry` weather) + `simulation_reset` (WS + `algoKind`) ; `PositionCard.pnlMap` et refresh filtrés par `payload.algoKind` |
| Toggle copy trading | `PUT /api/config/copy` → DB + `config-changed` (Redis) → le worker `copy-trading` relance la surveillance si elle était arrêtée |
| Kill switch / book down | `alert` → `AlertBanner` |

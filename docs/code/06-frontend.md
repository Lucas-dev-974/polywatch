# Package `@polywatch/frontend`

UI SolidJS (Vite, port 5173). Proxy dev vers le backend : `/api` et `/socket.io` → `localhost:3000`.

## Structure (`App.tsx`)

Pas de routeur tiers : un signal `page` pilote des `<Show>` parmi les pages
(`APP_PAGES` dans `lib/ui-persistence.ts`). Auth par signal `loggedIn`
(présence d'un refresh token) ; au mount, `App.tsx` rafraîchit la session
pour restaurer l'access token en mémoire.

| Page | Composition |
|---|---|
| `simulation` | `SimulationPage` : `SimHero` + 2 onglets — Activité (`PositionCard`, `EventsPanel`, `ExecutionLog`), Analytics (`SimAnalyticsPanel`, `SimMarketAnalyticsPanel`) — voir [`snapshots-simulation.md`](../snapshots-simulation.md) |
| `real` | `RealHero` (snapshot + clôture période) + `PositionCard mode="real"` + `EventsPanel` + `ExecutionLog mode="real"` |
| `snapshots` | `SnapshotsPage` : switch Simulation / Réel — `SimulationSnapshotsPanel` ou `RealSnapshotsPanel` (sessions, snapshots, comparaison, archives) — voir [`snapshots-simulation.md`](../snapshots-simulation.md) et [`snapshots-real.md`](../snapshots-real.md) |
| `reports` | `ReportsPage` — hub rapports Crypto Algo |
| `leaderboard` | `Leaderboard` (pagination, filtres, bouton « Suivre ») |
| `markets` | `MarketsPage` : liste des marchés Gamma avec filtres (`MarketsCryptoFilterBar`, `MarketsIntervalSidebar`, `MarketsTagBar`), métriques (`MarketMetricsPanel`, `MarketCard`) |
| `wallet` | `WalletPage` (comptes, dépôt/retrait, credentials CLOB, historique) |
| `crypto-algo` | `CryptoAlgoPage` : marchés sélectionnés par l'algo, surveillance, settings (`CryptoAlgoSettingsDialog`), notifications (`CryptoAlgoNotificationsDialog`), auto-track |
| `weather-algo` | `WeatherAlgoPage` : villes surveillées + discovery (« Surveiller cette ville »), positions, paramètres switch/hysteresis/throttle (voir [`../weather-algo.md`](../weather-algo.md)) |
| `e2e-tests` | `E2eTestsPage` : lancement et suivi des runs de tests E2E (via `/api/e2e-runs`) |

Header permanent : `WatchlistEditor` + déconnexion. `AlertBanner` (max 10 alertes Socket.IO).

## Couche réseau

**`api.ts`** : wrapper `fetch` avec `Authorization: Bearer`. L'access token est gardé **en mémoire** uniquement (mitigation XSS) ; seul le refresh token — single-use, invalidé à chaque rotation côté backend — est en localStorage. Sur 401 `invalid_token` : refresh singleton (`ensureFreshAccessToken`, une seule promesse en vol) puis retry unique ; échec → `notifySessionExpired()` → logout global.

**`socket.ts`** : Socket.IO singleton, `auth: { token }`, reconnexion infinie. `attachAuthRecovery` rafraîchit le token sur `connect_error: unauthorized` et reconnecte.

Événements consommés : `pnl_tick`, `position_update`, `simulation_balance`, `simulation_reset`, `simulation_snapshot_created`, `real_snapshot_created`, `real_period_rotated`, `execution`, `move_detected`, `alert`.

## Hooks

| Hook | Rôle |
|---|---|
| `useClock(ms=30000)` | Signal horloge périodique (compte à rebours pre-close, durées) |
| `useClobCredentials` | Statut des credentials CLOB (`configured`, `needsSetup`, `refresh`) |
| `useCopyFeedback` | Feedback visuel après copie/fermeture manuelle |
| `useCredsSetupDialog` | État du dialog de setup credentials CLOB |
| `useFormSave` | Sauvegarde différée de formulaires |
| `useMarketsBrowse` | État de navigation des marchés (pagination, filtres) |
| `useMarketPnlSeries` | Série temporelle PnL d'un marché |
| `useTraderPnlSeries` | Série temporelle PnL d'un trader |
| `useMetaMaskAvailable` | Détection MetaMask disponible |
| `useEasternTime` | Conversion heure est (Amérique) |
| `useChartWidth` | Largeur réactive pour graphiques |
| `useHorizontalResize` | Redimensionnement horizontal par drag |
| `useDialog` | Verrou scroll + fermeture Échap pour les dialogs |
| `useTradingWallet` | Données `GET /wallet` + refresh sur `position_update` |
| `useSimulationSnapshots` | Liste snapshots sim : pagination, filtres, sélection, comparaison |
| `useRealSnapshots` | Liste snapshots / périodes réel : même UX, APIs `/real-*` |

## `lib/` — modules principaux

| Module | Rôle |
|---|---|
| `position.ts` | Types Position/PnlTick, calculs PnL agrégés, labels (statut, raison de fermeture, liquidité) |
| `execution.ts` | Types et labels d'exécution |
| `simulation.ts` | Balance sim, reset, capital initial |
| `wallet.ts` / `wallet-transfer.ts` | Types wallet, orchestration du retrait (routage server-side / MetaMask L2 / MetaMask direct) |
| `bridge.ts` / `bridge-metamask.ts` | Flux bridge (quote, adresses, statut) + envoi MetaMask (encodage calldata ERC-20, switch de chaîne) |
| `metamask-relayer-withdraw.ts` | Retrait L2 : prepare → signature EIP-712 (`BrowserProvider`) → submit |
| `pusd-transfer.ts` | Transferts pUSD MetaMask (dépôt/retrait directs) |
| `clob-credentials.ts` | Formulaire credentials L2 + Builder |
| `private-key.ts` | Validation/dérivation d'adresse depuis une clé privée (saisie wallet account) |
| `ethereum.ts` | Détection MetaMask, connexion, `ensurePolygonNetwork` (avec `wallet_addEthereumChain`) |
| `pusd-errors.ts` | Mapping codes d'erreur backend → messages français |
| `move-events.ts` | Types et labels des mouvements copy-trading (`MoveEvent`, filtres mode/source) |
| `algo-events.ts` | Types et labels des événements algo (`AlgoEvent`, status, formatage temps/marché) |
| `wallet-history.ts`, `address.ts`, `date.ts`, `clipboard.ts` | Utilitaires |

## Composants par fonctionnalité

- **Positions** : `PositionCard` (chargement open/closed, socket + poll 30 s, pnlMap par tick) → `PositionTabsBar`, `PositionPnlSummary`, `OpenPositionsList`/`ClosedPositionsList` → lignes (`PositionRow*`, `PositionMarketLink`, `PositionCloseButton`).
- **Heros** : `SimHero` (balance sim + reset + snapshot), `RealHero` (balance wallet + snapshot + clôture période + toggle trading réel), `ModeHeroBalanceStat`.
- **Settings** : `EnvSettingsDialog` (onglets Entrée — sizing, ratio bid/ask min, tags marché, plafond position ; Sortie — SL/TP/trailing, pré-clôture ; Risque — limites, kill switch), `MarketTagsSection` (whitelist types de marché via `GET /api/market-tags`), `settings-sections/fields`, `lib/market-tags.ts` (labels FR).
- **Wallet** : `WalletPage`, `PusdTransferDialog` (dépôt MetaMask/bridge, retrait routé), `BridgeDepositPanel` (quote + polling statut 15 s), `WalletAccountsDialog` (CRUD + validation live de la clé privée), `ClobCredentialsDialog`, `WalletHistorySection`/`Panel`, `WalletPolywatchExecutions`.
- **Autres** : `Login`, `WatchlistEditor` (optimistic updates avec rollback), `Leaderboard`, `ExecutionLog`, `EventsPanel` (événements copy-trading + algo, filtrable par source Copy/Algo), `AlertBanner`, `Dialog` (portal), `MetaMaskButton`, `CredField(s)`.
- **Crypto-Algo** : `CryptoAlgoPage` (page dédiée, mode plein écran), `CryptoAlgoSettingsDialog`, `CryptoAlgoNotificationsDialog`, `AlgoMarketCard`, `SurveillanceHistoryCard`, `AlgoEventRow` (ligne d'événement algo dans le panneau Événements).
- **Marchés** : `MarketsPage`, `MarketCard`, `MarketMetricsPanel`, `MarketsCryptoFilterBar`, `MarketsCryptoCurrencyFilterBar`, `MarketsIntervalSidebar`, `MarketsTagBar`.
- **Trader Insight** : `TraderProfilePage`, `TraderActivityTimelineChart`, `TraderCapitalEvolutionChart`, `TraderFundingSection`, `TraderFundingTimelineChart`, `TraderMarketBreakdownChart`, `TraderPnlEvolutionChart`.
- **Analytics simulation** : `SimAnalyticsPanel`, `SimAnalyticsChartSection`, `SimAnalyticsTable`, `SimAnalyticsCategoryChart`, `SimMarketAnalyticsPanel`, `SimMarketAnalyticsChartSection`, `SimMarketAnalyticsTable`, `SimMarketAnalyticsRank`, `SimMarketYesNoBreakdown`.
- **Utilitaires** : `CollapsiblePanel`, `CountdownContext`, `CountdownTimer`, `NavClock`, `PolygonscanSettingsDialog`, `TimeSeriesLineChart`, `WithdrawTransferFields`, `PusdTransferSummary`.

## Flux utilisateur

1. **Login** : `POST /auth/login` → tokens → `connectSocket()`.
2. **Watchlist** : dialog CRUD + toggles `active`/`simEnabled`/`realEnabled` ; ajout direct depuis le leaderboard.
3. **Suivi des positions** : chargement au mount, refresh sur `position_update`, métriques à la volée sur `pnl_tick`, poll de secours 30 s.
4. **Reset simulation** : confirmation → `POST /simulation-balance/reset` avec **`algoKind`** (crypto / weather / copy) → purge Redis **scopée au kind** (`purgeSimExecutionRedisState`) → `simulation_reset` (WS, payload avec `algoKind`) + canal Redis `simulation-reset` (crypto-algo / worker).
5. **Setup mode réel** : credentials CLOB (chiffrés serveur) → wallet accounts (clé signer validée localement) → approbations CLOB automatiques côté worker → toggle « trading réel ».
6. **Dépôt** : MetaMask direct (pUSD Polygon) ou bridge multi-chain (adresses générées + suivi).
7. **Retrait** : selon le type de signature du compte — serveur (EOA/relayer) ou MetaMask (signature EIP-712 du batch deposit wallet).

## Points d'attention connus

Les constats frontend de l'audit (`audits/AUDIT-CODEBASE-2026-06-10.md`) sont **corrigés** : `socket.off` avec référence de handler (C-3), garde + bannière d'erreur sur `WalletPage` (H-11), `onCleanup` enregistré avant tout `await` (H-12), access token en mémoire (H-10). Restent ouverts les constats bas B-9 à B-11.

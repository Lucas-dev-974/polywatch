# Package `@polywatch/copy-trading`

Service de détection copy : polling traders Polymarket, détection des moves,
pipelines entry/exit, enqueue `COPY_*` sur `order-signals`.

**Sans credentials CLOB** (comme crypto-algo). L'exécution reste dans
`@polywatch/worker`.

Voir aussi [`02-pipeline-copy-trading.md`](02-pipeline-copy-trading.md) et
[`../reference/pipeline-copy-trading.md`](../reference/pipeline-copy-trading.md).

## Démarrage (`index.ts`)

1. PostgreSQL + `assertDatabaseExists`
2. Services : `WatchlistService`, `RiskService`, (+ réservation / simulation /
   market / move-event via les processors)
3. Redis (cmd / pub / sub + consumer dédié `move-events`)
4. `PolymarketConnectionManager` (**core**) pour books entry +
   `pending-move-assets` local
5. Producer `order-signals` (handler noop) ; consumer interne `move-events`
6. `waitForBackendReady`
7. Bootstrap : `markFirstPollPendingForNewTraders`, puis
   `recoverOrphans()` (liste Redis `move-events:processing`), puis
   `recoverOrphanMoves()` (DB)
8. WS books + **polling conditionnel** : le `MoveDetector` démarre au boot,
   mais s'arrête si `simCopyTradingEnabled` **et** `realCopyTradingEnabled` sont
   désactivés, puis reprend sur `config-changed`.
9. Heartbeat canal `heartbeat` + clé `copy-trading:heartbeat` EX 60
10. Subscribe `config-changed` (invalidate watchlist/risk, `setIntervalMs`,
    restart polling if copy-trading re-enabled, refresh books),
    `simulation-reset` (log ; purge reste backend)
11. SIGTERM/SIGINT : flag `shuttingDown`, `stopPolling` (flag `stopped` sur
    MoveDetector), clear timers heartbeat / pending-book-sync, `safeQuit` Redis

## Processors

| Fichier | Rôle |
|---|---|
| `move-detector.ts` | Polling Data API (intervalle par défaut `DEFAULT_MOVE_DETECTOR_INTERVAL_MS` = 2 000 ms, clamping via `setIntervalMs` entre `MIN`/`MAX_MOVE_DETECTOR_INTERVAL_MS`), enqueue `move-events`. **Ignore** les adresses non Ethereum (`isPollableTraderAddress`) — sentinelles `crypto-algo` / `weather-algo` non pollées |
| `copy-processor.ts` | Consomme `move-events`, gates, pipelines → `order-signals` (`markProcessedWithReasons`) |
| `copy/copy-entry-pipeline.ts` | Sizing, MOS, depth-retry, **`minTimeToClose`**, réservation, BUY `COPY_OPEN` / `COPY_INCREASE` |
| `copy/copy-exit-pipeline.ts` | SELL miroir `COPY_CLOSE` / `COPY_DECREASE` |
| `copy/copy-risk-gate.ts` | Kill switch, flags copy, tags marché (`getCopyAllowedMarketTags`), proximité SL |

## Infra Polymarket locale (C5)

| Fichier | Note |
|---|---|
| `polymarket/circuit-breaker.ts` | Copie quasi-identique de `core` / `worker` |
| `polymarket/token-bucket.ts` / `rate-limited-fetch.ts` | Idem (trio C5) |
| `polymarket/api-client.ts` | **Spécifique** Data API (≠ client minimal core) — ne pas centraliser |
| `polymarket/pending-move-assets.ts` | Aussi présent dans core |

## Real-mode (sizing)

| Module | Comportement |
|---|---|
| `sizing/real-cash.ts` | Solde via `realCashOverride` ou `GET /api/internal/balances?mode=real`, **moins** `sumActiveReservedNotional('real')` et `sumInFlightBuyNotionalWithoutReservation('real')` |
| `clob/min-order-shares.ts` | MOS via API CLOB **publique** uniquement (pas de `trading-context` worker) |
| Cash indisponible | `resolveEntryBalances` → `real_cash_unavailable` catché → skip `'Cash réel indisponible'` (move marqué processed, pas de DLQ) |

## Kill switches

- Polling du `MoveDetector` est **interrompu** lorsque `simCopyTradingEnabled`
  **et** `realCopyTradingEnabled` sont tous deux désactivés. Aucune adresse de
  la watchlist n'est alors interrogée.
- Même lorsque le polling tourne, seules les adresses `0x…` (40 hex) sont
  interrogées via Data API `/positions` (`isPollableTraderAddress` dans
  `@polywatch/core`). Les entrées sentinelles algo (`crypto-algo`,
  `weather-algo`) restent en watchlist pour le rattachement des positions, mais
  ne génèrent plus d'erreurs 400 ni de pression sur le circuit breaker Data API.
- Le detector est relancé automatiquement sur `config-changed` dès que l'un
  des deux toggles est réactivé.
- `simCopyTradingEnabled` / `realCopyTradingEnabled` bloquent uniquement les
  **entrées** dans `evaluateCopyMoveGate` ; sorties miroir toujours évaluées.
- Défense en profondeur côté worker Executor :
  `sim_copy_trading_disabled` / `real_copy_trading_disabled` sur
  `COPY_OPEN` / `COPY_INCREASE`.

## Désactivation globale du copy trading

Le `MoveDetector` interrompt **complètement** sa boucle de surveillance lorsque
`simCopyTradingEnabled` **et** `realCopyTradingEnabled` sont tous deux
`false` :

- Le timer interne est arrêté (`stopPolling()`).
- Aucune requête n'est envoyée à l'API Polymarket Data pour les adresses de la
  watchlist.
- Le process `copy-trading` reste actif et continue de consommer les événements
  déjà en file Redis.

Dès qu'un `config-changed` Redis est émis et que l'un des toggles est réactivé,
le handler Redis relance `moveDetector.startPolling()` et la surveillance reprend
au prochain cycle.

## Frontière cross-service

Uniquement `order-signals` vers le worker. La file `move-events` est **owned**
par copy-trading (producer + consumer dans le même process).

## Infra

- Docker Compose : service `copy-trading` (`packages/copy-trading/Dockerfile`).
- Root : `npm run dev:copy-trading` ; inclus dans `npm run dev` / `build` / `test`.

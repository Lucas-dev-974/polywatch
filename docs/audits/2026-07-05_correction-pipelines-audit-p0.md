# Correctifs pipelines — audit subagents (2026-07-05)

Synthèse des corrections appliquées après audit parallèle des pipelines
(MoveDetector, Copy Entry/Exit, Executor, ResultsConsumer, Strategy,
Watchdogs, Crypto-Algo Entry, Market Tracking).

## P0 corrigés

| # | Problème | Correctif | Fichiers |
|---|----------|-----------|----------|
| 1 | Hash algo identique sim/real | `hashAlgoOrderSignalId` inclut `::mode` | `core/idempotence/hash.ts`, `crypto-algo/.../algo-entry-pipeline.ts` |
| 2 | Callback WS écrasé (price feed vs percent publisher) | Handler composé via `dispatchBookUpdate()` | `crypto-algo/price-feed.ts`, `crypto-algo/index.ts` |
| 3 | Executor sans annulation CLOB si lock expiré | `AbortSignal` propagé jusqu'à CLOB ; pas d'enqueue si lock timeout | `worker/executor.ts`, `real-executor.ts`, `with-timeout.ts` |
| 4 | Double redeem live | `claimUnlessFilled` retourne `false` si `REDEMPTION` en vol | `core/services/execution.service.ts` |
| 5 | Baseline tronquée ? faux OPENED | Pas de baseline si `snapshotTruncated` ; `firstPollPending` conservé si tronqué | `poll-cycle.service.ts`, `move-detector.ts` |

## Autres correctifs (audit + vérification)

- **Reprise réservation** : skip permanent libère la réservation (copy + algo) ; logique extraite dans `core/sizing/resume-reserved-entry.ts`.
- **Retry forced-exit** : `failedExecution` propage `reason` ; `results-consumer` lit `execution.reason` au lieu d'un cast `OrderSignal`.
- **Code mort** : `hasOpenCopiedPosition`, params morts move-detector, imports/helpers inutilisés executor/strategy.
- **Tests infra** : `pg-mem` — `version()`, `current_database()`, advisory locks, opérateur timestamptz.

## Refactor documentation (2026-07-05)

- Factorisation `resumeEntryFromReservation` partagée copy + crypto-algo.
- Suppression alias `failedRealExecution` ? `failedExecution` uniquement.
- Mise à jour : `pipeline-copy-trading.md`, `code/02-pipeline-copy-trading.md`, `code/03-core.md`, `code/07-crypto-algo.md`, `plans/VERIFICATION_REPORT.md`.

## P1 restants (non traités)

- Copy Exit : retry transitoire, annulation `pending` sur CLOSED, cumul MOS DECREASED.
- Strategy : `peakClosurePnl` en illiquide (mark display vs conservateur).
- Market Tracking : throttle avant persistance/push HTTP.
- Crypto-algo : kill switch entrées, URL notify-changed, re-entry consommé sur skip.
- Executor : statut `partial` dans `alreadyInFlight`.
- Notification WS « failed » après fill réussi (race ResultsConsumer).

## Vérification

Tests au moment de la correction : core 385/385, worker 121/121, crypto-algo 29/29.

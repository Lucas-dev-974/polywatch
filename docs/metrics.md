# Métriques Prometheus

> **Métriques de marché** (prix, liquidité, volume, carnet, historique Polymarket) :
> voir [`metriques-marche.md`](./metriques-marche.md) pour l'inventaire complet,
> les lacunes vs CLOB/Gamma/Data API et la roadmap d'enrichissement.

Polywatch expose des métriques au format Prometheus sur `GET /metrics` (port
`3000`, protégé par l'en-tête `x-service-token`). Les métriques sont **définies**
dans `packages/backend/src/metrics.ts` via `prom-client` et **exposées** par le
backend uniquement.

> **État au 2026-08-07 :** métriques P0 actives via push HTTP worker →
> `POST /api/internal/metrics/*`. Motifs instrumentés : SL / TP / TRAILING /
> PRE_CLOSE_* (pas de `TIME_EXIT` — feature retirée).

## Accès

```bash
curl -H "x-service-token: <SERVICE_TOKEN>" http://localhost:3000/metrics
```

Le token est configuré via `SERVICE_TOKEN` (voir [`configuration.md`](./configuration.md)).

## Architecture d'instrumentation

```
Worker                                  Backend (registry prom-client)
─────────────────────                   ──────────────────────────────
executor.ts                             GET /metrics
  └─ beginClose()                         ← collectDefaultMetrics (Node.js)
     closingAttemptSeq === 1 && !resumed
       └─ POST /api/internal/metrics/exit-event ─→ recordExitEvent()
                                           (SL, TP, TRAILING, PRE_CLOSE_*,
                                            KILL_SWITCH)

strategy-processing.ts
  └─ runEvaluateAll() (~1 Hz throttle)
       └─ POST /metrics/strategy-cycle ─→ recordStrategyCycle()
                                           (positions open-only by mode,
                                            zeros when idle, spread, duration)

move-detector.ts
  └─ POST /metrics/circuit-breaker ────→ recordCircuitBreakerState()

Backend direct (sans worker) :
  simulation / auto-snapshot-loop         → snapshot_*
  clob-ops-routes.ts                      → redemption_* (real only)
  positions.ts / simulation.ts            → api_route_duration_ms (partiel)
```

Le worker **n'importe pas** `prom-client`. Toutes les métriques sont poussées
via `POST /api/internal/metrics/*` avec `X-Service-Token`.

## Métriques définies

Préfixe commun : `polywatch_`. Les métriques Node.js par défaut (heap, event
loop, etc.) sont exposées via `collectDefaultMetrics`.

Légende **Statut** :

| Statut | Signification |
|--------|---------------|
| **Actif** | Alimenté en production |
| **Partiel** | Alimenté dans certains cas seulement |
| **Déclaré** | Défini dans `metrics.ts`, jamais incrémenté |

### Positions

| Nom | Type | Labels (code) | Statut | Description |
|-----|------|---------------|--------|-------------|
| `polywatch_positions_open` | Gauge | — | **Actif** | Positions `open` (strict, pas open-like) |
| `polywatch_positions_open_by_mode` | Gauge | `mode` | **Actif** | Positions ouvertes par mode (`sim` / `real`) |
| `polywatch_positions_by_status` | Gauge | `status` | **Actif** | Positions par statut (open, closing, closed, etc.) |
| `polywatch_illiquid_positions` | Gauge | — | **Actif** | Positions illiquides (carnet figé / spread excessif) |

### Événements de risque

| Nom | Type | Labels (code) | Statut | Description |
|-----|------|---------------|--------|-------------|
| `polywatch_sl_fired_total` | Counter | — | **Actif** | Stop-loss déclenchés (1er beginClose) |
| `polywatch_tp_fired_total` | Counter | — | **Actif** | Take-profit déclenchés |
| `polywatch_trailing_fired_total` | Counter | — | **Actif** | Trailing stops déclenchés |
| `polywatch_pre_close_total` | Counter | `type` | **Actif** | Sorties pré-clôture (`PRE_CLOSE_LOSS`, `PRE_CLOSE_WIN`) |
| `polywatch_kill_switch_total` | Counter | — | **Actif** | Force-close kill switch |
> **Sémantique** : chaque compteur est incrémenté **exactement une fois** par
> cycle de vie de position, au moment du `beginClose` réussi dans `executor.ts`,
> avec le guard `closingAttemptSeq === 1 && !resumed`. Les retries (échec fill,
> mos-defer) ne sont **pas** recomptés.
>
> `COPY_CLOSE` et `MANUAL` sont exclus des compteurs exit (hors scope worker).

### Spread & cycle stratégique

| Nom | Type | Labels | Statut | Description |
|-----|------|--------|--------|-------------|
| `polywatch_spread_mean` | Gauge | — | **Actif** | Ratio relatif moyen `|executableBidVwap − lastCloseableBidVwap| / mid` des positions liquides du dernier cycle (push throttlé ~1 Hz) |
| `polywatch_strategy_eval_duration_ms` | Histogram | — | **Actif** | Durée du cycle `runEvaluateAll` en ms |
| `polywatch_strategy_eval_positions` | Gauge | — | **Actif** | Positions évaluées au dernier cycle |

### Fraîcheur worker

| Nom | Type | Labels | Statut | Description |
|-----|------|--------|--------|-------------|
| `polywatch_worker_metrics_last_push_timestamp` | Gauge | — | **Actif** | Unix timestamp (secondes) du dernier push metrics reçu par le backend |

> Toute alerte sur les gauges worker **doit** vérifier la fraîcheur :
> `time() - polywatch_worker_metrics_last_push_timestamp < 90`

### Performances API

| Nom | Type | Labels (code) | Statut | Description |
|-----|------|---------------|--------|-------------|
| `polywatch_clob_fetch_duration_ms` | Histogram | — | Déclaré | Latence appels CLOB |
| `polywatch_clob_errors_total` | Counter | `endpoint` | Déclaré | Erreurs CLOB par endpoint |
| `polywatch_data_api_fetch_duration_ms` | Histogram | — | Déclaré | Latence Data API |
| `polywatch_data_api_errors_total` | Counter | — | Déclaré | Erreurs Data API |

### Circuit breaker

| Nom | Type | Labels (code) | Statut | Instrumentation |
|-----|------|---------------|--------|-----------------|
| `polywatch_circuit_breaker_open` | Gauge | `name` | **Actif** | Worker (`move-detector.ts`) → `POST /api/internal/metrics/circuit-breaker` → `recordCircuitBreakerState()` côté backend. Label réel : `PolymarketDataAPI`. |

### WebSocket

| Nom | Type | Labels | Statut | Description |
|-----|------|--------|--------|-------------|
| `polywatch_ws_reconnect_total` | Counter | `channel` | Déclaré | Reconnexions WS (`book`, `user`) |

### Rédemption & snapshots

| Nom | Type | Labels (code) | Statut | Instrumentation |
|-----|------|---------------|--------|-----------------|
| `polywatch_redemption_total` | Counter | `status`, `mode` | **Partiel** | `packages/backend/src/routes/internal/clob-ops-routes.ts` — **mode réel uniquement** (redeem on-chain). La rédemption sim n'est pas comptée. |
| `polywatch_redemption_payoff_total` | Counter | `outcome` | **Partiel** | Idem (`win` / `loss`, real only) |
| `polywatch_snapshot_created_total` | Counter | `source` | **Actif** | `simulation.ts`, `auto-snapshot-loop.ts` — labels `auto`, `manual`, `reset` |
| `polywatch_snapshot_count` | Gauge | — | **Actif** | Synchronisé après create, prune et delete-all (`simulation.ts`, `auto-snapshot-loop.ts`) |
| `polywatch_snapshot_purge_total` | Counter | — | **Actif** | `auto-snapshot-loop.ts` |

### API

| Nom | Type | Labels (code) | Statut | Instrumentation |
|-----|------|---------------|--------|-----------------|
| `polywatch_api_route_duration_ms` | Histogram | `route` | **Partiel** | `positions.ts`, `simulation.ts` seulement (pas de middleware global) |

### Weather question parse

| Nom | Type | Labels (code) | Statut | Instrumentation |
|-----|------|---------------|--------|-----------------|
| `polywatch_weather_question_parse_total` | Counter | `result` (`parsed`, `unparsed`) | **Actif** | Weather-algo strategy-runner + backend discover route → `POST /api/internal/metrics/weather-question-parse` |

## Instrumentation réelle (résumé)

| Métrique | Source |
|----------|--------|
| `positions_open`, `positions_open_by_mode`, `positions_by_status` | Worker `strategy-processing.ts` → `POST /api/internal/metrics/strategy-cycle` |
| `illiquid_positions` | Worker `strategy-processing.ts` → `POST /api/internal/metrics/strategy-cycle` |
| `spread_mean` | Worker `strategy-processing.ts` → `POST /api/internal/metrics/strategy-cycle` |
| `strategy_eval_duration_ms` | Worker `strategy-processing.ts` → `POST /api/internal/metrics/strategy-cycle` |
| `strategy_eval_positions` | Worker `strategy-processing.ts` → `POST /api/internal/metrics/strategy-cycle` |
| `sl_fired_total`, `tp_fired_total`, `trailing_fired_total` | Worker `executor.ts` beginClose → `POST /api/internal/metrics/exit-event` |
| `pre_close_total` | Worker `executor.ts` beginClose → `POST /api/internal/metrics/exit-event` |
| `kill_switch_total` | Worker `executor.ts` beginClose → `POST /api/internal/metrics/exit-event` |
| `worker_metrics_last_push_timestamp` | Backend, mis à jour à chaque POST metrics worker |
| `circuit_breaker_open` | Worker `move-detector.ts` → `POST /api/internal/metrics/circuit-breaker` |
| `snapshot_created_total` | Backend simulation |
| `snapshot_purge_total` | Backend auto-snapshot loop |
| `snapshot_count` | Backend (purge totale) |
| `redemption_total` / `redemption_payoff_total` | Backend après redeem on-chain |
| `api_route_duration_ms` | Backend (routes positions + simulation) |
| `weather_question_parse_total` | Weather-algo strategy-runner + backend discover route → `POST /api/internal/metrics/weather-question-parse` |

**Non instrumentées** : latences CLOB/Data API, reconnexions WS (P1/P2).

## Exemples PromQL

Requêtes utilisables **aujourd'hui** :

```promql
# État du circuit breaker Data API
polywatch_circuit_breaker_open{name="PolymarketDataAPI"}

# Snapshots simulation créés par minute
rate(polywatch_snapshot_created_total[5m])

# Purges de snapshots
rate(polywatch_snapshot_purge_total[5m])

# Rédemptions on-chain (real)
rate(polywatch_redemption_total[5m])

# Positions ouvertes par mode
polywatch_positions_open_by_mode

# Taux de SL déclenchés
rate(polywatch_sl_fired_total[5m])

# Taux de parse weather question
rate(polywatch_weather_question_parse_total[5m])

# Durée du cycle stratégique (95e percentile)
histogram_quantile(0.95, rate(polywatch_strategy_eval_duration_ms_bucket[5m]))

# Fraîcheur du worker
time() - polywatch_worker_metrics_last_push_timestamp
```

## Alerting

| Alerte | Condition | Opérationnel ? |
|--------|-----------|----------------|
| Worker metrics stale | `time() - polywatch_worker_metrics_last_push_timestamp > 90` | **Oui** |
| Circuit breaker ouvert | `polywatch_circuit_breaker_open == 1` | **Oui** |
| Aucun snapshot auto | `rate(polywatch_snapshot_created_total{source="auto"}[1h]) == 0` | **Oui** (si auto-snapshot activé) |
| Aucune position ouverte | `polywatch_positions_open == 0` AND fraîcheur OK | **Oui** |
| Ratio illiquide élevé | `polywatch_illiquid_positions / polywatch_positions_open > 0.5` AND fraîcheur OK | **Oui** |
| Cycle stratégique lent | `histogram_quantile(0.95, rate(polywatch_strategy_eval_duration_ms_bucket[5m])) > 500` | **Oui** |
| SL anormal | `rate(polywatch_sl_fired_total[5m]) > 0.05` AND fraîcheur OK | **Oui** |
| Trop d'erreurs CLOB | `rate(polywatch_clob_errors_total[5m]) > 0.1` | **Non** (compteur à 0) |

> **Note** : les compteurs exit sont **best-effort** (fire-and-forget HTTP). En cas
> de panne backend, un sous-comptage est possible — à corréler avec les logs
> `close rejected`, `forced exit close retry enqueued`.

## Prochaines étapes

Voir [`plans/2026-07-05_PLAN_P0_METRIQUES.md`](./plans/2026-07-05_PLAN_P0_METRIQUES.md) :
- P1 : latences CLOB/Data API, reconnexions WS
- P2 : middleware `api_route_duration_ms` global

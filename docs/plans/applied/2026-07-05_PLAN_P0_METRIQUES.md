# PLAN P0 : Mùtriques Prometheus ù doc + instrumentation critique

**Date** : 2026-07-05  
**Rùvision** : 2026-07-05 (post-revue ù corrections surcomptage, sùmantique gauges, fraùcheur)  
**Rùvision 2** : 2026-07-05 (post-vùrification code ù dedup exit corrigùe `closingAttemptSeq === 1` au lieu de `!resumed`, filtre `COPY_CLOSE`/`MANUAL` cùtù worker, comptage avant garde mos)  
**Contexte** : Audit [`2026-07-05_audit-alignement-documentation-codebase.md`](../../audits/2026-07-05_audit-alignement-documentation-codebase.md)  
**Objectif** : Dùbloquer l'exploitation ù la doc reflùte la rùalitù, et les mùtriques P0 deviennent opùrationnelles pour le monitoring SL/TP et l'ùtat des positions.  
**Approche** : Option C (hybride) ù correction doc immùdiate, puis instrumentation worker ? backend sur le pattern existant `POST /api/internal/metrics/*`.

---

## Rùsumù exùcutif

| Problùme | Impact ops | Action P0 |
|----------|------------|-----------|
| 18/24 mùtriques jamais alimentùes | Alertes PromQL inopùrantes, dashboards vides | Instrumenter le lot P0 (**13 mùtriques** + 1 gauge fraùcheur) |
| `docs/metrics.md` cite des fichiers worker inexistants | Fausse confiance, debug impossible | Rùùcriture avec statut + labels rùels |
| Labels doc ? code (`redemption_total`, `api_route_duration_ms`) | Requùtes PromQL cassùes | Corriger la doc ; ne pas changer les labels code en P0 |
| Worker sans `prom-client` | Architecture doc incorrecte | Documenter le flux HTTP push ; pas de registry worker |
| Comptage au signal (plan v1) | Surcomptage 2ù10ù sur SL/TP | **Corrigù** : comptage au `beginClose` de la **premiùre** clùture (`closingAttemptSeq === 1 && !resumed`) |

**Hors scope P0** (P1/P2, plan sùparù) : latences CLOB/Data API, WS reconnect, redemption sim, `snapshot_count`, middleware `api_route_duration_ms` global, fermetures `MANUAL` / `COPY_CLOSE`.

**Estimation** : 2 jours dev + 0,5 jour validation ops.

---

## ùtat actuel (baseline)

```
Worker                          Backend (prom-client registry)
??????                          ?????????????????????????????
move-detector.ts                metrics.ts (24 dùfinitions)
  ?? POST ù/metrics/circuit-breaker ??? recordCircuitBreakerState()
                                         GET /metrics

strategy-processing.ts          (aucun appel)
executor.ts                     (aucun appel)
position-exit-evaluator.ts      (aucun appel)
kill-switch-monitor.ts          (aucun appel)
```

**Mùtriques dùjù alimentùes** (ne pas casser) :

| Mùtrique | Source | Notes |
|----------|--------|-------|
| `circuit_breaker_open` | Worker ? internal API | Label rùel : `PolymarketDataAPI` |
| `redemption_total` / `redemption_payoff_total` | `clob-ops-routes.ts` | Mode `real` uniquement |
| `snapshot_created_total` | `simulation.ts`, `auto-snapshot-loop.ts` | Labels `auto` / `manual` / `reset` |
| `snapshot_purge_total` | `auto-snapshot-loop.ts` | ù |
| `snapshot_count` | Suppression totale seulement | Quasi jamais mis ù jour |
| `api_route_duration_ms` | `positions.ts`, `simulation.ts` | Label `route` seul (pas `method`/`status`) |

---

## Architecture cible P0 (rùvisùe)

```
???????????????????????????????????????????????????????????????????
? Worker                                                          ?
?                                                                 ?
?  Executor.executeSignal()                                       ?
?    ?? beginClose 1re cloture (closingAttemptSeq === 1 && !resumed) ?
?         ?? MetricsReporter.recordExit(reason)  ???              ?
?           (SL, TP, TRAILING, PRE_CLOSE_*,         ?              ?
?            KILL_SWITCH, TIME_EXIT)                ?              ?
?           ? point unique, tous chemins            ?              ?
?                                                   ?              ?
?  StrategyProcessing.runEvaluateAll()              ?              ?
?    ?? pushStrategyCycle() (100 ms)  ?????????????????? POST
?    ?? refreshStatusCounts() (1 s)                 ?    fire-and-forget
?                                                   ?    x-service-token
????????????????????????????????????????????????????????????????????
                                                    ?
???????????????????????????????????????????????????????????????????
? Backend  /api/internal/metrics/*                                ?
?                                                                 ?
?  POST /metrics/exit-event        ? recordExitEvent()            ?
?  POST /metrics/strategy-cycle    ? recordStrategyCycle()        ?
?                                  + touchWorkerMetricsFreshness()?
?                                                                 ?
?  record*() dans metrics.ts  ?  registry prom-client             ?
?  GET /metrics                                                   ?
???????????????????????????????????????????????????????????????????
```

**Principes** :

1. **Pas de `prom-client` dans le worker** ù registry unique cùtù backend.
2. **Fire-and-forget** ù mùme pattern que `move-detector.ts` : `void postBackendJson(...).catch(log.warn)`.
3. **Compteurs exit sur la 1re clùture** ù `closingAttemptSeq === 1 && !resumed` dans `executor.ts`, pas ù `emitCloseSignal`, et **avant** le garde mos (voir ù Corrections revue). Filtre `COPY_CLOSE`/`MANUAL` cùtù worker.
4. **Gauges positions depuis DB** ù `status = 'open'` strict, pas `OPEN_LIKE`.
5. **Fraùcheur obligatoire** ù gauge `worker_metrics_last_push_timestamp` mise ù jour ù chaque POST cycle.
6. **Auth** ù `requireServiceToken` dùjù appliquù sur `/api/internal/*`.

---

## Corrections issues de la revue (2026-07-05)

| # | Problùme plan v1 | Correction |
|---|------------------|------------|
| 1 | Comptage dans `emitCloseSignal` ? surcomptage (cycle 100 ms, position encore `open`) | Comptage dans `executor.ts` sur la **premiùre** clùture : `beginClose` success **&& `closingAttemptSeq === 1` && !resumed** (voir ci-dessous) |
| 2 | `positions_open` dùrivù de la boucle open-like | `COUNT(*) WHERE status = 'open'` (+ by mode) via GROUP BY |
| 3 | `spread_mean` formule floue vs help text | `mean(spreadTop / midPrice)` où `midPrice = (bestBid + bestAsk) / 2` |
| 4 | Gauges labellisùes stale | `.reset()` puis `.labels(k).set(v)` ù chaque push |
| 5 | Gauges figùes si worker down | Nouvelle gauge `worker_metrics_last_push_timestamp` |
| 6 | `TIME_EXIT` absent (crypto-algo) | Nouveau compteur `time_exit_fired_total` |
| 7 | GROUP BY status ù 10 Hz | Throttle **1 s** obligatoire en P0 |

### Pourquoi pas `emitCloseSignal` ?

Entre l'enqueue Redis et le `beginClose()` de l'executor, la position reste `status = 'open'`. La stratùgie rùùvalue toutes les **100 ms** (throttle **50 ms**/position). Un SL peut ùmettre **plusieurs signaux** avant passage en `closing`.

### Pourquoi `closingAttemptSeq === 1` et non `!resumed` seul ?

**Le filtre `!resumed` seul ne suffit pas** (erreur du plan v1). Analyse du code rùel :

- `CopiedPosition.closingAttemptSeq` a `default: 0` ; `beginClose` fait `closing_attempt_seq + 1`. La **toute premiùre** transition `open?closing` d'une position donne donc **toujours `closingAttemptSeq === 1`**. `beginClose` n'est jamais appelù hors de l'unique cycle de clùture d'une position (les dùcrùments partiels `COPY_DECREASE` ne sont pas des total-close).
- Sur un **ùchec de clùture** (fill CLOB ratù), `completeExecutionLocked` **remet la position en `open`** (`results-consumer.ts` vùrifie `pos.status !== 'open'` avant de retenter). Le retry (`buildSlCloseRetrySignal` ? `buildCloseOrderSignal`) **incrùmente** le seq ? `beginClose` repart de `open` et renvoie **`resumed: false`** avec `closingAttemptSeq >= 2`.
- Idem pour une nouvelle tentative aprùs `revertClose` (mos-defer) : position remise en `open`, seq incrùmentù.

Donc `!resumed` est `true` sur **tous** les retries ? le plan v1 les aurait **recomptùs** (sur-comptage 2ùNù, exactement le scùnario ù ùliminer). Le seul invariant fiable ù ù premiùre clùture de la position ù est **`closingAttemptSeq === 1`**.

`resumed` reste utile en complùment : un signal **dupliquù** avec le **mùme** seq (branche `closing` + `expectedClosingSeq` ùgal) renvoie `resumed: true` **sans** incrùmenter le seq (donc `closingAttemptSeq` pourrait valoir `1`). Le garde combinù **`closingAttemptSeq === 1 && !resumed`** couvre les deux cas :

| Scùnario | `closingAttemptSeq` | `resumed` | Comptù ? |
|----------|---------------------|-----------|----------|
| 1ùre clùture (SL/TP/ù) | 1 | false | ? +1 |
| Signal dupliquù avant `closing` (mùme seq) | 1 | true | ? |
| Retry forced-exit aprùs ùchec fill | ? 2 | false | ? |
| Nouvelle tentative aprùs `revertClose` (mos-defer) | ? 2 | false | ? |
| Course stratùgie re-emit vs results-consumer (aprùs ùchec) | tous ? 2 | l'un false, l'autre true | ? (le 1er essai a dùjù comptù +1) |

---

## Phase 0 ù Correction documentaire (bloquant ops, ~2 h)

**Fichier** : `docs/metrics.md`

### 0.1 Ajouter une colonne ù Statut ù

| Statut | Signification |
|--------|---------------|
| `implùmentù` | Alimentù en production |
| `partiel` | Alimentù dans certains chemins seulement |
| `dùfini` | Existe dans `metrics.ts`, jamais incrùmentù |

### 0.2 Corriger les labels documentùs

| Mùtrique | Labels rùels (code) |
|----------|---------------------|
| `redemption_total` | `status`, `mode` |
| `redemption_payoff_total` | `outcome` |
| `snapshot_created_total` | `source` |
| `api_route_duration_ms` | `route` (pas `method` / `status`) |
| `circuit_breaker_open` | `name` ù exemple : `PolymarketDataAPI` |

### 0.3 Remplacer la section ù Points d'instrumentation ù

Documenter le flux rùel (post-impl) :

| Mùtrique | Source rùelle |
|----------|---------------|
| `circuit_breaker_open` | Worker `move-detector.ts` ? `POST /api/internal/metrics/circuit-breaker` |
| `*_fired_total`, `pre_close_total`, `kill_switch_total`, `time_exit_fired_total` | Worker `executor.ts` ? `POST /api/internal/metrics/exit-event` |
| Gauges cycle + positions | Worker `strategy-processing.ts` ? `POST /api/internal/metrics/strategy-cycle` |
| `redemption_*` | Backend `clob-ops-routes.ts` (real) |
| `snapshot_*` | Backend simulation / auto-snapshot |
| `api_route_duration_ms` | Backend routes ciblùes |

**Exclusions documentùes** : `MANUAL` (close UI backend), `COPY_CLOSE` ù hors compteurs exit worker.

### 0.4 Qualifier exemples PromQL et alerting

- Marquer **ù opùrationnel aprùs Phase 2 ù** pour SL/TP, positions, strategy eval.
- Alerte `positions_open == 0` : **conditionnùe** ù `worker_metrics_last_push_timestamp` frais (< 90 s).
- Conserver les exemples `circuit_breaker_open` et `snapshot_*` (dùjù valides).

### 0.5 Critùres d'acceptation Phase 0

- [ ] Aucune rùfùrence ù une instrumentation worker directe via `prom-client`.
- [ ] Tableau mùtriques avec statut + labels exacts (incl. nouvelles mùtriques P0).
- [ ] Section architecture ù worker push ? backend registry ù.
- [ ] Formule `spread_mean` documentùe explicitement.

---

## Phase 1 ù Backend : helpers + routes (~5 h)

### 1.1 ùtendre `packages/backend/src/metrics.ts`

**Nouvelles mùtriques** :

```typescript
timeExitFiredTotal: new Counter({
  name: `${prefix}time_exit_fired_total`,
  help: 'Total number of algo time-exit (hard exit) close attempts initiated',
  registers: [registry],
}),
workerMetricsLastPushTimestamp: new Gauge({
  name: `${prefix}worker_metrics_last_push_timestamp`,
  help: 'Unix timestamp (seconds) of the last worker metrics push received by the backend',
  registers: [registry],
}),
```

**Corriger le help text de `spread_mean`** :

```typescript
help: 'Mean relative spread (spreadTop / midPrice) across liquid evaluated positions in the last cycle',
```

**Helpers** :

```typescript
export function recordExitEvent(reason: TotalCloseReason): void {
  switch (reason) {
    case 'SL':            metricsHolder?.slFiredTotal?.inc(); break;
    case 'TP':            metricsHolder?.tpFiredTotal?.inc(); break;
    case 'TRAILING':      metricsHolder?.trailingFiredTotal?.inc(); break;
    case 'PRE_CLOSE_LOSS':
    case 'PRE_CLOSE_WIN': metricsHolder?.preCloseTotal?.labels(reason).inc(); break;
    case 'KILL_SWITCH':   metricsHolder?.killSwitchTotal?.inc(); break;
    case 'TIME_EXIT':     metricsHolder?.timeExitFiredTotal?.inc(); break;
    // MANUAL, COPY_CLOSE : ignorùs (hors worker)
  }
  touchWorkerMetricsFreshness();
}

export interface StrategyCycleSnapshot {
  durationMs: number;
  positionsEvaluated: number;
  /** Positions avec status strictement 'open' (pas open-like). */
  positionsOpen: number;
  positionsOpenByMode: Record<'sim' | 'real', number>;
  positionsByStatus: Record<string, number>;
  illiquidPositions: number;
  /** null si aucune position liquide ùvaluùe ce cycle. */
  spreadMean: number | null;
}

export function recordStrategyCycle(s: StrategyCycleSnapshot): void {
  metricsHolder?.strategyEvalDuration?.observe(s.durationMs);
  metricsHolder?.strategyEvalPositions?.set(s.positionsEvaluated);
  metricsHolder?.positionsOpen?.set(s.positionsOpen);
  metricsHolder?.illiquidPositions?.set(s.illiquidPositions);
  if (s.spreadMean != null) metricsHolder?.spreadMean?.set(s.spreadMean);

  setLabeledGauge(metricsHolder?.positionsOpenByMode, s.positionsOpenByMode);
  setLabeledGauge(metricsHolder?.positionsByStatus, s.positionsByStatus);
  touchWorkerMetricsFreshness();
}

function touchWorkerMetricsFreshness(): void {
  metricsHolder?.workerMetricsLastPushTimestamp?.set(Date.now() / 1000);
}

/** Reset complet puis set ù ùvite les sùries fantùmes prom-client. */
function setLabeledGauge(
  gauge: Gauge<string> | undefined,
  values: Record<string, number>,
): void {
  if (!gauge) return;
  gauge.reset();
  for (const [label, count] of Object.entries(values)) {
    gauge.labels(label).set(count);
  }
}
```

### 1.2 Router `packages/backend/src/routes/internal/metrics-routes.ts`

| Route | Body | Handler |
|-------|------|---------|
| `POST /metrics/exit-event` | `{ reason: TotalCloseReason }` | `recordExitEvent` |
| `POST /metrics/strategy-cycle` | `StrategyCycleSnapshot` | `recordStrategyCycle` |

Validation stricte : reason dans l'enum exit worker (`SL`, `TP`, `TRAILING`, `PRE_CLOSE_*`, `KILL_SWITCH`, `TIME_EXIT`), nombres ? 0.

> `COPY_CLOSE` et `MANUAL` sont des `TotalCloseReason` valides mais **rejetùs** par cette route (400) : ils ne font pas partie des compteurs exit. Le filtrage dùfinitif se fait **cùtù worker** (`WORKER_EXIT_METRIC_REASONS`, cf. 2.1) pour que la route ne reùoive jamais ces reasons ? pas de 400 parasite. La validation route reste stricte comme dùfense en profondeur.

Conserver `POST /metrics/circuit-breaker` dans `watchlist-routes.ts` (pas de migration P0).

### 1.3 Monter le router + documenter `docs/api.md`

### 1.4 Critùres d'acceptation Phase 1

- [ ] POST exit-event SL ? `sl_fired_total` +1, `worker_metrics_last_push_timestamp` mis ù jour.
- [ ] POST strategy-cycle ? gauges + histogram + fraùcheur.
- [ ] `setLabeledGauge` : test qu'un status disparu ne laisse pas de sùrie stale.
- [ ] Tests unitaires validation body + record*.

---

## Phase 2 ù Worker : client + instrumentation (~6 h)

### 2.1 Module `packages/worker/src/metrics-reporter.ts`

```typescript
// COPY_CLOSE et MANUAL sont des TotalCloseReason mais NE sont PAS des metriques
// exit worker : COPY_CLOSE est enfile directement par copy-exit-pipeline (donc
// closingAttemptSeq === 1 le laisserait passer), MANUAL est initie backend.
// Le backend rejette ces reasons (400) -> on filtre ici pour eviter le bruit.
const WORKER_EXIT_METRIC_REASONS = new Set<TotalCloseReason>([
  'SL', 'TP', 'TRAILING', 'PRE_CLOSE_LOSS', 'PRE_CLOSE_WIN', 'KILL_SWITCH', 'TIME_EXIT',
]);

export class MetricsReporter {
  recordExit(reason: TotalCloseReason): void {
    if (!WORKER_EXIT_METRIC_REASONS.has(reason)) return; // COPY_CLOSE / MANUAL : hors scope
    void postBackendJson('/api/internal/metrics/exit-event', { reason })
      .catch((err) => log.warn({ err, reason }, 'failed to report exit metric'));
  }

  pushStrategyCycle(snapshot: StrategyCycleSnapshot): void {
    void postBackendJson('/api/internal/metrics/strategy-cycle', snapshot)
      .catch((err) => log.warn({ err }, 'failed to report strategy cycle metrics'));
  }
}
```

Injecter dans `Executor` et `StrategyProcessing` (constructeur, testable).

### 2.2 Compteurs exit ù point unique `executor.ts`

**Fichier** : `packages/worker/src/processors/executor.ts`

```typescript
if (isTotalCloseSignal(signal)) {
  const closeResult = await this.positionService.beginClose(
    signal.copiedPositionId,
    signal.reason,
    signal.closingAttemptSeq,
  );
  if (!closeResult.success) {
    log.info({ signalId: signal.id }, 'close rejected ù concurrent');
    return;
  }
  // Exactement 1 comptage par cycle de vie de cloture : la toute premiere
  // transition open->closing d'une position donne toujours closingAttemptSeq === 1.
  // Retries forced-exit (revert->open puis nouveau beginClose) ET nouvelles
  // tentatives apres mos-defer -> seq >= 2 -> non comptees.
  // resumed === true (signal duplique, meme seq) -> non compte.
  // Place AVANT le garde mos : semantique "close initie", pas "vente executee".
  if (closeResult.closingAttemptSeq === 1 && !closeResult.resumed) {
    this.metricsReporter.recordExit(signal.reason); // filtre COPY_CLOSE/MANUAL en interne
  }
  // ù suite existante (mos check, etc.)
}
```

**Couverture** : stratùgie (SL/TP/trailing/pre-close/time-exit), kill-switch, `position-branches` KILL_SWITCH. Les retries forced-exit (`results-consumer.ts`) et les nouvelles tentatives aprùs `revertClose` (mos-defer) repassent tous par `beginClose` avec `closingAttemptSeq >= 2` ? **pas de +1**.

**Ne pas instrumenter** : `emitCloseSignal`, `kill-switch-monitor`, `results-consumer` (enqueue retry).

**Sùmantique** : ù premiùre clùture initiùe pour une position ù (**1ù par cycle de vie de position**, pas par tentative, pas ù ordre fill ù). Le comptage a lieu **avant** le garde mos : un SL qui dùclenche mais dont la vente est diffùrùe (quantitù < mos) est tout de mùme comptù une fois.

### 2.3 Gauges cycle ù `strategy-processing.ts`

```typescript
private lastStatusCountsAt = 0;
private cachedStatusCounts: Record<string, number> = {};
private cachedOpenByMode: Record<'sim' | 'real', number> = { sim: 0, real: 0 };

private async refreshStatusCountsIfDue(now: number): Promise<void> {
  if (now - this.lastStatusCountsAt < 1_000) return;
  this.lastStatusCountsAt = now;
  const rows = await this.ds.getRepository(CopiedPosition)
    .createQueryBuilder('p')
    .select('p.status', 'status')
    .addSelect('p.mode', 'mode')
    .addSelect('COUNT(*)', 'count')
    .groupBy('p.status')
    .addGroupBy('p.mode')
    .getRawMany();

  const byStatus: Record<string, number> = {};
  const openByMode = { sim: 0, real: 0 };
  for (const row of rows) {
    const n = Number(row.count);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
    if (row.status === 'open') {
      openByMode[row.mode as 'sim' | 'real'] += n;
    }
  }
  this.cachedStatusCounts = byStatus;
  this.cachedOpenByMode = openByMode;
}

private async runEvaluateAll(): Promise<void> {
  const cycleStart = Date.now();
  // ù kill switch check existant ù

  const positions = await this.ds.getRepository(CopiedPosition).find({
    where: { status: In([...OPEN_LIKE_POSITION_STATUSES]) },
  });

  let positionsEvaluated = 0;
  let illiquidCount = 0;
  const spreadRatios: number[] = [];

  for (const pos of positions) {
    positionsEvaluated++;
    // ù evaluatePosition existant ù
    // Si liquide : spreadRatios.push(spreadTop / midPrice) via computeTopOfBook
    // Si illiquid : illiquidCount++
  }

  await this.refreshStatusCountsIfDue(cycleStart);

  this.metricsReporter.pushStrategyCycle({
    durationMs: Date.now() - cycleStart,
    positionsEvaluated,
    positionsOpen: this.cachedStatusCounts['open'] ?? 0,
    positionsOpenByMode: this.cachedOpenByMode,
    positionsByStatus: this.cachedStatusCounts,
    illiquidPositions: illiquidCount,
    spreadMean: spreadRatios.length > 0
      ? spreadRatios.reduce((a, b) => a + b, 0) / spreadRatios.length
      : null,
  });
}
```

#### Calcul `spread_mean` (formule fixe)

Pour chaque position **liquide** ùvaluùe ce cycle :

```typescript
const top = computeTopOfBook(wsBook);
if (top && top.bestBid > 0 && top.bestAsk > 0) {
  const mid = (top.bestBid + top.bestAsk) / 2;
  spreadRatios.push(top.spreadTop / mid);
}
```

Ne pas utiliser `computeExecutableSpread` seul (ùcart absolu, pas ratio).

#### Early return `positions.length === 0`

**Corriger** : ne plus return early sans push. Pousser un cycle minimal :

```typescript
positionsEvaluated: 0, positionsOpen: cachedù, illiquidPositions: 0, spreadMean: null
```

Le kill-switch check reste exùcutù avant (comportement existant).

### 2.4 Critùres d'acceptation Phase 2

- [ ] Un SL ne produit qu'**un** incrùment mùme si la stratùgie rùùvalue 5ù avant `beginClose` (signaux dupliquùs mùme seq ? `resumed: true`).
- [ ] Retry forced-exit ne rù-incrùmente pas (position remise en `open`, `closingAttemptSeq >= 2`).
- [ ] Nouvelle tentative aprùs `revertClose` (mos-defer) ne rù-incrùmente pas (`closingAttemptSeq >= 2`).
- [ ] Un SL diffùrù pour mos (revert immùdiat) est tout de mùme comptù **une** fois (comptage avant garde mos).
- [ ] `COPY_CLOSE` (copy-exit) et `MANUAL` (close backend) ne POSTent **jamais** `/metrics/exit-event`.
- [ ] `positions_open` = nombre UI positions `open`, pas open-like.
- [ ] `time_exit_fired_total` incrùmentù sur hard exit crypto-algo.
- [ ] `worker_metrics_last_push_timestamp` avance toutes les ~100 ms en run normal.
- [ ] ùchec backend ne bloque jamais le pipeline worker.

---

## Phase 3 ù Tests (~3 h)

| Couche | Fichier | Cas |
|--------|---------|-----|
| Backend | `metrics-routes.test.ts` | Body invalide ? 400 ; body valide ? record appelù |
| Backend | `metrics.test.ts` | `recordExitEvent` (incl. TIME_EXIT), `setLabeledGauge` reset stale |
| Worker | `metrics-reporter.test.ts` | postBackendJson appelù ; erreur rùseau absorbùe ; `COPY_CLOSE`/`MANUAL` ne POSTent pas |
| Worker | `executor.test.ts` | `closingAttemptSeq === 1 && !resumed` ? recordExit |
| Worker | `executor.test.ts` | retry (`closingAttemptSeq >= 2`) ? pas d'appel ; signal dupliquù (`resumed`) ? pas d'appel |
| Worker | `executor.test.ts` | beginClose concurrent failure ? pas d'appel ; SL mos-defer (revert) ? comptù 1ù |
| Worker | `strategy-processing.test.ts` | cycle vide pousse snapshot ; spread/illiquid ; throttle GROUP BY 1 s |

**Test d'intùgration manuel** :

1. Stack dev, position sim ouverte ? `positions_open >= 1`, timestamp fraùcheur rùcent.
2. Forcer SL ? `sl_fired_total` +1 exactement (pas +N), **mùme si le fill CLOB ùchoue et dùclenche des retries** (chaque retry a `closingAttemptSeq >= 2`).
3. Hard exit algo ? `time_exit_fired_total` +1.
3b. Copy-close (trader suivi ferme) ? **aucun** appel `/metrics/exit-event` (COPY_CLOSE filtrù).
4. Kill switch ? `kill_switch_total` +1 par position (pas de double si dùjù closing).
5. Arrùter worker ? timestamp fraùcheur stagne ? alerte testable.

---

## Phase 4 ù Clùture doc (~1 h)

Mettre ù jour `docs/metrics.md` :

- 13 mùtriques P0 + `worker_metrics_last_push_timestamp` en statut `implùmentù`.
- Formule `spread_mean`, sùmantique compteurs (ù close initiù ù), exclusions MANUAL/COPY_CLOSE.
- Playbook alerting (ù ci-dessous).
- Cross-rùfùrence `docs/api.md`.

---

## Playbook alerting opùrationnel

**Prùrequis** : toute alerte sur gauges worker **doit** vùrifier la fraùcheur :

```promql
time() - polywatch_worker_metrics_last_push_timestamp < 90
```

| Alerte | Condition | Seuil |
|--------|-----------|-------|
| Worker metrics stale | `time() - worker_metrics_last_push_timestamp > 90` | immùdiat |
| SL anormal | `rate(sl_fired_total[5m]) > 0.05` AND fraùcheur OK | contexte |
| Positions bloquùes en closing | `positions_by_status{status="closing"} > 0` AND `increase(...[10m]) == 0` | 10 min |
| Ratio illiquide ùlevù | `illiquid_positions / positions_open > 0.5` AND fraùcheur OK | contexte |
| Cycle stratùgique lent | `histogram_quantile(0.95, rate(strategy_eval_duration_ms_bucket[5m])) > 500` | 500 ms |
| Aucune position ouverte | `positions_open == 0` AND fraùcheur OK | 10 min |
| Circuit breaker | `circuit_breaker_open{name="PolymarketDataAPI"} == 1` | 5 min |
| Hard exit algo | `rate(time_exit_fired_total[5m])` | dashboard |

**Note** : les compteurs exit sont **best-effort** (fire-and-forget). En cas de panne backend, sous-comptage possible ù corrùler avec logs `close rejected`, `forced exit close retry enqueued`.

---

## Matrice de livraison P0

| Mùtrique | Phase | Point d'instrumentation |
|----------|-------|-------------------------|
| `sl_fired_total` | 2 | `executor.ts` beginClose `closingAttemptSeq === 1 && !resumed` |
| `tp_fired_total` | 2 | idem |
| `trailing_fired_total` | 2 | idem |
| `pre_close_total` | 2 | idem (label = reason) |
| `kill_switch_total` | 2 | idem |
| `time_exit_fired_total` | 1+2 | idem (**nouveau**) |
| `positions_open` | 2 | GROUP BY status, filtre `open` |
| `positions_open_by_mode` | 2 | idem, throttle 1 s |
| `positions_by_status` | 2 | GROUP BY, throttle 1 s |
| `illiquid_positions` | 2 | compteur boucle ùvaluation |
| `spread_mean` | 2 | `mean(spreadTop/midPrice)` positions liquides |
| `strategy_eval_duration_ms` | 2 | durùe `runEvaluateAll` |
| `strategy_eval_positions` | 2 | positions ùvaluùes par cycle |
| `worker_metrics_last_push_timestamp` | 1 | backend, chaque POST metrics worker |

---

## Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| 10 POST/s strategy-cycle | ~600/min, nùgligeable ; batch unique par cycle |
| Gauges labellisùes stale | `gauge.reset()` avant set (testù Phase 3) |
| Double comptage exit (retries, mos-defer, signaux dupliquùs) | `closingAttemptSeq === 1 && !resumed` ù point unique executor (couvre les retries qui repassent en `open`) |
| `COPY_CLOSE`/`MANUAL` rejetùs par la route exit (400 parasites) | Filtre `WORKER_EXIT_METRIC_REASONS` cùtù worker avant POST |
| GROUP BY coùteux | Throttle **1 s** obligatoire P0 |
| Gauges figùes worker down | `worker_metrics_last_push_timestamp` + alerte |
| Compteurs perdus (backend down) | Documenter best-effort ; logs structurùs en corrùlation |
| Close MANUAL backend | Hors scope ; positions gauges DB restent correctes |

---

## Ordre d'exùcution recommandù

```
Phase 0 (doc) ??? peut shipper seule immùdiatement
       ?
       ?
Phase 1 (backend : mùtriques + routes + fraùcheur)
       ?
       ?
Phase 2 (worker : executor + strategy-processing)
       ?
       ?
Phase 3 (tests) ?? en parallùle partiel avec Phase 2
       ?
       ?
Phase 4 (doc finale + playbook alerting)
```

**PR suggùrùes** :

1. `docs(p0): rewrite metrics.md to reflect current state` ù Phase 0 seule.
2. `feat(metrics): internal API + worker P0 instrumentation` ù Phases 1ù3.
3. `docs(metrics): mark P0 metrics as implemented + alerting playbook` ù Phase 4.

---

## Rùfùrences code

| Fichier | Rùle |
|---------|------|
| `packages/backend/src/metrics.ts` | Dùfinitions + helpers `record*` |
| `packages/backend/src/routes/internal/metrics-routes.ts` | Routes internal (nouveau) |
| `packages/backend/src/routes/internal/watchlist-routes.ts` | Pattern circuit-breaker existant |
| `packages/worker/src/processors/executor.ts` | **Point unique compteurs exit** |
| `packages/worker/src/processors/strategy-processing.ts` | Boucle 100 ms ù snapshot gauges |
| `packages/worker/src/processors/move-detector.ts` | Pattern fire-and-forget |
| `packages/core/src/services/copied-position.service.ts` | `beginClose` / `resumed` |
| `packages/core/src/pricing/top-of-book.ts` | `computeTopOfBook` pour spread_mean |
| `packages/core/src/worker-shared/backend-client.ts` | Client HTTP inter-services |

---

*Plan dùrivù de l'audit d'alignement documentation/codebase ù juillet 2026. Rùvision post-audit intùgrùe le 2026-07-05.*

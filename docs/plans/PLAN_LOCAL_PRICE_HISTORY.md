# Plan : Historique de prix Up/Down local (Approche B — PostgreSQL)

## Contexte

Actuellement, le bouton "Cours marché" fetch l'historique de prix depuis l'API CLOB Polymarket
(`clob.polymarket.com/prices-history`). On veut remplacer cela par un enregistrement local :
le worker snapshot les prix Up/Down chaque seconde pendant la surveillance, les stocke en DB,
et le frontend lit ces données locales via la nouvelle API.

**100% local, aucun fallback Polymarket.** Si pas de ticks → graphique vide.

## Architecture cible

```
Worker (crypto-algo)                          Backend (Express)          Frontend
┌─────────────────────┐                      ┌──────────────────┐       ┌──────────────┐
│ CryptoAlgoPriceFeed │                      │                  │       │              │
│ (WebSocket live)    │                      │  Route refactore  │       │  UpDownPrice │
│                     │                      │  /api/algo/      │       │  Chart       │
│  getOutcomePrices() │                      │  market-chart/   │◄──────│  (dialog)    │
│         │           │                      │  :conditionId    │       │              │
│         ▼           │                      │                  │       └──────────────┘
│  PriceTickRecorder  │                      │  Lit PostgreSQL  │
│  (timer 1s)         │                      │  algo_price_ticks│
│         │           │                      └────────┬─────────┘
│         ▼           │                               │
│  PostgreSQL         │───────────────────────────────┘
│  algo_price_ticks   │
└─────────────────────┘
```

## Décisions clarifiées

| Question | Décision |
|---|---|
| Quels marchés enregistrer ? | **Uniquement les marchés live** — déterminé par requête sur `AlgoSurveillanceSnapshot` (`openCapturedAt IS NOT NULL AND closeCapturedAt IS NULL AND unresolvedAt IS NULL`) |
| Comment obtenir les dates du marché ? | **Le PriceTickRecorder interroge `AlgoSurveillanceSnapshot`** pour récupérer `marketStartAt` et `marketEndAt` (pas depuis `WatchedMarketInput` qui n'a pas ces champs) |
| Callback `onOpenCaptured` | **Notification simple `onOpenCaptured(conditionId)`** — le PriceTickRecorder fait sa propre requête pour les dates |
| Démarrage réactif ? | **Démarrer dès que le snapshot d'ouverture est capturé** (callback `onOpenCaptured`) + refresh périodique corrige les erreurs |
| Batch ou INSERT individuel ? | **INSERT individuel** par marché (plus simple) |
| Fallback Polymarket ? | **Non, 100% local.** Graphique vide si pas de ticks |
| Fréquence d'enregistrement | **1 seconde pour tous les intervalles** (5m=300pts, 15m=900pts, 1h=3600pts) |
| Limite `listTicks` | **5000** (couvre 83min à 1/s — suffisant pour 5m, 15m, 1h) |
| Marchés antérieurs au déploiement | **Pas de ticks → graphique vide** — acceptable, pas de fallback |

## Données enregistrées

Chaque seconde, pour chaque marché live, on enregistre :

| Champ | Type | Description |
|---|---|---|
| `id` | SERIAL PK | Auto-incrémenté |
| `condition_id` | text | Condition ID du marché |
| `up_price` | real | Prix mid du token Up (0..1) |
| `down_price` | real | Prix mid du token Down (0..1) |
| `recorded_at` | timestamp | Moment de l'enregistrement |

**Volume estimé :** ~300 lignes/marché/5min. Pour 10 marchés simultanés → ~36k lignes/heure.
Un cleanup supprime les ticks > 24h.

## Étapes d'implémentation

### Phase 1 — Core (entité + migration + service)

#### 1.1. Nouvelle entité `AlgoPriceTick`

**Fichier :** `packages/core/src/entities/AlgoPriceTick.ts`

```typescript
@Entity('algo_price_ticks')
@Index(['conditionId'])
@Index(['recordedAt'])
export class AlgoPriceTick {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'text', name: 'condition_id' }) conditionId!: string;
  @Column({ type: 'real', name: 'up_price' }) upPrice!: number | null;
  @Column({ type: 'real', name: 'down_price' }) downPrice!: number | null;
  @Column({ type: 'timestamp', name: 'recorded_at' }) recordedAt!: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

#### 1.2. Exporter l'entité

**Fichier :** `packages/core/src/entities/index.ts`
- Ajouter : `export { AlgoPriceTick } from './AlgoPriceTick.js';`

#### 1.3. Enregistrer dans le DataSource

**Fichier :** `packages/core/src/database/data-source.ts`

Deux modifications :
1. Importer `AlgoPriceTick` dans le bloc d'imports (ligne ~26)
2. Ajouter `AlgoPriceTick` au tableau `entities` (ligne ~89)
3. Importer `CreateAlgoPriceTicks1700000000019` (ligne ~46)
4. Ajouter `CreateAlgoPriceTicks1700000000019` au tableau `migrations` (ligne ~67)

#### 1.4. Migration

**Fichier :** `packages/core/src/migrations/CreateAlgoPriceTicks1700000000019.ts`

```typescript
export class CreateAlgoPriceTicks1700000000019 implements MigrationInterface {
  name = 'CreateAlgoPriceTicks1700000000019';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "algo_price_ticks" (
        "id" SERIAL PRIMARY KEY NOT NULL,
        "condition_id" text NOT NULL,
        "up_price" real,
        "down_price" real,
        "recorded_at" timestamp NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_price_ticks_condition_id"
      ON "algo_price_ticks" ("condition_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_algo_price_ticks_recorded_at"
      ON "algo_price_ticks" ("recorded_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "algo_price_ticks"`);
  }
}
```

#### 1.5. Méthode `findLiveMarkets` dans `AlgoSurveillanceService`

**Fichier :** `packages/core/src/services/algo-surveillance.service.ts`

Ajouter une méthode pour récupérer les marchés live (open capturé, pas encore clos, non unresolved) :

```typescript
async findLiveMarkets(): Promise<AlgoSurveillanceSnapshotDto[]> {
  const rows = await this.repo()
    .createQueryBuilder('s')
    .where('s.open_captured_at IS NOT NULL')
    .andWhere('s.close_captured_at IS NULL')
    .andWhere('s.unresolved_at IS NULL')
    .andWhere('s.market_start_at IS NOT NULL')
    .andWhere('s.market_end_at IS NOT NULL')
    .getMany();
  return rows.map((row) => toDto(row));
}
```

Exporter cette méthode depuis `services/index.ts` (déjà exportée via `AlgoSurveillanceService`).

#### 1.6. Service `AlgoPriceTickService`

**Fichier :** `packages/core/src/services/algo-price-tick.service.ts`

Méthodes :
- `recordTick(conditionId: string, upPrice: number | null, downPrice: number | null): Promise<void>` — INSERT une ligne. **try/catch interne** pour ne pas crasher le timer en cas d'erreur DB.
- `listTicks(conditionId: string, options?: { from?: Date; to?: Date; limit?: number }): Promise<AlgoPriceTickDto[]>` — SELECT ordonné par `recorded_at` ASC. `limit` default 5000.
- `deleteOlderThan(maxAgeMs: number): Promise<number>` — DELETE WHERE `recorded_at < now() - maxAgeMs`. Retourne le nombre de lignes supprimées.

DTO exporté :
```typescript
export interface AlgoPriceTickDto {
  conditionId: string;
  upPrice: number | null;
  downPrice: number | null;
  recordedAt: string; // ISO
}
```

#### 1.7. Exporter le service

**Fichier :** `packages/core/src/services/index.ts`
- Ajouter l'export de `AlgoPriceTickService` et `AlgoPriceTickDto`

### Phase 2 — Worker (recorder loop)

#### 2.1. Nouveau `PriceTickRecorder`

**Fichier :** `packages/crypto-algo/src/price-tick-recorder.ts`

```typescript
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { AlgoPriceTickService, AlgoSurveillanceService, safeInterval } from '@polywatch/core';
import type { CryptoAlgoPriceFeed } from './price-feed.js';

const log = pino({ name: 'crypto-algo:price-tick-recorder' });
const TICK_INTERVAL_MS = 1_000;
const CLEANUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

interface ActiveMarket {
  conditionId: string;
  marketStartMs: number;
  marketEndMs: number;
}

export class PriceTickRecorder {
  private readonly tickService: AlgoPriceTickService;
  private readonly surveillanceService: AlgoSurveillanceService;
  private readonly activeMarkets = new Map<string, ActiveMarket>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly priceFeed: CryptoAlgoPriceFeed | null,
  ) {
    this.tickService = new AlgoPriceTickService(ds);
    this.surveillanceService = new AlgoSurveillanceService(ds);
  }

  /**
   * Met à jour la liste des marchés actifs en interrogeant AlgoSurveillanceSnapshot.
   * Cette méthode est appelée périodiquement par refreshSurveillanceTargets().
   */
  async refreshActiveMarkets(): Promise<void> {
    const liveSnapshots = await this.surveillanceService.findLiveMarkets();
    const now = Date.now();

    const next = new Map<string, ActiveMarket>();
    for (const snap of liveSnapshots) {
      if (!snap.marketStartAt || !snap.marketEndAt) continue;
      const startMs = Date.parse(snap.marketStartAt);
      const endMs = Date.parse(snap.marketEndAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      // Inclure si la fenêtre est active ou pas encore commencée (démarrage réactif via callback)
      if (now < endMs) {
        next.set(snap.conditionId, { conditionId: snap.conditionId, marketStartMs: startMs, marketEndMs: endMs });
      }
    }
    this.activeMarkets.clear();
    for (const [k, v] of next) this.activeMarkets.set(k, v);

    if (this.activeMarkets.size > 0 && !this.timer) {
      this.timer = safeInterval(() => this.tick(), TICK_INTERVAL_MS, 'crypto-algo:price-tick-recorder');
    } else if (this.activeMarkets.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ajoute un marché individuel (appelé dès que captureOpen est fait).
   * Fait sa propre requête pour récupérer les dates depuis AlgoSurveillanceSnapshot.
   */
  async addMarket(conditionId: string): Promise<void> {
    if (this.activeMarkets.has(conditionId)) return;
    const snap = await this.surveillanceService.getByConditionId(conditionId);
    if (!snap?.marketStartAt || !snap.marketEndAt) return;
    const startMs = Date.parse(snap.marketStartAt);
    const endMs = Date.parse(snap.marketEndAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    this.activeMarkets.set(conditionId, { conditionId, marketStartMs: startMs, marketEndMs: endMs });
    if (!this.timer) {
      this.timer = safeInterval(() => this.tick(), TICK_INTERVAL_MS, 'crypto-algo:price-tick-recorder');
    }
  }

  /**
   * Retire un marché (appelé quand le marché est résolu/fermé).
   */
  removeMarket(conditionId: string): void {
    this.activeMarkets.delete(conditionId);
    if (this.activeMarkets.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Timer 1s : pour chaque marché live, lit priceFeed et enregistre. */
  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [conditionId, market] of this.activeMarkets) {
      // Filtrage : uniquement les marchés dont la fenêtre est active
      if (now < market.marketStartMs || now >= market.marketEndMs) continue;

      const prices = this.priceFeed?.getOutcomePrices(conditionId);
      if (prices.upPrice == null && prices.downPrice == null) continue;

      try {
        await this.tickService.recordTick(conditionId, prices.upPrice, prices.downPrice);
      } catch (err) {
        log.warn({ err, conditionId }, 'failed to record price tick');
      }
    }
  }

  /** Cleanup : supprime les ticks > 24h. */
  async cleanupOldTicks(): Promise<void> {
    try {
      const deleted = await this.tickService.deleteOlderThan(CLEANUP_MAX_AGE_MS);
      if (deleted > 0) {
        log.info({ deleted }, 'old price ticks cleaned up');
      }
    } catch (err) {
      log.warn({ err }, 'price tick cleanup failed');
    }
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeMarkets.clear();
  }
}
```

**Décisions clés :**
1. **Timer 1s via `safeInterval`** (pas `setInterval` nu) — cohérent avec le codebase
2. **try/catch par marché** dans `tick()` — un échec DB ne crash pas le timer
3. **Filtrage par dates** — `now < marketStartMs || now >= marketEndMs` → skip
4. **Auto-stop du timer** quand plus aucun marché actif
5. **`addMarket()` fait sa propre requête** pour les dates (corrige la zone d'ombre #2)
6. **`refreshActiveMarkets()` interroge `AlgoSurveillanceSnapshot`** (corrige la zone d'ombre #1)

#### 2.2. Modifier `MarketSurveillanceRecorder`

**Fichier :** `packages/crypto-algo/src/market-surveillance-recorder.ts`

Ajouter un 3e paramètre au constructeur :
```typescript
export interface SurveillanceRecorderOptions {
  onOpenCaptured?: (conditionId: string) => void;
}

export class MarketSurveillanceRecorder {
  constructor(
    dataSource: DataSource,
    priceFeed: CryptoAlgoPriceFeed | null,
    private readonly options?: SurveillanceRecorderOptions,
  ) { ... }
```

Dans `captureOpen()`, après `log.info('open surveillance snapshot recorded')` :
```typescript
// Notifier le price tick recorder
this.options?.onOpenCaptured?.(conditionId);
```

**Note :** Le callback ne passe que `conditionId` — pas de dates. Le `PriceTickRecorder.addMarket()` fait sa propre requête pour les dates.

#### 2.3. Intégration dans `crypto-algo/src/index.ts`

**Modifications :**

1. **Import** (après ligne 30) :
```typescript
import { PriceTickRecorder } from './price-tick-recorder.js';
```

2. **Création** (après ligne 168, après `MarketSurveillanceRecorder`) :
```typescript
const priceTickRecorder = new PriceTickRecorder(ds, priceFeed);
```

3. **Modifier la création du surveillance recorder** pour passer le callback :
```typescript
const surveillanceRecorder = new MarketSurveillanceRecorder(ds, priceFeed, {
  onOpenCaptured: (conditionId) => {
    void priceTickRecorder.addMarket(conditionId);
  },
});
```

4. **Refresh périodique** — Dans `refreshSurveillanceTargets()`, après le refresh du surveillance
   recorder, mettre à jour les marchés actifs du tick recorder :
```typescript
const refreshSurveillanceTargets = async (): Promise<void> => {
  const targets = await buildSurveillanceTargets(autoTrackService, selectionLoader);
  await surveillanceRecorder.refresh(targets);
  await priceTickRecorder.refreshActiveMarkets();
};
```

5. **Arrêt sur résolution** — Dans `onMarketResolved`, retirer le marché du tick recorder :
```typescript
const onMarketResolved = async (conditionId: string): Promise<void> => {
  await marketService.fetchAndPersist(conditionId);
  await surveillanceRecorder.captureOnResolved(conditionId, { forceImmediate: true });
  priceTickRecorder.removeMarket(conditionId);
};
```

6. **Cleanup timer** (après le surveillance janitor, ~ligne 288) :
```typescript
const priceTickCleanupTimer = safeInterval(
  () => priceTickRecorder.cleanupOldTicks(),
  3_600_000, // 1h
  'crypto-algo:price-tick-cleanup',
);
```

7. **Shutdown** (dans la fonction `shutdown()`, ~ligne 355) :
```typescript
priceTickRecorder.shutdown();
clearInterval(priceTickCleanupTimer);
```

### Phase 3 — Backend (route API refactorisée)

#### 3.1. Refactoriser `algo-market-chart.ts`

**Fichier :** `packages/backend/src/routes/algo-market-chart.ts`

**Réécriture complète** — remplacer tout le contenu par :

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { AlgoPriceTickService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { CONDITION_ID_PATTERN } from '../lib/condition-id.js';

const conditionIdSchema = z.string().regex(CONDITION_ID_PATTERN);

export interface MarketChartResponse {
  conditionId: string;
  points: { t: number; up: number | null; down: number | null }[];
}

export function createAlgoMarketChartRouter(ds: DataSource): Router {
  const router = Router();
  const service = new AlgoPriceTickService(ds);

  router.get('/:conditionId', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const ticks = await service.listTicks(parsedId.data);
    const points = ticks.map(t => ({
      t: Date.parse(t.recordedAt),
      up: t.upPrice,
      down: t.downPrice,
    }));

    res.json({ conditionId: parsedId.data, points } satisfies MarketChartResponse);
  });

  return router;
}
```

**Supprimé :**
- `fetchGammaMarket` import
- `fetchTokenPriceHistory()` fonction
- `mergeUpDownHistory()` fonction
- `CLOB_API` constant
- `startTs`/`endTs`/`fidelity` logic
- Les anciennes interfaces (déplacées vers une forme inline simple)

#### 3.2. Mettre à jour l'appel dans `index.ts`

**Fichier :** `packages/backend/src/index.ts`

```typescript
// Avant : createAlgoMarketChartRouter()
// Après : createAlgoMarketChartRouter(ds)
app.use('/api/algo/market-chart', jwtLimiter, createAlgoMarketChartRouter(ds));
```

### Phase 4 — Frontend (pas de changement)

Le frontend appelle déjà `GET /api/algo/market-chart/:conditionId` et reçoit
`{ points: [{ t, up, down }] }`. Le format de réponse est identique — seule la source
des données change (DB locale au lieu d'API Polymarket).

`MarketChartDialog.tsx` et `UpDownPriceChart.tsx` ne nécessitent aucune modification.

Le message "Pas assez de données" affiché par `UpDownPriceChart` quand `points.length < 2`
reste pertinent : il signifie simplement que le worker n'a pas encore enregistré de ticks
pour ce marché (marché pas encore live, ou worker arrêté).

### Phase 5 — Tests

#### 5.1. Tests service core

**Fichier :** `packages/core/src/services/algo-price-tick.service.test.ts`

Tester avec pg-mem (`createTestDataSource`) :
- `recordTick()` puis `listTicks()` → données cohérentes (upPrice, downPrice, recordedAt)
- `listTicks()` avec `limit` → respecte la limite
- `deleteOlderThan()` → supprime les vieux ticks, garde les récents

#### 5.2. Tests route backend

**Fichier :** `packages/backend/src/routes/algo-market-chart.test.ts`

Tester :
- `GET /:conditionId` avec des ticks en DB → retourne les points ordonnés
- `GET /:conditionId` sans ticks → retourne `{ points: [] }`
- `GET /:conditionId` avec conditionId invalide → 400

## Ordre d'exécution

1. **Phase 1** : Entité + migration + service + exports + data-source.ts + `findLiveMarkets()` (core)
2. **Phase 2** : PriceTickRecorder + modifier MarketSurveillanceRecorder + intégration worker
3. **Phase 3** : Refactor route backend (supprimer API Polymarket, lire DB)
4. **Phase 4** : Rien (frontend inchangé)
5. **Phase 5** : Tests
6. Build + test global

## Risques et mitigations

| Risque | Mitigation |
|---|---|
| Volume DB élevé (~36k lignes/h) | Cleanup 1h supprime > 24h ; index sur `recorded_at` |
| Échec INSERT (DB down) | try/catch par marché dans `tick()` — n'arrête pas le timer |
| WebSocket déconnecté | `getOutcomePrices()` retourne les derniers prix connus, on enregistre quand même |
| Marché sans tokenId | `getOutcomePrices()` retourne null → skip |
| Timer 1s non démarré | `addMarket()` démarre le timer automatiquement |
| Timer non arrêté | `removeMarket()` + `shutdown()` arrêtent le timer quand plus de marchés |
| Migration sur DB existante | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` |
| Worker restart | Ticks déjà en DB conservés ; `refreshActiveMarkets()` reconstruit la liste au démarrage |
| `WatchedMarketInput` n'a pas de dates | `PriceTickRecorder` interroge `AlgoSurveillanceSnapshot` directement |
| `captureOpen()` n'a pas les dates | Le callback passe seulement `conditionId` ; `addMarket()` fait sa propre requête |
| Marchés antérieurs au déploiement | Pas de ticks → graphique vide — acceptable, pas de fallback |
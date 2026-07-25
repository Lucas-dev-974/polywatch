# Weather Algo Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a third trading algorithm ("Weather Algo") to Polywatch that discovers temperature markets on Polymarket, fetches multi-model weather forecasts from Open-Meteo, builds probability distributions, and takes positions when the market price diverges from the forecast-implied probability — reusing the existing worker for execution.

**Architecture:** New `packages/weather-algo` package (same pattern as `crypto-algo`). New core entities (`WeatherMarketSelection`, `WeatherAutoTrackRule`, `WeatherForecastCache`) + new `MarketType` values + new `WORKER_QUEUES.WEATHER_ORDER_SIGNALS` + new `OrderReason` values + new `RiskConfig` fields + new backend routes + new frontend page. The worker gains a new queue consumer but its `Executor` is unchanged — `OrderSignal` is generic. Market selection reuses the `eventSlug` field already present in `MarketListItemDto` as the negRisk event grouping key (the Gamma API does not expose `negRiskMarketID`).

**Tech Stack:** Node.js/TypeScript, TypeORM (PostgreSQL), ioredis (Redis queues/pubsub), Express (backend), SolidJS (frontend), Open-Meteo API (weather forecasts, no API key), Vitest (tests).

---

## Design Decisions (locked)

| Decision | Value |
|----------|-------|
| Weather API | Open-Meteo (free, 10k calls/day, no key, global coverage, 16-day forecasts) |
| Uncertainty estimation | Multi-model: fetch 3-5 Open-Meteo models, compute std dev across model forecasts |
| negRisk grouping | Group by `eventSlug` (already in `MarketListItemDto`); `negRiskMarketID` not available in Gamma API |
| Selection mode | Configurable: `single` (best edge), `multi` (top N edges), `spread` (adjacent temps) — default `single` |
| Evaluation timing | Continuous polling (~30min) with re-entry throttle per eventSlug |
| Trading modes | Sim + Real from day one (sim always active, real conditional on `risk.realTradingEnabled`) |
| Market types V1 | Temperature only (highest/lowest temp) |
| Exit logic | Close on forecast change (if forecast mean drifts > threshold °C) + manual close from UI + auto-close X hours before resolution |
| Edge threshold | Dynamic: `base_edge + uncertainty_penalty + time_factor` (combined uncertainty + time-to-resolution) |
| Market selection | Auto-discover by city + manual add (like crypto-algo) |

---

## Phase 1 — Core: Entities, Types, Migration

### Task 1.1: Add `WEATHER_TEMPERATURE` and `WEATHER_OTHER` to `MarketType`

**Objective:** Extend the market type enum to classify weather markets.

**Files:**
- Modify: `packages/core/src/market/market-type.ts`

**Step 1: Edit the enum**

```typescript
export enum MarketType {
  STANDARD = 'standard',
  CRYPTO_UP_DOWN = 'crypto_up_down',
  CRYPTO_ABOVE_BELOW = 'crypto_above_below',
  CRYPTO_TARGET_PRICE = 'crypto_target_price',
  CRYPTO_PRICE_RANGE = 'crypto_price_range',
  CRYPTO_OTHER = 'crypto_other',
  WEATHER_TEMPERATURE = 'weather_temperature',
  WEATHER_OTHER = 'weather_other',
}
```

**Step 2: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS (no type errors)

---

### Task 1.1b: Update `MarketClassifier` to detect weather markets

**Objective:** The classifier currently returns `STANDARD` for weather markets. Add detection logic so weather temperature markets are classified as `WEATHER_TEMPERATURE`.

**Files:**
- Modify: `packages/core/src/market/classifier.ts:52-69`

**Step 1: Add weather detection to the `classify()` method**

In the `classify()` method, before the final `return MarketType.STANDARD;` fallback (line 69), add weather detection:

```typescript
    if (raw.question && this.isWeatherTemperatureQuestion(raw.question)) {
      return MarketType.WEATHER_TEMPERATURE;
    }

    return MarketType.STANDARD;
  }

  /** Check if the question matches the temperature market pattern. */
  private isWeatherTemperatureQuestion(question: string): boolean {
    return /\b(highest|lowest)\s+temperature\b/i.test(question);
  }
```

**Step 2: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.2: Add `WEATHER_OPEN` and `WEATHER_FORECAST_CHANGE` to `OrderReason`

**Objective:** Extend the `OrderReason` type so the worker can label weather-algo signals.

**Files:**
- Modify: `packages/core/src/types/index.ts:32-46`
- Modify: `packages/core/src/orders/close-signal.ts` (add `WEATHER_FORECAST_CHANGE` to `TOTAL_CLOSE_REASONS`)

**Step 1: Edit the OrderReason type**

```typescript
export type OrderReason =
  | 'COPY_OPEN'
  | 'COPY_INCREASE'
  | 'COPY_DECREASE'
  | 'COPY_CLOSE'
  | 'SL'
  | 'TP'
  | 'TRAILING'
  | 'PRE_CLOSE_LOSS'
  | 'PRE_CLOSE_WIN'
  | 'MANUAL'
  | 'KILL_SWITCH'
  | 'REDEMPTION'
  | 'ALGO_OPEN'
  | 'ALGO_INCREASE'
  | 'WEATHER_OPEN'
  | 'WEATHER_FORECAST_CHANGE';
```

**Step 2: Add `WEATHER_FORECAST_CHANGE` to `TOTAL_CLOSE_REASONS`**

In `packages/core/src/orders/close-signal.ts`, the `TOTAL_CLOSE_REASONS` array defines which reasons trigger a full position close. Without this, the worker's `isTotalCloseSignal()` check will reject weather forecast-change close signals.

```typescript
export const TOTAL_CLOSE_REASONS = [
  'COPY_CLOSE',
  'SL',
  'TP',
  'TRAILING',
  'PRE_CLOSE_LOSS',
  'PRE_CLOSE_WIN',
  'MANUAL',
  'KILL_SWITCH',
  'WEATHER_FORECAST_CHANGE',
] as const satisfies readonly OrderReason[];
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.3: Add `WEATHER_ORDER_SIGNALS` to `WORKER_QUEUES`

**Objective:** Create the new Redis queue name for weather-algo order signals.

**Files:**
- Modify: `packages/core/src/queue/worker-queues.ts`

**Step 1: Edit WORKER_QUEUES**

```typescript
export const WORKER_QUEUES = {
  MOVE_EVENTS: 'move-events',
  ORDER_SIGNALS: 'order-signals',
  ALGO_ORDER_SIGNALS: 'algo-order-signals',
  WEATHER_ORDER_SIGNALS: 'weather-order-signals',
  CLOSE_SIGNALS: 'close-signals',
  EXECUTION_RESULTS: 'execution-results',
} as const;

export const KNOWN_WORKER_QUEUE_NAMES: readonly WorkerQueueName[] = [
  WORKER_QUEUES.MOVE_EVENTS,
  WORKER_QUEUES.ORDER_SIGNALS,
  WORKER_QUEUES.ALGO_ORDER_SIGNALS,
  WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
  WORKER_QUEUES.CLOSE_SIGNALS,
  WORKER_QUEUES.EXECUTION_RESULTS,
];
```

**Step 2: Fix the worker-queues test**

Modify: `packages/core/src/queue/worker-queues.test.ts` — add assertion for `WEATHER_ORDER_SIGNALS`:

```typescript
expect(isKnownWorkerQueue(WORKER_QUEUES.WEATHER_ORDER_SIGNALS)).toBe(true);
```

**Step 3: Run tests**

Run: `npm run test -w @polywatch/core`
Expected: PASS

---

### Task 1.4: Create `WeatherMarketSelection` entity

**Objective:** Persist the list of weather markets the algo should trade.

**Files:**
- Create: `packages/core/src/entities/WeatherMarketSelection.ts`
- Modify: `packages/core/src/entities/index.ts` (add export)

**Step 1: Create entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('weather_market_selections')
@Index(['conditionId'])
@Index(['eventSlug'])
@Index(['enabled'])
export class WeatherMarketSelection {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', nullable: true })
  question!: string | null;

  @Column({ type: 'text', name: 'event_slug', nullable: true })
  eventSlug!: string | null;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'timestamp', name: 'target_date', nullable: true })
  targetDate!: Date | null;

  @Column({ type: 'text', nullable: true })
  metric!: string | null;

  @Column({ type: 'real', name: 'target_value', nullable: true })
  targetValue!: number | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

**Step 2: Add to entities/index.ts**

Add after the `AlgoMarketSelection` export:

```typescript
export { WeatherMarketSelection } from './WeatherMarketSelection.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.5: Create `WeatherAutoTrackRule` entity

**Objective:** Persist auto-discovery rules (city + metric + look-ahead days).

**Files:**
- Create: `packages/core/src/entities/WeatherAutoTrackRule.ts`
- Modify: `packages/core/src/entities/index.ts` (add export)

**Step 1: Create entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('weather_auto_track_rules')
@Index(['enabled'])
export class WeatherAutoTrackRule {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'integer', name: 'look_ahead_days', default: 1 })
  lookAheadDays!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

**Step 2: Add to entities/index.ts**

```typescript
export { WeatherAutoTrackRule } from './WeatherAutoTrackRule.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.6: Create `WeatherForecastCache` entity

**Objective:** Cache multi-model weather forecasts to avoid API rate limits.

**Files:**
- Create: `packages/core/src/entities/WeatherForecastCache.ts`
- Modify: `packages/core/src/entities/index.ts` (add export)

**Step 1: Create entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('weather_forecast_cache')
@Index(['city', 'forecastDate', 'metric'])
export class WeatherForecastCache {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'timestamp', name: 'forecast_date' })
  forecastDate!: Date;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'real', name: 'forecast_mean' })
  forecastMean!: number;

  @Column({ type: 'real', name: 'forecast_std_dev' })
  forecastStdDev!: number;

  /** JSON string of per-model values, e.g. {"gfs":31,"ecmwf":30,"icon":32} */
  @Column({ type: 'text', name: 'model_values' })
  modelValues!: string;

  @Column({ type: 'real', name: 'latitude' })
  latitude!: number;

  @Column({ type: 'real', name: 'longitude' })
  longitude!: number;

  @CreateDateColumn({ name: 'fetched_at' })
  fetchedAt!: Date;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;
}
```

**Step 2: Add to entities/index.ts**

```typescript
export { WeatherForecastCache } from './WeatherForecastCache.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.6b: Create `WeatherPositionForecast` entity

**Objective:** Store the forecast snapshot at position entry time so the "close on forecast change" logic can compare the current forecast with the entry forecast. `CopiedPosition` has no free metadata field, so we use a dedicated side table.

**Files:**
- Create: `packages/core/src/entities/WeatherPositionForecast.ts`
- Modify: `packages/core/src/entities/index.ts` (add export)

**Step 1: Create entity**

```typescript
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('weather_position_forecasts')
@Index(['copiedPositionId'])
export class WeatherPositionForecast {
  @PrimaryGeneratedColumn()
  id!: number;

  /** FK to copied_positions.id — the position this forecast snapshot belongs to. */
  @Column({ type: 'integer', name: 'copied_position_id' })
  copiedPositionId!: number;

  @Column({ type: 'text' })
  city!: string;

  @Column({ type: 'timestamp', name: 'target_date' })
  targetDate!: Date;

  @Column({ type: 'text' })
  metric!: string;

  /** Forecast mean (°C) at the time the position was opened. */
  @Column({ type: 'real', name: 'entry_forecast_mean' })
  entryForecastMean!: number;

  /** Forecast std dev (°C) at the time the position was opened. */
  @Column({ type: 'real', name: 'entry_forecast_std_dev' })
  entryForecastStdDev!: number;

  /** JSON of per-model values at entry time. */
  @Column({ type: 'text', name: 'entry_model_values' })
  entryModelValues!: string;
}
```

**Step 2: Add to entities/index.ts**

```typescript
export { WeatherPositionForecast } from './WeatherPositionForecast.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.7: Add weather-algo fields to `RiskConfig`

**Objective:** Persist weather-algo configuration in the risk config table.

**Files:**
- Modify: `packages/core/src/entities/RiskConfig.ts` (append after the last crypto-algo column, before `realCashOverride` or at end of file)

**Step 1: Add columns**

Append these columns to the `RiskConfig` entity (after the existing crypto-algo fields):

```typescript
  /** Master toggle for weather-algo execution. */
  @Column({ type: 'boolean', name: 'weather_algo_enabled', default: false })
  weatherAlgoEnabled!: boolean;

  /** Base edge (forecast prob - market price) required for entry. Default 10%. */
  @Column({ type: 'real', name: 'weather_algo_min_edge', default: 0.10 })
  weatherAlgoMinEdge!: number;

  /** Max forecast std dev (°C) to allow entry. Null = no cap. */
  @Column({ type: 'real', name: 'weather_algo_max_forecast_std', nullable: true })
  weatherAlgoMaxForecastStd!: number | null;

  /** Sizing mode for weather-algo. */
  @Column({ type: 'text', name: 'weather_algo_sizing_mode', default: 'fixed_usdc' })
  weatherAlgoSizingMode!: string;

  /** Fixed USDC amount per weather-algo entry. */
  @Column({ type: 'real', name: 'weather_algo_entry_usdc', default: 10 })
  weatherAlgoEntryUsdc!: number;

  /** Selection mode: 'single' | 'multi' | 'spread'. */
  @Column({ type: 'text', name: 'weather_algo_selection_mode', default: 'single' })
  weatherAlgoSelectionMode!: string;

  /** Max signals per event in 'multi' mode. */
  @Column({ type: 'integer', name: 'weather_algo_max_signals_per_event', default: 3 })
  weatherAlgoMaxSignalsPerEvent!: number;

  /** Forecast mean drift (°C) that triggers position close. */
  @Column({ type: 'real', name: 'weather_algo_forecast_change_threshold', default: 2 })
  weatherAlgoForecastChangeThreshold!: number;

  /** Auto-close positions X hours before market resolution. */
  @Column({ type: 'real', name: 'weather_algo_close_before_resolution_hours', default: 1 })
  weatherAlgoCloseBeforeResolutionHours!: number;

  /** Evaluation polling interval (ms). Default 30min. */
  @Column({ type: 'integer', name: 'weather_algo_poll_ms', default: 1800000 })
  weatherAlgoPollMs!: number;
```

**Step 2: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 1.8: Create the database migration

**Objective:** Create the weather-algo tables and add the risk_config columns.

**Files:**
- Create: `packages/core/src/migrations/CreateWeatherAlgo1700000000070.ts`

**Step 1: Create migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWeatherAlgo1700000000070 implements MigrationInterface {
  name = 'CreateWeatherAlgo1700000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "weather_market_selections" (
        "id" SERIAL PRIMARY KEY,
        "condition_id" TEXT NOT NULL,
        "question" TEXT,
        "event_slug" TEXT,
        "city" TEXT,
        "target_date" TIMESTAMP,
        "metric" TEXT,
        "target_value" REAL,
        "enabled" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_condition_id" ON "weather_market_selections" ("condition_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_event_slug" ON "weather_market_selections" ("event_slug")`);
    await queryRunner.query(`CREATE INDEX "IDX_weather_sel_enabled" ON "weather_market_selections" ("enabled")`);

    await queryRunner.query(`
      CREATE TABLE "weather_auto_track_rules" (
        "id" SERIAL PRIMARY KEY,
        "city" TEXT NOT NULL,
        "metric" TEXT NOT NULL,
        "look_ahead_days" INTEGER DEFAULT 1,
        "enabled" BOOLEAN DEFAULT true,
        "created_at" TIMESTAMP DEFAULT NOW(),
        "updated_at" TIMESTAMP DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_autotrack_enabled" ON "weather_auto_track_rules" ("enabled")`);

    await queryRunner.query(`
      CREATE TABLE "weather_forecast_cache" (
        "id" SERIAL PRIMARY KEY,
        "city" TEXT NOT NULL,
        "forecast_date" TIMESTAMP NOT NULL,
        "metric" TEXT NOT NULL,
        "forecast_mean" REAL NOT NULL,
        "forecast_std_dev" REAL NOT NULL,
        "model_values" TEXT NOT NULL,
        "latitude" REAL NOT NULL,
        "longitude" REAL NOT NULL,
        "fetched_at" TIMESTAMP DEFAULT NOW(),
        "expires_at" TIMESTAMP NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_cache_city_date_metric" ON "weather_forecast_cache" ("city", "forecast_date", "metric")`);

    await queryRunner.query(`
      CREATE TABLE "weather_position_forecasts" (
        "id" SERIAL PRIMARY KEY,
        "copied_position_id" INTEGER NOT NULL,
        "city" TEXT NOT NULL,
        "target_date" TIMESTAMP NOT NULL,
        "metric" TEXT NOT NULL,
        "entry_forecast_mean" REAL NOT NULL,
        "entry_forecast_std_dev" REAL NOT NULL,
        "entry_model_values" TEXT NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_weather_pos_forecast_position_id" ON "weather_position_forecasts" ("copied_position_id")`);

    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_enabled" BOOLEAN DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_min_edge" REAL DEFAULT 0.10`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_max_forecast_std" REAL`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_sizing_mode" TEXT DEFAULT 'fixed_usdc'`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_entry_usdc" REAL DEFAULT 10`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_selection_mode" TEXT DEFAULT 'single'`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_max_signals_per_event" INTEGER DEFAULT 3`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_forecast_change_threshold" REAL DEFAULT 2`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_close_before_resolution_hours" REAL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "risk_config" ADD COLUMN "weather_algo_poll_ms" INTEGER DEFAULT 1800000`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_poll_ms"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_close_before_resolution_hours"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_forecast_change_threshold"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_max_signals_per_event"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_selection_mode"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_entry_usdc"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_sizing_mode"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_max_forecast_std"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_min_edge"`);
    await queryRunner.query(`ALTER TABLE "risk_config" DROP COLUMN IF EXISTS "weather_algo_enabled"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_cache_city_date_metric"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_forecast_cache"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_pos_forecast_position_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_position_forecasts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_autotrack_enabled"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_auto_track_rules"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_enabled"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_event_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_weather_sel_condition_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weather_market_selections"`);
  }
}
```

**Step 2: Register entities and migration in `data-source.ts`**

In `packages/core/src/database/data-source.ts`:

1. Add imports for the new entities (after the existing entity imports, ~line 46-112):
```typescript
import { WeatherMarketSelection } from '../entities/WeatherMarketSelection.js';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';
import { WeatherPositionForecast } from '../entities/WeatherPositionForecast.js';
```

2. Add them to the `entities` array (after `RealArchiveExitAttempt`, ~line 197):
```typescript
  RealArchiveExitAttempt,
  WeatherMarketSelection,
  WeatherAutoTrackRule,
  WeatherForecastCache,
  WeatherPositionForecast,
];
```

3. Add the migration import (after the last migration import, ~line 62):
```typescript
import { CreateWeatherAlgo1700000000070 } from '../migrations/CreateWeatherAlgo1700000000070.js';
```

4. Add the migration to the `migrations` array (at the end, before the closing `]`):
```typescript
  SystemConfig1700000000001,
  CreateWeatherAlgo1700000000070,
];
```

**Step 3: Verify migration compiles**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

## Phase 2 — Core: Services & Discovery

### Task 2.1: Create `WeatherMarketSelectionService`

**Objective:** CRUD service for weather market selections, mirroring `AlgoMarketSelectionService`.

**Files:**
- Create: `packages/core/src/services/weather-market-selection.service.ts`
- Modify: `packages/core/src/services/index.ts` (add export)
- Modify: `packages/core/src/services/weather-services.ts` (new — wiring helper)
- Modify: `packages/core/src/index.ts` (add export)

**Step 1: Create the service**

```typescript
import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherMarketSelection } from '../entities/WeatherMarketSelection.js';

const log = pino({ name: 'core:weather-market-selection' });

export interface WeatherSelectionMeta {
  question?: string | null;
  eventSlug?: string | null;
  city?: string | null;
  targetDate?: Date | null;
  metric?: string | null;
  targetValue?: number | null;
}

export class WeatherMarketSelectionService {
  constructor(private readonly ds: DataSource) {}

  async loadAll(): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  async loadAllEnabled(): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
  }

  async loadByEventSlug(eventSlug: string): Promise<WeatherMarketSelection[]> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    return repo.find({ where: { eventSlug, enabled: true } });
  }

  async addSelection(
    conditionId: string,
    meta: WeatherSelectionMeta,
  ): Promise<WeatherMarketSelection> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    const existing = await repo.findOne({ where: { conditionId } });
    if (existing) {
      // Update metadata + re-enable if disabled
      Object.assign(existing, { ...meta, enabled: true });
      return repo.save(existing);
    }
    const entry = repo.create({ conditionId, ...meta });
    return repo.save(entry);
  }

  async removeSelection(conditionId: string): Promise<void> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    await repo.delete({ conditionId });
  }

  async setEnabled(conditionId: string, enabled: boolean): Promise<void> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    await repo.update({ conditionId }, { enabled });
  }

  async ensureMarketsForEnabledSelections(): Promise<void> {
    // Placeholder — the weather-algo package will override market fetching.
    // This mirrors AlgoMarketSelectionService.ensureMarketsForEnabledSelections.
  }

  async getStatusCounts(): Promise<{
    enabledSelections: number;
    selectionsWithMarket: number;
  }> {
    const repo = this.ds.getRepository(WeatherMarketSelection);
    const enabledSelections = await repo.count({ where: { enabled: true } });
    return {
      enabledSelections,
      selectionsWithMarket: enabledSelections,
    };
  }
}
```

**Step 2: Create weather-services.ts wiring helper**

```typescript
import type { DataSource } from 'typeorm';
import { MarketService } from './market.service.js';
import { WeatherMarketSelectionService } from './weather-market-selection.service.js';

export function createWeatherSelectionServices(ds: DataSource): {
  marketService: MarketService;
  selectionService: WeatherMarketSelectionService;
} {
  const marketService = new MarketService(ds);
  return {
    marketService,
    selectionService: new WeatherMarketSelectionService(ds),
  };
}
```

**Step 3: Add to services/index.ts**

```typescript
export {
  WeatherMarketSelectionService,
  type WeatherSelectionMeta,
} from './weather-market-selection.service.js';
export { createWeatherSelectionServices } from './weather-services.js';
```

**Step 4: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 2.2: Create `WeatherAutoTrackService`

**Objective:** CRUD service for auto-track rules (city + metric + look-ahead).

**Files:**
- Create: `packages/core/src/services/weather-auto-track.service.ts`
- Modify: `packages/core/src/services/index.ts` (add export)

**Step 1: Create service**

```typescript
import { DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherAutoTrackRule } from '../entities/WeatherAutoTrackRule.js';

const log = pino({ name: 'core:weather-auto-track' });

export class WeatherAutoTrackService {
  constructor(private readonly ds: DataSource) {}

  async loadAll(): Promise<WeatherAutoTrackRule[]> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    return repo.find({ order: { city: 'ASC' } });
  }

  async loadAllEnabled(): Promise<WeatherAutoTrackRule[]> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    return repo.find({ where: { enabled: true }, order: { city: 'ASC' } });
  }

  async addRule(
    city: string,
    metric: string,
    lookAheadDays: number = 1,
  ): Promise<WeatherAutoTrackRule> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    const existing = await repo.findOne({ where: { city, metric } });
    if (existing) {
      existing.lookAheadDays = lookAheadDays;
      existing.enabled = true;
      return repo.save(existing);
    }
    const entry = repo.create({ city, metric, lookAheadDays });
    return repo.save(entry);
  }

  async removeRule(id: number): Promise<void> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    await repo.delete({ id });
  }

  async setEnabled(id: number, enabled: boolean): Promise<void> {
    const repo = this.ds.getRepository(WeatherAutoTrackRule);
    await repo.update({ id }, { enabled });
  }
}
```

**Step 2: Add to services/index.ts**

```typescript
export { WeatherAutoTrackService } from './weather-auto-track.service.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 2.3: Create `WeatherForecastService` (cache management)

**Objective:** Read/write weather forecast cache, check TTL, return stale or fetch.

**Files:**
- Create: `packages/core/src/services/weather-forecast.service.ts`
- Modify: `packages/core/src/services/index.ts` (add export)

**Step 1: Create service**

```typescript
import { LessThan, MoreThan, DataSource } from 'typeorm';
import pino from 'pino';
import { WeatherForecastCache } from '../entities/WeatherForecastCache.js';

const log = pino({ name: 'core:weather-forecast' });

export interface ForecastResult {
  city: string;
  forecastDate: Date;
  metric: string;
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  expiresAt: Date;
  isFresh: boolean;
}

export class WeatherForecastService {
  constructor(private readonly ds: DataSource) {}

  async getCached(
    city: string,
    forecastDate: Date,
    metric: string,
  ): Promise<ForecastResult | null> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const row = await repo.findOne({
      where: { city, forecastDate, metric },
      order: { fetchedAt: 'DESC' },
    });
    if (!row) return null;
    const isFresh = new Date(row.expiresAt) > new Date();
    return {
      city: row.city,
      forecastDate: row.forecastDate,
      metric: row.metric,
      forecastMean: row.forecastMean,
      forecastStdDev: row.forecastStdDev,
      modelValues: JSON.parse(row.modelValues),
      latitude: row.latitude,
      longitude: row.longitude,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      isFresh,
    };
  }

  async save(result: ForecastResult): Promise<void> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    await repo.save({
      city: result.city,
      forecastDate: result.forecastDate,
      metric: result.metric,
      forecastMean: result.forecastMean,
      forecastStdDev: result.forecastStdDev,
      modelValues: JSON.stringify(result.modelValues),
      latitude: result.latitude,
      longitude: result.longitude,
      expiresAt: result.expiresAt,
    });
  }

  async purgeExpired(): Promise<number> {
    const repo = this.ds.getRepository(WeatherForecastCache);
    const result = await repo.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
```

**Step 2: Add to services/index.ts**

```typescript
export {
  WeatherForecastService,
  type ForecastResult,
} from './weather-forecast.service.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 2.4: Create `question-parser.ts`

**Objective:** Parse Polymarket weather questions to extract city, date, metric, target temperature.

**Files:**
- Create: `packages/core/src/weather/question-parser.ts`
- Create: `packages/core/src/weather/question-parser.test.ts`
- Modify: `packages/core/src/index.ts` (add re-export)

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { parseWeatherQuestion } from './question-parser.js';

describe('parseWeatherQuestion', () => {
  it('parses "highest temperature in Hong Kong be 31°C on July 24"', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Hong Kong be 31°C on July 24?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Hong Kong');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(31);
    expect(result!.dateString).toBe('July 24');
  });

  it('parses "lowest temperature" variant', () => {
    const result = parseWeatherQuestion(
      'Will the lowest temperature in London be 5°C on December 25?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('London');
    expect(result!.metric).toBe('lowest_temp');
    expect(result!.targetValue).toBe(5);
  });

  it('parses "or below" variant', () => {
    const result = parseWeatherQuestion(
      'Will the highest temperature in Jinan be 15°C or below on May 20?',
    );
    expect(result).not.toBeNull();
    expect(result!.city).toBe('Jinan');
    expect(result!.metric).toBe('highest_temp');
    expect(result!.targetValue).toBe(15);
    expect(result!.comparison).toBe('or_below');
  });

  it('returns null for non-weather questions', () => {
    expect(parseWeatherQuestion('Will Bitcoin reach $100k?')).toBeNull();
    expect(parseWeatherQuestion('Will it rain in Tokyo?')).toBeNull();
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run packages/core/src/weather/question-parser.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
export interface ParsedWeatherQuestion {
  city: string;
  metric: 'highest_temp' | 'lowest_temp';
  targetValue: number;
  dateString: string;
  comparison: 'exact' | 'or_below' | 'or_above';
}

const HIGHEST_TEMP_REGEX =
  /highest temperature in (.+?) be (-?\d+)°C(?: or (below|above))? on (.+?)\?/i;
const LOWEST_TEMP_REGEX =
  /lowest temperature in (.+?) be (-?\d+)°C(?: or (below|above))? on (.+?)\?/i;

export function parseWeatherQuestion(
  question: string,
): ParsedWeatherQuestion | null {
  const highest = HIGHEST_TEMP_REGEX.exec(question);
  if (highest) {
    return {
      city: highest[1]!.trim(),
      metric: 'highest_temp',
      targetValue: parseInt(highest[2]!, 10),
      comparison: highest[3] ? (highest[3].toLowerCase() as 'below' | 'above') === 'below' ? 'or_below' : 'or_above' : 'exact',
      dateString: highest[4]!.trim(),
    };
  }

  const lowest = LOWEST_TEMP_REGEX.exec(question);
  if (lowest) {
    return {
      city: lowest[1]!.trim(),
      metric: 'lowest_temp',
      targetValue: parseInt(lowest[2]!, 10),
      comparison: lowest[3] ? (lowest[3].toLowerCase() as 'below' | 'above') === 'below' ? 'or_below' : 'or_above' : 'exact',
      dateString: lowest[4]!.trim(),
    };
  }

  return null;
}
```

**Note on date resolution:** The `dateString` extracted from the question (e.g. "July 24") is used for display and logging only. The **authoritative target date** for weather forecasts and market resolution is the `endDate` field from the Gamma API event/market, which is already available in `MarketListItemDto.endDate`. The weather-algo strategy runner will use `market.endDate` as the forecast target date, not the parsed `dateString`. This avoids ambiguity with year inference and timezone issues.

**Step 4: Run tests to verify pass**

Run: `npx vitest run packages/core/src/weather/question-parser.test.ts`
Expected: PASS — 4 tests

---

### Task 2.5: Create `weather-market-discovery.ts`

**Objective:** Discover weather temperature markets on Polymarket via the Gamma API (tag_slug=weather).

**Files:**
- Create: `packages/core/src/weather/weather-market-discovery.ts`
- Modify: `packages/core/src/index.ts` (add re-export)

**Step 1: Create the module**

```typescript
import {
  fetchGammaMarketsByTagSlug,
  type MarketListItemDto,
} from '../polymarket/market-list.js';
import { parseWeatherQuestion } from './question-parser.js';
import { MarketType } from '../market/market-type.js';

export const WEATHER_TAG_SLUG = 'weather';

export interface WeatherMarketDiscoveryResult {
  /** Markets that matched the temperature question parser. */
  temperatureMarkets: MarketListItemDto[];
  /** All weather-tagged markets (for the UI to display). */
  allWeatherMarkets: MarketListItemDto[];
}

export async function discoverWeatherMarkets(
  options?: { limit?: number; offset?: number },
): Promise<WeatherMarketDiscoveryResult> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
  const offset = Math.max(0, options?.offset ?? 0);

  const { items } = await fetchGammaMarketsByTagSlug({
    tagSlug: WEATHER_TAG_SLUG,
    closed: false,
    active: true,
    limit,
    offset,
  });

  const temperatureMarkets = items.filter(
    (m) => m.question != null && parseWeatherQuestion(m.question) !== null,
  );

  return {
    temperatureMarkets,
    allWeatherMarkets: items,
  };
}

/**
 * Group markets by their event slug. Markets sharing the same eventSlug
 * belong to the same negRisk multi-outcome event (e.g. all temperature
 * options for "Hong Kong July 24").
 */
export function groupMarketsByEvent(
  markets: MarketListItemDto[],
): Map<string, MarketListItemDto[]> {
  const groups = new Map<string, MarketListItemDto[]>();
  for (const m of markets) {
    const key = m.eventSlug ?? m.conditionId;
    const arr = groups.get(key);
    if (arr) arr.push(m);
    else groups.set(key, [m]);
  }
  return groups;
}
```

**Step 2: Add re-export to core index.ts**

```typescript
export { discoverWeatherMarkets, groupMarketsByEvent, WEATHER_TAG_SLUG, type WeatherMarketDiscoveryResult } from './weather/weather-market-discovery.js';
export { parseWeatherQuestion, resolveWeatherDate, type ParsedWeatherQuestion } from './weather/question-parser.js';
```

**Step 3: Verify build**

Run: `npm run build -w @polywatch/core`
Expected: PASS

---

### Task 2.6: Create `weather-api-client.ts` (Open-Meteo multi-model)

**Objective:** Fetch multi-model weather forecasts from Open-Meteo and compute mean + std dev.

**Files:**
- Create: `packages/core/src/weather/weather-api-client.ts`
- Create: `packages/core/src/weather/weather-api-client.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildForecastFromModelResults } from './weather-api-client.js';

describe('buildForecastFromModelResults', () => {
  it('computes mean and std dev from model values', () => {
    const result = buildForecastFromModelResults([31, 30, 32, 31, 30]);
    expect(result.forecastMean).toBeCloseTo(30.8, 1);
    // Sample std dev (n-1 denominator) = sqrt(variance) where variance = sum((x-mean)^2)/(n-1)
    expect(result.forecastStdDev).toBeCloseTo(0.837, 2);
  });

  it('returns 0 std dev when all models agree', () => {
    const result = buildForecastFromModelResults([31, 31, 31]);
    expect(result.forecastMean).toBe(31);
    expect(result.forecastStdDev).toBe(0);
  });

  it('handles single model', () => {
    const result = buildForecastFromModelResults([31]);
    expect(result.forecastMean).toBe(31);
    expect(result.forecastStdDev).toBe(0);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run packages/core/src/weather/weather-api-client.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import pino from 'pino';

const log = pino({ name: 'core:weather-api-client' });

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Weather models to query for multi-model uncertainty estimation. */
const WEATHER_MODELS = [
  'gfs_seamless',
  'ecmwf_ifs04',
  'icon_seamless',
  'jma_seamless',
  'meteofrance_seamless',
];

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  city: string;
}

export interface ModelForecast {
  modelName: string;
  value: number;
}

export interface ForecastAggregation {
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
}

/** Geocode a city name to lat/lon using Open-Meteo's free geocoding API. */
export async function geocodeCity(city: string): Promise<GeocodingResult | null> {
  const url = `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ city, status: res.status }, 'geocoding failed');
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string }>;
    };
    if (!data.results || data.results.length === 0) {
      log.warn({ city }, 'geocoding returned no results');
      return null;
    }
    const r = data.results[0]!;
    return { latitude: r.latitude, longitude: r.longitude, city: r.name };
  } catch (err) {
    log.error({ err, city }, 'geocoding error');
    return null;
  }
}

/**
 * Fetch multi-model temperature forecasts from Open-Meteo.
 * Returns per-model max temperature for the target date.
 */
export async function fetchMultiModelForecast(
  latitude: number,
  longitude: number,
  targetDate: Date,
  metric: 'highest_temp' | 'lowest_temp',
): Promise<ModelForecast[]> {
  const dailyParam =
    metric === 'highest_temp'
      ? 'temperature_2m_max'
      : 'temperature_2m_min';

  const targetDateStr = targetDate.toISOString().slice(0, 10);
  const modelsParam = WEATHER_MODELS.join(',');

  // Open-Meteo supports fetching multiple models in a single request via the
  // `models` parameter when using the multi-model endpoint.
  const url = `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&daily=${dailyParam}&models=${modelsParam}&forecast_days=7&timezone=auto`;

  const results: ModelForecast[] = [];

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ status: res.status, url }, 'Open-Meteo forecast request failed');
      return [];
    }

    const data = (await res.json()) as {
      daily?: {
        time: string[];
        [key: string]: string[] | number[] | null[];
      };
    };

    // Open-Meteo multi-model returns a SINGLE "daily" object with per-model
    // columns named like "temperature_2m_max_gfs_seamless",
    // "temperature_2m_max_ecmwf_ifs04", etc. Not separate top-level keys.
    const daily = data?.daily;
    if (daily && Array.isArray(daily.time)) {
      const dateIndex = daily.time.indexOf(targetDateStr);
      if (dateIndex !== -1) {
        for (const model of WEATHER_MODELS) {
          const colKey = `${dailyParam}_${model}`;
          const values = daily[colKey] as number[] | null[] | undefined;
          if (!values) continue;
          const val = values[dateIndex];
          if (val != null && typeof val === 'number') {
            results.push({ modelName: model, value: val });
          }
        }
      }
    }
  } catch (err) {
    log.error({ err, url }, 'Open-Meteo forecast error');
  }

  // Fallback: if the multi-model request didn't return enough model data
  // (some models don't support all regions), try fetching each model
  // individually. The response format is the same: a single "daily" object
  // with per-model columns.
  const seenModels = new Set(results.map((r) => r.modelName));
  if (seenModels.size < 3) {
    for (const model of WEATHER_MODELS) {
      if (seenModels.has(model)) continue;
      const singleUrl = `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&daily=${dailyParam}&models=${model}&forecast_days=7&timezone=auto`;
      try {
        const res = await fetch(singleUrl);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          daily?: { time: string[]; [key: string]: unknown };
        };
        const daily = data?.daily;
        if (!daily || !Array.isArray(daily.time)) continue;
        const dateIndex = daily.time.indexOf(targetDateStr);
        if (dateIndex === -1) continue;
        const colKey = `${dailyParam}_${model}`;
        const values = daily[colKey] as number[] | null[] | undefined;
        if (!values) continue;
        const val = values[dateIndex];
        if (val != null && typeof val === 'number') {
          results.push({ modelName: model, value: val });
        }
      } catch {
        continue;
      }
    }
  }

  return results;
}

/**
 * Aggregate per-model forecasts into a mean + std dev.
 */
export function buildForecastFromModelResults(
  modelForecasts: number[],
): ForecastAggregation {
  const n = modelForecasts.length;
  if (n === 0) {
    return { forecastMean: 0, forecastStdDev: 0, modelValues: {} };
  }
  const mean = modelForecasts.reduce((a, b) => a + b, 0) / n;
  if (n === 1) {
    return { forecastMean: mean, forecastStdDev: 0, modelValues: {} };
  }
  const variance =
    modelForecasts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  return {
    forecastMean: mean,
    forecastStdDev: stdDev,
    modelValues: {},
  };
}

/**
 * Full end-to-end forecast: geocode city, fetch multi-model forecasts,
 * aggregate into mean + std dev.
 */
export async function fetchWeatherForecast(
  city: string,
  targetDate: Date,
  metric: 'highest_temp' | 'lowest_temp',
): Promise<{
  forecastMean: number;
  forecastStdDev: number;
  modelValues: Record<string, number>;
  latitude: number;
  longitude: number;
} | null> {
  const geo = await geocodeCity(city);
  if (!geo) return null;

  const models = await fetchMultiModelForecast(
    geo.latitude,
    geo.longitude,
    targetDate,
    metric,
  );
  if (models.length === 0) return null;

  const modelValues: Record<string, number> = {};
  for (const m of models) {
    modelValues[m.modelName] = m.value;
  }

  const agg = buildForecastFromModelResults(models.map((m) => m.value));
  return {
    ...agg,
    modelValues,
    latitude: geo.latitude,
    longitude: geo.longitude,
  };
}
```

**Step 4: Run tests to verify pass**

Run: `npx vitest run packages/core/src/weather/weather-api-client.test.ts`
Expected: PASS — 3 tests

**Step 5: Add re-export to core index.ts**

```typescript
export {
  geocodeCity,
  fetchMultiModelForecast,
  fetchWeatherForecast,
  buildForecastFromModelResults,
  type GeocodingResult,
  type ModelForecast,
  type ForecastAggregation,
} from './weather/weather-api-client.js';
```

---

### Task 2.7: Create `forecast-distribution.ts`

**Objective:** Convert a forecast (mean + std dev) into a probability distribution over discrete temperature outcomes.

**Files:**
- Create: `packages/core/src/weather/forecast-distribution.ts`
- Create: `packages/core/src/weather/forecast-distribution.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { buildTempProbabilityDistribution, normalCDF } from './forecast-distribution.js';

describe('normalCDF', () => {
  it('returns 0.5 at mean', () => {
    expect(normalCDF(0, 0, 1)).toBeCloseTo(0.5, 4);
  });
  it('returns ~0.84 at +1 std', () => {
    expect(normalCDF(1, 0, 1)).toBeCloseTo(0.8413, 3);
  });
  it('returns ~0.16 at -1 std', () => {
    expect(normalCDF(-1, 0, 1)).toBeCloseTo(0.1587, 3);
  });
});

describe('buildTempProbabilityDistribution', () => {
  it('assigns highest probability to the mean temperature', () => {
    const dist = buildTempProbabilityDistribution(31, 2, [28, 29, 30, 31, 32, 33]);
    const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
    expect(sorted[0]![0]).toBe(31); // peak at mean
  });

  it('probabilities sum to approximately 1.0', () => {
    const dist = buildTempProbabilityDistribution(31, 2, [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38]);
    const sum = [...dist.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.95);
    expect(sum).toBeLessThan(1.05);
  });

  it('handles std dev of 0 (all probability on the exact temp)', () => {
    const dist = buildTempProbabilityDistribution(31, 0, [28, 29, 30, 31, 32, 33]);
    expect(dist.get(31)).toBeCloseTo(1.0, 2);
    expect(dist.get(28)).toBeCloseTo(0, 2);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run packages/core/src/weather/forecast-distribution.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
/**
 * Cumulative distribution function for the standard normal distribution.
 * Uses the Abramowitz-Stegun approximation for erf.
 */
export function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) {
    return x >= mean ? 1 : 0;
  }
  const z = (x - mean) / (stdDev * Math.SQRT2);
  // Abramowitz-Stegun approximation for erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  // For z >= 0: CDF = 0.5 + erf/2; for z < 0: CDF = 0.5 - erf/2
  return z >= 0 ? 0.5 + erf / 2 : 0.5 - erf / 2;
}

/**
 * Build a discrete probability distribution over integer temperature outcomes.
 * Each temperature k gets probability P(k-0.5 <= temp < k+0.5) = CDF(k+0.5) - CDF(k-0.5).
 *
 * @param forecastMean - Mean forecast temperature (°C)
 * @param forecastStdDev - Std dev of the forecast (°C)
 * @param outcomes - Array of integer temperature values to compute probabilities for
 * @returns Map of temperature -> probability [0,1]
 */
export function buildTempProbabilityDistribution(
  forecastMean: number,
  forecastStdDev: number,
  outcomes: number[],
): Map<number, number> {
  const dist = new Map<number, number>();
  for (const temp of outcomes) {
    const lower = normalCDF(temp - 0.5, forecastMean, forecastStdDev);
    const upper = normalCDF(temp + 0.5, forecastMean, forecastStdDev);
    dist.set(temp, Math.max(0, upper - lower));
  }
  return dist;
}
```

**Step 4: Run tests to verify pass**

Run: `npx vitest run packages/core/src/weather/forecast-distribution.test.ts`
Expected: PASS — 6 tests

**Step 5: Add re-export to core index.ts**

```typescript
export { normalCDF, buildTempProbabilityDistribution } from './weather/forecast-distribution.js';
```

---

### Task 2.8: Create `weather-edge.ts` (edge calculation + dynamic threshold)

**Objective:** Calculate the edge (forecast prob - market price) and the dynamic minimum edge threshold.

**Files:**
- Create: `packages/core/src/weather/weather-edge.ts`
- Create: `packages/core/src/weather/weather-edge.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { calculateEdge, resolveDynamicMinEdge } from './weather-edge.js';

describe('calculateEdge', () => {
  it('returns positive edge when forecast > market', () => {
    expect(calculateEdge(0.35, 0.25)).toBeCloseTo(0.10, 4);
  });
  it('returns negative edge when forecast < market', () => {
    expect(calculateEdge(0.20, 0.30)).toBeCloseTo(-0.10, 4);
  });
  it('returns 0 when equal', () => {
    expect(calculateEdge(0.30, 0.30)).toBe(0);
  });
});

describe('resolveDynamicMinEdge', () => {
  it('returns base edge at J-0 with low uncertainty', () => {
    const edge = resolveDynamicMinEdge(0.5, 3); // 0.5°C std, 3h left
    expect(edge).toBeCloseTo(0.10, 2); // 10% base, no penalty, time factor = -3%
  });

  it('increases edge with higher uncertainty', () => {
    const edge = resolveDynamicMinEdge(3, 3); // 3°C std, 3h left
    expect(edge).toBeGreaterThan(0.10);
  });

  it('increases edge when far from resolution', () => {
    const edgeNear = resolveDynamicMinEdge(2, 3);
    const edgeFar = resolveDynamicMinEdge(2, 48);
    expect(edgeFar).toBeGreaterThan(edgeNear);
  });

  it('never goes below 5%', () => {
    const edge = resolveDynamicMinEdge(0, 1);
    expect(edge).toBeGreaterThanOrEqual(0.05);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `npx vitest run packages/core/src/weather/weather-edge.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
/**
 * Calculate the edge = forecast probability - market price.
 * Positive edge means the market underprices the outcome (buy YES).
 * Negative edge means the market overprices the outcome (buy NO or skip).
 */
export function calculateEdge(
  forecastProbability: number,
  marketPrice: number,
): number {
  return forecastProbability - marketPrice;
}

/**
 * Resolve the dynamic minimum edge threshold based on:
 * - Forecast uncertainty (std dev across models): higher uncertainty → higher edge required
 * - Time to resolution: closer to resolution → lower edge required (forecast is more reliable)
 *
 * Formula: max(5%, base_edge + uncertainty_penalty + time_factor)
 *
 * @param forecastStdDev - Std dev across weather models (°C)
 * @param hoursToResolution - Hours remaining before market resolves
 * @param baseEdge - Base edge from RiskConfig (default 0.10)
 */
export function resolveDynamicMinEdge(
  forecastStdDev: number,
  hoursToResolution: number,
  baseEdge: number = 0.10,
): number {
  // Uncertainty penalty: +5% per °C of std dev, capped at +15%
  const uncertaintyPenalty = Math.min(forecastStdDev * 0.05, 0.15);

  // Time factor: -3% if ≤6h to resolution (forecast reliable), 0% if ≤24h, +5% if >24h
  let timeFactor: number;
  if (hoursToResolution <= 6) {
    timeFactor = -0.03;
  } else if (hoursToResolution <= 24) {
    timeFactor = 0;
  } else {
    timeFactor = 0.05;
  }

  return Math.max(0.05, baseEdge + uncertaintyPenalty + timeFactor);
}
```

**Step 4: Run tests to verify pass**

Run: `npx vitest run packages/core/src/weather/weather-edge.test.ts`
Expected: PASS — 7 tests

**Step 5: Add re-export to core index.ts**

```typescript
export { calculateEdge, resolveDynamicMinEdge } from './weather/weather-edge.js';
```

---

## Phase 3 — Worker Integration

### Task 3.1: Add `WEATHER_ORDER_SIGNALS` queue consumer to the worker

**Objective:** The worker consumes the new weather-order-signals queue using the existing `Executor`.

**Files:**
- Modify: `packages/worker/src/index.ts`
- Modify: `packages/worker/src/processors/executor.ts` (add `WEATHER_OPEN` to `ENTRY_BUY_REASONS` + book readiness check)

**Step 1: Add `WEATHER_OPEN` to `ENTRY_BUY_REASONS` in the executor**

In `packages/worker/src/processors/executor.ts:44`, the `ENTRY_BUY_REASONS` set controls which `OrderReason` values are treated as entry (BUY) signals. Without adding `WEATHER_OPEN`, the executor's `isEntryBuySignal()` check will reject weather-algo entry signals.

```typescript
const ENTRY_BUY_REASONS = new Set(['COPY_OPEN', 'COPY_INCREASE', 'ALGO_OPEN', 'WEATHER_OPEN']);
```

**Step 2: Add `WEATHER_OPEN` to the book readiness check**

In `packages/worker/src/processors/executor.ts:255`, there's a special book readiness check for `ALGO_OPEN` signals. Apply the same check to `WEATHER_OPEN`:

```typescript
if ((signal.reason === 'ALGO_OPEN' || signal.reason === 'WEATHER_OPEN') && signal.side === 'BUY') {
```

**Step 3: Add the new Redis connection and queue consumer to worker/index.ts**

In `packages/worker/src/index.ts`, after the existing `redisAlgoOrderConsumer` declaration (~line 95), add:

```typescript
const redisWeatherOrderConsumer = createRedis();
```

After the `algoOrderQueueConsumer` declaration (~line 160-165), add:

```typescript
const weatherOrderQueueConsumer = new RedisQueue<OrderSignal>(
  redisWeatherOrderConsumer,
  WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
  (job) => executorA.handle(job),
  { onDeadLetter: notifyBackendAlert },
);
```

After the `await algoOrderQueueConsumer.recoverOrphans()` call (~line 202), add:

```typescript
await weatherOrderQueueConsumer.recoverOrphans();
```

After the `algoOrderQueueConsumer.startConsumer()` block (~line 424-427), add:

```typescript
void weatherOrderQueueConsumer.startConsumer().catch((err) => {
  log.fatal({ err, queue: 'weather-order-signals' }, 'queue consumer crashed');
  process.exit(1);
});
```

In the `shutdown` function, after `await redisAlgoOrderConsumer.quit()`, add:

```typescript
await redisWeatherOrderConsumer.quit();
```

**Step 4: Verify build**

Run: `npm run build -w @polywatch/worker`
Expected: PASS

---

## Phase 4 — Weather Algo Package

### Task 4.1: Scaffold `packages/weather-algo`

**Objective:** Create the package directory with package.json and tsconfig.

**Files:**
- Create: `packages/weather-algo/package.json`
- Create: `packages/weather-algo/tsconfig.json`
- Modify: root `package.json` (add weather-algo to build/dev/test scripts)

**Step 1: Create package.json**

```json
{
  "name": "@polywatch/weather-algo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@polywatch/core": "*",
    "ioredis": "^5.6.1",
    "pino": "^9.6.0",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "tsx": "^4.19.3",
    "vitest": "^3.1.2"
  }
}
```

**Step 2: Create tsconfig.json**

Copy from `packages/crypto-algo/tsconfig.json` and adjust paths. The tsconfig should extend the root tsconfig.

**Step 3: Update root package.json scripts**

In the root `package.json`, add `@polywatch/weather-algo` to the `build`, `dev`, and `test` script chains (same pattern as crypto-algo).

**Step 4: Verify install**

Run: `npm install`
Expected: PASS

---

### Task 4.2: Create `config.ts`

**Objective:** Weather-algo configuration from environment variables.

**Files:**
- Create: `packages/weather-algo/src/config.ts`

```typescript
import {
  getDatabaseUrl,
  loadMonorepoEnv,
} from '@polywatch/core/config/env';

loadMonorepoEnv();

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  databaseUrl: getDatabaseUrl(),
  backendUrl: process.env.BACKEND_URL ?? 'http://localhost:3000',
  serviceToken:
    process.env.SERVICE_TOKEN ?? 'dev-service-token-change-in-prod-32',
  gammaApi:
    process.env.POLYMARKET_GAMMA_API ?? 'https://gamma-api.polymarket.com',
  clobApi: process.env.POLYMARKET_CLOB_API ?? 'https://clob.polymarket.com',
  wsUrl:
    process.env.POLYMARKET_WS_URL ??
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  pollMs: Number(process.env.WEATHER_ALGO_POLL_MS ?? 1800000),
  forecastCacheTtlMs: Number(process.env.WEATHER_FORECAST_CACHE_TTL_MS ?? 3600000),
};
```

---

### Task 4.3: Create `watchlist-seed.ts`

**Objective:** Seed the weather-algo WatchlistEntry (same pattern as crypto-algo).

**Files:**
- Create: `packages/weather-algo/src/watchlist-seed.ts`

```typescript
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { WatchlistEntry } from '@polywatch/core';

const log = pino({ name: 'weather-algo:watchlist-seed' });

export const WEATHER_ALGO_TRADER_ADDRESS = 'weather-algo';

export async function seedWeatherAlgoWatchlistEntry(
  ds: DataSource,
): Promise<number> {
  const repo = ds.getRepository(WatchlistEntry);
  const existing = await repo.findOne({
    where: { traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
  });
  if (existing) {
    log.info(
      { id: existing.id, traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
      'weather-algo watchlist entry already exists',
    );
    return existing.id;
  }
  const entry = repo.create({
    traderAddress: WEATHER_ALGO_TRADER_ADDRESS,
    nickname: 'Weather Algo',
    active: true,
    simEnabled: true,
    realEnabled: true,
  });
  const saved = await repo.save(entry);
  log.info(
    { id: saved.id, traderAddress: WEATHER_ALGO_TRADER_ADDRESS },
    'created weather-algo watchlist entry',
  );
  return saved.id;
}
```

---

### Task 4.4: Create `selection-loader.ts`

**Objective:** Keep an in-memory snapshot of enabled weather market selections (clone of crypto-algo pattern).

**Files:**
- Create: `packages/weather-algo/src/selection-loader.ts`

This is a direct adaptation of `packages/crypto-algo/src/selection-loader.ts` but using `WeatherMarketSelectionService` and `WeatherMarketSelection` types. The Redis `config-changed` subscription and 60s periodic refresh logic are identical.

---

### Task 4.5: Create `strategy/strategy.ts` (interfaces)

**Objective:** Define the `WeatherSignal` and `WeatherStrategy` interfaces.

**Files:**
- Create: `packages/weather-algo/src/strategy/strategy.ts`

```typescript
import type { MarketListItemDto } from '@polywatch/core';

export interface WeatherSignal {
  conditionId: string;
  assetId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY';
  confidence: number;
  reasons: string[];
  strategyId: string;
  eventSlug: string;
  forecastMean: number;
  forecastStdDev: number;
  forecastProbability: number;
  marketPrice: number;
  edge: number;
}

export interface WeatherEvaluationContext {
  forecastMean: number;
  forecastStdDev: number;
  /** Probability distribution over temperature outcomes for the event. */
  tempDistribution: Map<number, number>;
}

export type WeatherEvaluationResult =
  | { kind: 'signal'; signal: WeatherSignal }
  | { kind: 'abstain'; reason: string; detail?: string };

export interface WeatherStrategy {
  readonly id: string;
  evaluate(
    market: MarketListItemDto,
    ctx: WeatherEvaluationContext,
  ): Promise<WeatherEvaluationResult>;
}
```

---

### Task 4.6: Create `strategy/weather-forecast.strategy.ts`

**Objective:** The main strategy that compares forecast probability with market price.

**Files:**
- Create: `packages/weather-algo/src/strategy/weather-forecast.strategy.ts`

This strategy:
1. Parses the question to get the target temperature
2. Looks up the forecast probability from the distribution
3. Compares with the market price (YES outcome price)
4. If edge > dynamic threshold → signal BUY YES
5. If negative edge (forecast says NO more likely than market prices) → signal BUY NO
6. Otherwise → abstain

Key implementation details:
- The strategy receives the `WeatherEvaluationContext` (forecast + distribution) from the runner
- It parses `market.question` with `parseWeatherQuestion` to get the target temperature
- It reads `market.outcomePrices` to get the current YES/NO prices
- It computes `edge = forecastProb - marketPrice`
- It resolves the dynamic threshold with `resolveDynamicMinEdge`
- It returns a `WeatherSignal` with all the data for the entry pipeline

---

### Task 4.7: Create `strategy/strategy-runner.ts`

**Objective:** Periodic runner that evaluates all enabled weather selections.

**Files:**
- Create: `packages/weather-algo/src/strategy/strategy-runner.ts`

The runner:
1. Groups enabled selections by `eventSlug` (negRisk grouping)
2. For each event group:
   a. Parses all sub-market questions to extract city + date + metric + target temps
   b. Fetches multi-model forecast (via `WeatherForecastService` cache + `fetchWeatherForecast`)
   c. Builds the probability distribution
   d. For each sub-market, calls `strategy.evaluate(market, ctx)` with the shared forecast context
   e. Collects signals, applies selection mode (single/multi/spread)
   f. Calls the `onSignal` callback for each selected signal
3. Runs on `safeInterval` with `pollMs` from config

Selection mode logic:
- `single`: pick the signal with the highest absolute edge
- `multi`: pick top N signals by absolute edge, max `weatherAlgoMaxSignalsPerEvent`, but never 2 signals in the same direction (YES/NO) on the same event
- `spread`: pick the YES signal closest to the forecast mean + the NO signal farthest from the forecast mean

---

### Task 4.8: Create `processors/weather-entry-pipeline.ts`

**Objective:** Transform a `WeatherSignal` into an `OrderSignal` and enqueue it.

**Files:**
- Create: `packages/weather-algo/src/processors/weather-entry-pipeline.ts`

This is adapted from `crypto-algo/src/processors/algo-entry-pipeline.ts` but:
- Uses `WEATHER_ORDER_SIGNALS` queue
- Uses `OrderReason.WEATHER_OPEN` as the reason
- Sizing uses `weatherAlgoEntryUsdc` from RiskConfig
- The liquidity/sizing/MOS gate logic is **reused** from `@polywatch/core` (same functions: `computeEntryTargetQuantity`, `applyEntryMosGate`, `fetchEntryAskLiquidityWithRetries`, etc.)
- Re-entry throttle is per `eventSlug` (not per conditionId) to prevent multiple entries on the same event

---

### Task 4.9: Create `runtime-status.ts`

**Objective:** Publish weather-algo runtime status to Redis for the backend.

**Files:**
- Create: `packages/weather-algo/src/runtime-status.ts`

Same pattern as `crypto-algo/src/runtime-status.ts` but with key `weather-algo:runtime-status`.

---

### Task 4.10: Create `index.ts` (main loop)

**Objective:** Wire everything together — the main entry point.

**Files:**
- Create: `packages/weather-algo/src/index.ts`

The main function:
1. Initialize DataSource
2. Assert database exists
3. Seed weather-algo watchlist entry
4. Create services (risk, market, selection, forecast, autoTrack, reservation, simulation)
5. Create Redis connections (cmd, pub, sub)
6. Create SelectionLoader
7. Create WeatherForecastService
8. Create StrategyRegistry + register WeatherForecastStrategy
9. Create PolymarketConnectionManager
10. Create order queue (WEATHER_ORDER_SIGNALS)
11. Wait for backend ready
12. Load RiskConfig, check kill switch
13. Load selections, subscribe to config changes
14. Create StrategyRunner with onSignal callback (→ weather-entry-pipeline)
15. Start evaluation loop
16. Start heartbeat
17. Subscribe to config-changed, forecast-change-close events
18. Graceful shutdown

The forecast-change-close logic:
- On each evaluation cycle, for each open weather-algo position, compare the current forecast mean with the forecast mean at entry time (stored in `WeatherForecastCache` or a position metadata field)
- If `|currentForecastMean - entryForecastMean| > weatherAlgoForecastChangeThreshold` → emit close signal via `close-signals` queue with `OrderReason.WEATHER_FORECAST_CHANGE`

---

## Phase 5 — Backend Routes

### Task 5.1: Create `weather-algo-markets.ts` router

**Objective:** CRUD routes for weather market selections.

**Files:**
- Create: `packages/backend/src/routes/weather-algo-markets.ts`
- Modify: `packages/backend/src/index.ts` (register router)

This mirrors `algo-markets.ts`:
```
GET    /                          → List all weather selections
POST   /                          → Add a market selection
DELETE /:conditionId              → Remove a market selection
PATCH  /:conditionId              → Enable/disable a market selection
GET    /status                    → Weather-algo runtime status
POST   /notify-changed            → Internal: notify of market changes
```

Register in index.ts:
```typescript
app.use('/api/weather-algo-markets', jwtLimiter, createWeatherAlgoMarketsRouter(ds));
```

**Note:** The mount path uses dashes (`/api/weather-algo-markets`) to match the existing pattern (`/api/algo-markets`). The frontend must call these routes with the dash-based path, e.g. `GET /api/weather-algo-markets` and `GET /api/weather-algo-markets/status`.

---

### Task 5.2: Create `weather-algo-discover.ts` router

**Objective:** Route to discover available weather markets on Polymarket.

**Files:**
- Create: `packages/backend/src/routes/weather-algo-discover.ts`
- Modify: `packages/backend/src/index.ts` (register router)

```
GET /api/weather-algo-discover?limit=50&offset=0
```

Calls `discoverWeatherMarkets()` from core and returns the results.

---

### Task 5.3: Create `weather-algo-forecasts.ts` router

**Objective:** Route to fetch weather forecasts for a city + date.

**Files:**
- Create: `packages/backend/src/routes/weather-algo-forecasts.ts`
- Modify: `packages/backend/src/index.ts` (register router)

```
GET /api/weather-algo-forecasts/:city/:date?metric=highest_temp
```

Checks the forecast cache first, falls back to `fetchWeatherForecast()`.

---

### Task 5.4: Create `weather-algo-auto-track.ts` router

**Objective:** CRUD routes for auto-track rules.

**Files:**
- Create: `packages/backend/src/routes/weather-algo-auto-track.ts`
- Modify: `packages/backend/src/index.ts` (register router)

```
GET    /api/weather-algo-auto-track
POST   /api/weather-algo-auto-track
DELETE /api/weather-algo-auto-track/:id
PATCH  /api/weather-algo-auto-track/:id
```

---

## Phase 6 — Frontend

### Task 6.1: Add `weather-algo` to `APP_PAGES`

**Files:**
- Modify: `packages/frontend/src/lib/ui-persistence.ts`

```typescript
export type AppPage =
  | 'simulation'
  | 'real'
  | 'leaderboard'
  | 'markets'
  | 'wallet'
  | 'crypto-algo'
  | 'weather-algo'
  | 'system';

export const APP_PAGES = [
  'simulation', 'real', 'leaderboard', 'markets', 'wallet',
  'crypto-algo', 'weather-algo', 'system',
] as const;
```

---

### Task 6.2: Add Weather Algo nav button + page routing in `App.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`

Add a nav button between "Crypto Algo" and "Système":

```tsx
<button
  class={`btn btn-sm ${page() === 'weather-algo' ? 'btn-primary' : 'btn-ghost'}`}
  onClick={() => setPage('weather-algo')}
>
  Weather Algo
</button>
```

Add the page render:

```tsx
<Show when={page() === 'weather-algo'}>
  <main class="page page-weather-algo">
    <WeatherAlgoPage />
  </main>
</Show>
```

---

### Task 6.3: Create `WeatherAlgoPage.tsx` and sub-components

**Files:**
- Create: `packages/frontend/src/components/WeatherAlgoPage.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoHeader.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoDiscoverPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoActiveMarketsPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoForecastPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoPositionsPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoExecutionsPanel.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoAutoTrackTab.tsx`
- Create: `packages/frontend/src/components/WeatherAlgoSettingsTab.tsx`
- Create: `packages/frontend/src/hooks/useWeatherAlgoDashboard.ts`
- Create: `packages/frontend/src/hooks/useWeatherAlgoPositions.ts`

These components follow the same architecture as the `CryptoAlgo*` components:
- `WeatherAlgoPage` orchestrates the sub-components + polling refresh
- `WeatherAlgoHeader` shows status (alive, enabled selections, last evaluated)
- `WeatherAlgoDiscoverPanel` calls `/api/weather-algo/discover` to list available markets, allows adding to selection
- `WeatherAlgoActiveMarketsPanel` shows enabled markets with forecast vs market price + edge
- `WeatherAlgoForecastPanel` shows multi-model forecasts (per-model values, mean, std dev)
- `WeatherAlgoPositionsPanel` shows open positions with a Close button
- `WeatherAlgoExecutionsPanel` shows execution history
- `WeatherAlgoAutoTrackTab` manages city + look-ahead rules
- `WeatherAlgoSettingsTab` manages RiskConfig weather fields

---

## Phase 7 — Tests, Docs & Validation

### Task 7.1: Run full test suite

Run: `npm run test`
Expected: All existing tests pass + new weather tests pass

### Task 7.2: Run lint

Run: `npm run lint`
Expected: No new errors

### Task 7.3: Run build

Run: `npm run build`
Expected: All packages build successfully

### Task 7.4: Run migration

Run: `npm run migrate`
Expected: Migration applies cleanly, tables created

### Task 7.5: Update documentation

- Update `docs/api.md` with new weather-algo routes
- Update `docs/architecture.md` with weather-algo package description
- Create `change.history.md` in the project root (does not exist yet) and append the weather-algo addition

---

## Open Questions (Resolved During Planning)

| Question | Resolution |
|----------|-----------|
| negRiskMarketID not in Gamma API | Use `eventSlug` (already in `MarketListItemDto`) as event grouping key |
| Open-Meteo multi-model format | Open-Meteo returns per-model data as `${model}_daily` keys in a single response; fallback to per-model requests if absent |
| Date parsing ambiguity ("July 24" → which year?) | Use current year, shift to next year if date is >6 months in the past |
| Forecast probability distribution | Normal distribution N(mean, stdDev), discrete bins per integer °C via CDF differences |
| Re-entry throttle | Per `eventSlug` (not per conditionId) to prevent multiple entries on same event |
| Position close trigger | Forecast mean drift > threshold (configurable in RiskConfig) + manual close + auto-close before resolution |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Open-Meteo API format changes | Defensive parsing, fallback to per-model requests, cache reduces API calls |
| Question parser doesn't cover all formats | Regex-based parser, skip unrecognized questions, log for monitoring |
| Low liquidity on weather markets | Reuse existing worker gates (MOS, slippage, depth retry) — they are generic |
| Multi-outcome event selection conflict | Group by eventSlug, never 2 YES on same event, configurable selection mode |
| Forecast cache stale | TTL-based expiry + periodic refresh in evaluation loop |
| negRisk execution path | Worker already handles negRisk in `real-executor.ts` — no change needed |
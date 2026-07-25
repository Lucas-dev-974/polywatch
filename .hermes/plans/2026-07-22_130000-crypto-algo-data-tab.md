# Crypto Algo — Onglet "Données" Implementation Plan

> **For Hermes:** Use the polywatch-feature-development skill to implement this plan task-by-task. Verify against the actual codebase at each step.

**Goal:** Add a "Données" tab to the Crypto Algo page that lists crypto market data stored in the database (Polymarket binary up/down markets), with a dynamic filter bar (filter by crypto, time interval, market outcome), plus an ERD-style schema reference section.

**Architecture:** The Crypto Algo page currently renders all content as stacked panels (no tabs). We introduce a 2-tab layout ("Dashboard" = existing content, "Données" = new data browser). The new tab has two sections: (1) a data table with a dynamic filter bar populated from DB-distinct values, backed by a new backend route; (2) an ERD-style schema display showing the column structure of the three algo data tables.

**Tech Stack:** SolidJS (frontend), Express + TypeORM (backend), PostgreSQL (data source), `@polywatch/core` services.

---

## Current Context & Assumptions

### What exists
- **`CryptoAlgoPage.tsx`** (`packages/frontend/src/components/CryptoAlgoPage.tsx`) — renders stacked panels: Header, CapitalDashboard, LiveMarkets, FutureMarkets, InactiveMarkets, Surveillance, Executions, Positions. No tab system.
- **`CryptoAlgoHeader.tsx`** — page header with status badge, full-page toggle, settings/report triggers.
- **`ui-persistence.ts`** — already has tab patterns (`SYSTEM_PAGE_TABS`, `usePersistedEnum`). The `crypto-algo` page is a top-level `AppPage` but has no sub-tab type yet.
- **Backend route pattern** — `packages/backend/src/routes/algo-*.ts` files, registered in `index.ts` with `app.use('/api/algo/...', jwtLimiter, createXxxRouter(ds))`.
- **`AlgoSurveillanceSnapshot` entity** — 25 columns: conditionId, question, cryptoSymbol, interval, slug, marketStartAt, marketEndAt, openUpPrice, openDownPrice, openCapturedAt, closeUpPrice, closeDownPrice, closeCapturedAt, winningOutcome, unresolvedAt, positionsJson, positionsCapturedAt, createdAt, updatedAt. Table: `algo_surveillance_snapshots`.
- **`AlgoPriceTick` entity** — 40+ columns: conditionId, upPrice, downPrice, upBid, upAsk, downBid, downAsk, spreads, VWAPs, liquidityStatus, priceGap, secondsUntilEnd, bookStalenessMs, wsHealthy, sizes, lastTrade prices/sizes, deltas, openPositionsCount, openExposureUsd, unrealizedPnl, signal fields, abstainReason, recordedAt, createdAt. Table: `algo_price_ticks`.
- **`AlgoMarketSelection` entity** — conditionId, question, cryptoSymbol, interval, slug, enabled, timestamps. Table: `algo_market_selections`.
- **`AlgoAutoTrackRule` entity** — cryptoSymbol, interval, enabled, timestamps. Table: `algo_auto_track_rules`.
- **`AlgoSurveillanceService`** (`packages/core/src/services/algo-surveillance.service.ts`) — has `listHistory(limit, offset)` returning `{ items, total }` but no filtering by cryptoSymbol/interval/winningOutcome.
- **`AlgoPriceTickService`** (`packages/core/src/services/algo-price-tick.service.ts`) — has `listTicks(conditionId, { from, to, limit })` but no multi-market listing or filtering.
- **`api.ts`** (`packages/frontend/src/api.ts`) — `api<T>(path)` wrapper with cache. `shouldUseGetCache` and `getCacheTtl` need entries for the new route.

### Key design decisions
1. **No new entities/migrations needed** — we are querying existing tables (`algo_surveillance_snapshots`, `algo_price_ticks`, `algo_market_selections`, `algo_auto_track_rules`). All entities and migrations are already registered in `data-source.ts`.
2. **Two-tab layout on CryptoAlgoPage** — "Dashboard" (existing panels) and "Données" (new). Persisted via `usePersistedEnum` in `ui-persistence.ts`.
3. **Dynamic filter bar** — filters populated from DB-distinct values (cryptoSymbol list, interval list) via a new `/api/algo/data-filters` metadata endpoint. The outcome filter (up/down/all) and date range are client-side options.
4. **Backend: new route `algo-data.ts`** — serves paginated, filtered data from `algo_surveillance_snapshots` (the primary "market data" table for binary up/down markets) and a metadata endpoint for filter options.
5. **ERD section** — static schema reference rendered from a TS constant (column name, type, nullable, description). No backend call needed — the schema is known at build time from the entity definitions.

### Open questions (resolved by design)
- **"Données crypto enregistrées en BDD"** → The primary data table is `algo_surveillance_snapshots` (one row per market window: open/close prices, winning outcome, market metadata). `algo_price_ticks` is the high-frequency tick table (1 row/second/market) — too verbose for a table browser but included in the ERD section.
- **"Marché up ou marché down"** → Filter by `winningOutcome` ('up' / 'down' / null for unresolved).
- **"Range time 5min/10min"** → Filter by `interval` column ('5m', '10m', '15m', '1h', etc.).
- **No new migration** → No schema change. Pure read-only feature on existing tables.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/backend/src/routes/algo-data.ts` | New Express route: `GET /api/algo/data` (paginated, filtered surveillance snapshots) + `GET /api/algo/data/filters` (distinct cryptoSymbols, intervals, winningOutcomes) |
| `packages/core/src/services/algo-data.service.ts` | Service with `listSnapshotsFiltered(filters)` and `getFilterOptions()` querying `AlgoSurveillanceSnapshot` |
| `packages/core/src/lib/algo-data.types.ts` | TypeScript types for filter params, DTOs, ERD schema constants |
| `packages/frontend/src/components/CryptoAlgoDataTab.tsx` | Main "Données" tab component: filter bar + data table (Section 1) + ERD schema tables (Section 2) |
| `packages/frontend/src/components/CryptoAlgoDataFilters.tsx` | Dynamic filter bar component (crypto select, interval select, outcome select, date range, clear button) |
| `packages/frontend/src/components/CryptoAlgoDataTable.tsx` | Paginated table rendering filtered surveillance snapshots |
| `packages/frontend/src/components/CryptoAlgoSchemaERD.tsx` | ERD-style schema display for the 4 algo tables (columns, types, nullable, descriptions) |
| `packages/frontend/src/hooks/useCryptoAlgoData.ts` | SolidJS hook: fetches filter options + paginated data, manages filter state |
| `packages/frontend/src/lib/algo-data-erd.ts` | Static ERD schema definitions (column metadata for 4 tables) |

## Files to Modify

| File | Change |
|------|--------|
| `packages/frontend/src/components/CryptoAlgoPage.tsx` | Add tab system (Dashboard / Données), render new `CryptoAlgoDataTab` when "Données" active |
| `packages/frontend/src/lib/ui-persistence.ts` | Add `CryptoAlgoPageTab` type, `CRYPTO_ALGO_PAGE_TABS` const, `UI_KEYS.cryptoAlgoTab` key |
| `packages/backend/src/index.ts` | Import + register `createAlgoDataRouter`, `app.use('/api/algo/data', ...)` |
| `packages/core/src/services/index.ts` | Export `AlgoDataService` and types |
| `packages/frontend/src/api.ts` | Add `/algo/data` to `shouldUseGetCache` exclusion + `getCacheTtl` dynamic TTL |
| `docs/api.md` | Add new routes to the Crypto-Algo section table |
| `docs/frontend.md` | Update Crypto Algo page description with tab system + new components |

---

## Step-by-Step Plan

### Task 1: Core types and ERD schema definitions

**Objective:** Create the shared TypeScript types for data filtering, DTOs, and the static ERD schema constants.

**Files:**
- Create: `packages/core/src/lib/algo-data.types.ts`

**Step 1: Write the types file**

```typescript
// packages/core/src/lib/algo-data.types.ts

/** Filter parameters for the algo data browser. */
export interface AlgoDataFilters {
  cryptoSymbol?: string | null;   // e.g. 'BTC', 'ETH' — null = all
  interval?: string | null;       // e.g. '5m', '10m', '1h' — null = all
  winningOutcome?: string | null; // 'up' | 'down' | null — null = all (incl. unresolved)
  from?: string | null;            // ISO date — market_start_at >= from
  to?: string | null;              // ISO date — market_start_at <= to
  limit?: number;
  offset?: number;
}

/** Metadata for populating the dynamic filter bar. */
export interface AlgoDataFilterOptions {
  cryptoSymbols: string[];  // distinct non-null values, sorted
  intervals: string[];      // distinct non-null values, sorted
  winningOutcomes: string[]; // distinct non-null values, typically ['up', 'down']
}

/** DTO for a surveillance snapshot row in the data table. */
export interface AlgoDataSnapshotDto {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  marketStartAt: string | null;  // ISO
  marketEndAt: string | null;     // ISO
  openUpPrice: number | null;
  openDownPrice: number | null;
  openCapturedAt: string | null;
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
  winningOutcome: string | null;
  unresolvedAt: string | null;
}

/** Paginated response. */
export interface AlgoDataResponse {
  items: AlgoDataSnapshotDto[];
  total: number;
  filters: AlgoDataFilterOptions;
}
```

**Step 2: Create the ERD schema constants (frontend)**

```typescript
// packages/frontend/src/lib/algo-data-erd.ts

export interface ErdColumn {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

export interface ErdTable {
  table: string;       // DB table name
  entity: string;      // TypeScript entity name
  columns: ErdColumn[];
}

export const ALGO_ERD_TABLES: ErdTable[] = [
  {
    table: 'algo_surveillance_snapshots',
    entity: 'AlgoSurveillanceSnapshot',
    columns: [
      { name: 'id', type: 'integer (PK)', nullable: false, description: 'ID auto-généré' },
      { name: 'condition_id', type: 'text', nullable: false, description: 'ID condition Polymarket (hex 0x…)' },
      { name: 'question', type: 'text', nullable: true, description: 'Question du marché (ex: "BTC up or down in 5min?")' },
      { name: 'crypto_symbol', type: 'text', nullable: true, description: 'Symbole crypto (BTC, ETH, SOL…)' },
      { name: 'interval', type: 'text', nullable: true, description: 'Intervalle du marché (5m, 10m, 15m, 1h)' },
      { name: 'slug', type: 'text', nullable: true, description: 'Slug Gamma du marché' },
      { name: 'market_start_at', type: 'timestamp', nullable: true, description: 'Début de la fenêtre de marché' },
      { name: 'market_end_at', type: 'timestamp', nullable: true, description: 'Fin de la fenêtre de marché' },
      { name: 'open_up_price', type: 'real', nullable: true, description: 'Prix UP à l\'ouverture (+5s après start)' },
      { name: 'open_down_price', type: 'real', nullable: true, description: 'Prix DOWN à l\'ouverture' },
      { name: 'open_captured_at', type: 'timestamp', nullable: true, description: 'Timestamp capture du prix d\'ouverture' },
      { name: 'close_up_price', type: 'real', nullable: true, description: 'Prix UP à la clôture (rédemption = 1.0)' },
      { name: 'close_down_price', type: 'real', nullable: true, description: 'Prix DOWN à la clôture (rédemption = 1.0)' },
      { name: 'close_captured_at', type: 'timestamp', nullable: true, description: 'Timestamp capture du prix de clôture' },
      { name: 'winning_outcome', type: 'text', nullable: true, description: 'Outcome gagnant: "up" ou "down"' },
      { name: 'unresolved_at', type: 'timestamp', nullable: true, description: 'Timestamp si marché non résolu (janitor)' },
      { name: 'positions_json', type: 'text (JSON)', nullable: true, description: 'Positions algo figées à la clôture (JSON array)' },
      { name: 'positions_captured_at', type: 'timestamp', nullable: true, description: 'Timestamp capture des positions' },
      { name: 'created_at', type: 'timestamp', nullable: false, description: 'Création de l\'enregistrement' },
      { name: 'updated_at', type: 'timestamp', nullable: false, description: 'Dernière mise à jour' },
    ],
  },
  {
    table: 'algo_price_ticks',
    entity: 'AlgoPriceTick',
    columns: [
      { name: 'id', type: 'integer (PK)', nullable: false, description: 'ID auto-généré' },
      { name: 'condition_id', type: 'text', nullable: false, description: 'ID condition Polymarket' },
      { name: 'up_price', type: 'real', nullable: true, description: 'Prix mid UP (probabilité 0..1)' },
      { name: 'down_price', type: 'real', nullable: true, description: 'Prix mid DOWN (probabilité 0..1)' },
      { name: 'up_bid / up_ask', type: 'real', nullable: true, description: 'Carnet d\'ordres UP (bid/ask)' },
      { name: 'down_bid / down_ask', type: 'real', nullable: true, description: 'Carnet d\'ordres DOWN (bid/ask)' },
      { name: 'up_spread_pct / down_spread_pct', type: 'real', nullable: true, description: 'Spread en % du mid' },
      { name: 'up_ask_vwap / down_ask_vwap', type: 'real', nullable: true, description: 'VWAP ask' },
      { name: 'up_liquidity_status / down_liquidity_status', type: 'text', nullable: true, description: 'ok | partial | illiquid' },
      { name: 'price_gap', type: 'real', nullable: true, description: 'Écart up_price + down_price vs 1.0' },
      { name: 'seconds_until_end', type: 'integer', nullable: true, description: 'Secondes restantes avant fin du marché' },
      { name: 'book_staleness_ms', type: 'integer', nullable: true, description: 'Âge du carnet WS en ms' },
      { name: 'ws_healthy', type: 'boolean', nullable: true, description: 'WebSocket CLOB sain' },
      { name: 'up_bid_size / up_ask_size', type: 'real', nullable: true, description: 'Tailles au bid/ask UP' },
      { name: 'down_bid_size / down_ask_size', type: 'real', nullable: true, description: 'Tailles au bid/ask DOWN' },
      { name: 'up_last_trade_price / down_last_trade_price', type: 'real', nullable: true, description: 'Dernier prix de trade' },
      { name: 'up_last_trade_size / down_last_trade_size', type: 'real', nullable: true, description: 'Dernière taille de trade' },
      { name: 'up_delta_1s / down_delta_1s', type: 'real', nullable: true, description: 'Variation prix sur 1 seconde' },
      { name: 'open_positions_count', type: 'integer', nullable: false, description: 'Nombre de positions ouvertes (défaut 0)' },
      { name: 'open_exposure_usd', type: 'real', nullable: true, description: 'Exposition USD' },
      { name: 'unrealized_pnl', type: 'real', nullable: true, description: 'PnL non réalisé' },
      { name: 'last_signal_outcome', type: 'text', nullable: true, description: 'Dernier signal: "up" ou "down"' },
      { name: 'last_signal_confidence', type: 'real', nullable: true, description: 'Confiance du signal (0..1)' },
      { name: 'last_signal_strategy_id', type: 'text', nullable: true, description: 'ID stratégie émettrice' },
      { name: 'signal_age_ms', type: 'integer', nullable: true, description: 'Âge du dernier signal en ms' },
      { name: 'last_abstain_reason', type: 'text', nullable: true, description: 'Raison d\'abstention (code[:detail])' },
      { name: 'recorded_at', type: 'timestamp', nullable: false, description: 'Timestamp du tick (1 tick/seconde/marché)' },
      { name: 'created_at', type: 'timestamp', nullable: false, description: 'Création de l\'enregistrement' },
    ],
  },
  {
    table: 'algo_market_selections',
    entity: 'AlgoMarketSelection',
    columns: [
      { name: 'id', type: 'integer (PK)', nullable: false, description: 'ID auto-généré' },
      { name: 'condition_id', type: 'text', nullable: false, description: 'ID condition Polymarket' },
      { name: 'question', type: 'text', nullable: true, description: 'Question du marché' },
      { name: 'crypto_symbol', type: 'text', nullable: true, description: 'Symbole crypto' },
      { name: 'interval', type: 'text', nullable: true, description: 'Intervalle du marché' },
      { name: 'slug', type: 'text', nullable: true, description: 'Slug Gamma' },
      { name: 'enabled', type: 'boolean', nullable: false, description: 'Sélection active (défaut true)' },
      { name: 'created_at', type: 'timestamp', nullable: false, description: 'Création' },
      { name: 'updated_at', type: 'timestamp', nullable: false, description: 'Dernière mise à jour' },
    ],
  },
  {
    table: 'algo_auto_track_rules',
    entity: 'AlgoAutoTrackRule',
    columns: [
      { name: 'id', type: 'integer (PK)', nullable: false, description: 'ID auto-généré' },
      { name: 'crypto_symbol', type: 'text', nullable: false, description: 'Symbole crypto (ex: BTC)' },
      { name: 'interval', type: 'text', nullable: false, description: 'Intervalle (ex: 5m, 10m, 1h)' },
      { name: 'enabled', type: 'boolean', nullable: false, description: 'Règle active (défaut true)' },
      { name: 'created_at', type: 'timestamp', nullable: false, description: 'Création' },
      { name: 'updated_at', type: 'timestamp', nullable: false, description: 'Dernière mise à jour' },
    ],
  },
];
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit --project packages/core/tsconfig.json 2>&1 | grep algo-data`
Expected: no output (no errors in the new file).

---

### Task 2: Backend service — `AlgoDataService`

**Objective:** Create the service that queries `algo_surveillance_snapshots` with dynamic filters and returns distinct filter options.

**Files:**
- Create: `packages/core/src/services/algo-data.service.ts`

**Step 1: Write the service**

```typescript
// packages/core/src/services/algo-data.service.ts
import type { DataSource } from 'typeorm';
import { AlgoSurveillanceSnapshot } from '../entities/AlgoSurveillanceSnapshot.js';
import type {
  AlgoDataFilters,
  AlgoDataFilterOptions,
  AlgoDataSnapshotDto,
  AlgoDataResponse,
} from '../lib/algo-data.types.js';

export type {
  AlgoDataFilters,
  AlgoDataFilterOptions,
  AlgoDataSnapshotDto,
  AlgoDataResponse,
} from '../lib/algo-data.types.js';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function toDto(row: AlgoSurveillanceSnapshot): AlgoDataSnapshotDto {
  return {
    id: row.id,
    conditionId: row.conditionId,
    question: row.question,
    cryptoSymbol: row.cryptoSymbol,
    interval: row.interval,
    slug: row.slug,
    marketStartAt: toIso(row.marketStartAt),
    marketEndAt: toIso(row.marketEndAt),
    openUpPrice: row.openUpPrice,
    openDownPrice: row.openDownPrice,
    openCapturedAt: toIso(row.openCapturedAt),
    closeUpPrice: row.closeUpPrice,
    closeDownPrice: row.closeDownPrice,
    closeCapturedAt: toIso(row.closeCapturedAt),
    winningOutcome: row.winningOutcome,
    unresolvedAt: toIso(row.unresolvedAt),
  };
}

export class AlgoDataService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(AlgoSurveillanceSnapshot);
  }

  /**
   * Returns paginated, filtered surveillance snapshots.
   * Only rows that have at least an open or close capture are included
   * (consistent with the existing listHistory query).
   */
  async listFiltered(filters: AlgoDataFilters): Promise<AlgoDataResponse> {
    const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
    const offset = Math.max(0, filters.offset ?? 0);

    const qb = this.repo()
      .createQueryBuilder('s')
      .where(
        '(s.open_captured_at IS NOT NULL OR s.close_captured_at IS NOT NULL)',
      );

    if (filters.cryptoSymbol) {
      qb.andWhere('s.crypto_symbol = :cryptoSymbol', {
        cryptoSymbol: filters.cryptoSymbol,
      });
    }
    if (filters.interval) {
      qb.andWhere('s.interval = :interval', { interval: filters.interval });
    }
    if (filters.winningOutcome) {
      qb.andWhere('s.winning_outcome = :winningOutcome', {
        winningOutcome: filters.winningOutcome,
      });
    }
    if (filters.from) {
      qb.andWhere('s.market_start_at >= :from', { from: new Date(filters.from) });
    }
    if (filters.to) {
      qb.andWhere('s.market_start_at <= :to', { to: new Date(filters.to) });
    }

    qb.orderBy('s.market_start_at', 'DESC').addOrderBy('s.id', 'DESC');
    qb.take(limit).skip(offset);

    const [rows, total] = await qb.getManyAndCount();

    // Return filter options alongside data so the frontend can populate
    // the filter bar in a single round-trip on first load.
    const filterOptions = await this.getFilterOptions();

    return {
      items: rows.map(toDto),
      total,
      filters: filterOptions,
    };
  }

  /**
   * Returns distinct non-null values for the dynamic filter bar.
   * Queries are lightweight (indexed columns, small distinct sets).
   */
  async getFilterOptions(): Promise<AlgoDataFilterOptions> {
    const repo = this.repo();

    const [cryptoRows, intervalRows, outcomeRows] = await Promise.all([
      repo
        .createQueryBuilder('s')
        .select('DISTINCT s.crypto_symbol', 'crypto_symbol')
        .where('s.crypto_symbol IS NOT NULL')
        .orderBy('s.crypto_symbol', 'ASC')
        .getRawMany<{ crypto_symbol: string }>(),
      repo
        .createQueryBuilder('s')
        .select('DISTINCT s.interval', 'interval')
        .where('s.interval IS NOT NULL')
        .orderBy('s.interval', 'ASC')
        .getRawMany<{ interval: string }>(),
      repo
        .createQueryBuilder('s')
        .select('DISTINCT s.winning_outcome', 'winning_outcome')
        .where('s.winning_outcome IS NOT NULL')
        .orderBy('s.winning_outcome', 'ASC')
        .getRawMany<{ winning_outcome: string }>(),
    ]);

    return {
      cryptoSymbols: cryptoRows.map((r) => r.crypto_symbol),
      intervals: intervalRows.map((r) => r.interval),
      winningOutcomes: outcomeRows.map((r) => r.winning_outcome),
    };
  }
}
```

**Step 2: Export from services/index.ts**

Add to `packages/core/src/services/index.ts`:
```typescript
export { AlgoDataService, type AlgoDataFilters, type AlgoDataResponse, type AlgoDataSnapshotDto, type AlgoDataFilterOptions } from './algo-data.service.js';
```

**Step 3: Verify service compiles**

Run: `npx tsc --noEmit --project packages/core/tsconfig.json 2>&1 | grep algo-data`
Expected: no output.

---

### Task 3: Backend route — `algo-data.ts`

**Objective:** Create the Express route exposing the filtered data + filter metadata.

**Files:**
- Create: `packages/backend/src/routes/algo-data.ts`
- Modify: `packages/backend/src/index.ts` (register route)

**Step 1: Write the route**

```typescript
// packages/backend/src/routes/algo-data.ts
import { Router } from 'express';
import type { DataSource } from 'typeorm';
import { AlgoDataService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';

export function createAlgoDataRouter(ds: DataSource): Router {
  const router = Router();
  const service = new AlgoDataService(ds);

  // GET /api/algo/data — paginated, filtered surveillance snapshots
  router.get('/', requireJwt, async (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 50), 200));
    const offset = Math.max(0, Number(req.query.offset ?? 0));

    const filters = {
      cryptoSymbol: req.query.crypto ? String(req.query.crypto) : null,
      interval: req.query.interval ? String(req.query.interval) : null,
      winningOutcome: req.query.outcome ? String(req.query.outcome) : null,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
      limit,
      offset,
    };

    try {
      const result = await service.listFiltered(filters);
      res.json(result);
    } catch (err) {
      console.error('algo-data route error:', err);
      res.status(500).json({ error: 'data_query_failed' });
    }
  });

  // GET /api/algo/data/filters — distinct values for the dynamic filter bar
  router.get('/filters', requireJwt, async (_req, res) => {
    try {
      const options = await service.getFilterOptions();
      res.json(options);
    } catch (err) {
      console.error('algo-data filters error:', err);
      res.status(500).json({ error: 'filter_query_failed' });
    }
  });

  return router;
}
```

**Step 2: Register in backend index.ts**

In `packages/backend/src/index.ts`:
- Add import (after line 44, the `algo-worker-queue-status` import):
  ```typescript
  import { createAlgoDataRouter } from './routes/algo-data.js';
  ```
- Add registration (after line 160, the `createAlgoOptimizeReportRouter` line):
  ```typescript
  app.use('/api/algo/data', jwtLimiter, createAlgoDataRouter(ds));
  ```

**Step 3: Verify route compiles**

Run: `npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | grep algo-data`
Expected: no output.

---

### Task 4: Frontend — UI persistence for Crypto Algo tabs

**Objective:** Add the tab type and persistence key for the Crypto Algo page.

**Files:**
- Modify: `packages/frontend/src/lib/ui-persistence.ts`

**Step 1: Add tab types and constants**

After the `SYSTEM_PAGE_TABS` definition (line 24), add:

```typescript
export type CryptoAlgoPageTab = 'dashboard' | 'data';
export const CRYPTO_ALGO_PAGE_TABS = ['dashboard', 'data'] as const;
```

In the `UI_KEYS` object (line 57-68), add:

```typescript
cryptoAlgoTab: 'polywatch_crypto_algo_tab',
```

**Step 2: Verify compiles**

Run: `npx tsc --noEmit --project packages/frontend/tsconfig.json 2>&1 | grep ui-persistence`
Expected: no output.

---

### Task 5: Frontend hook — `useCryptoAlgoData`

**Objective:** SolidJS hook that manages filter state, fetches filter options, and loads paginated data.

**Files:**
- Create: `packages/frontend/src/hooks/useCryptoAlgoData.ts`

**Step 1: Write the hook**

```typescript
// packages/frontend/src/hooks/useCryptoAlgoData.ts
import { createSignal, onMount, type Accessor } from 'solid-js';
import { api } from '../api';

export interface AlgoDataSnapshotDto {
  id: number;
  conditionId: string;
  question: string | null;
  cryptoSymbol: string | null;
  interval: string | null;
  slug: string | null;
  marketStartAt: string | null;
  marketEndAt: string | null;
  openUpPrice: number | null;
  openDownPrice: number | null;
  openCapturedAt: string | null;
  closeUpPrice: number | null;
  closeDownPrice: number | null;
  closeCapturedAt: string | null;
  winningOutcome: string | null;
  unresolvedAt: string | null;
}

export interface AlgoDataFilterOptions {
  cryptoSymbols: string[];
  intervals: string[];
  winningOutcomes: string[];
}

export interface AlgoDataResponse {
  items: AlgoDataSnapshotDto[];
  total: number;
  filters: AlgoDataFilterOptions;
}

export interface AlgoDataFilters {
  crypto: string | null;
  interval: string | null;
  outcome: string | null;
  from: string;
  to: string;
}

export const ALGO_DATA_PAGE_SIZE = 25;

export function useCryptoAlgoData() {
  const [items, setItems] = createSignal<AlgoDataSnapshotDto[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filterOptions, setFilterOptions] = createSignal<AlgoDataFilterOptions>({
    cryptoSymbols: [],
    intervals: [],
    winningOutcomes: [],
  });

  const [filters, setFilters] = createSignal<AlgoDataFilters>({
    crypto: null,
    interval: null,
    outcome: null,
    from: '',
    to: '',
  });

  const pageCount = () => Math.max(1, Math.ceil(total() / ALGO_DATA_PAGE_SIZE));

  async function loadData(pageIndex: number) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(ALGO_DATA_PAGE_SIZE));
      params.set('offset', String(pageIndex * ALGO_DATA_PAGE_SIZE));

      const f = filters();
      if (f.crypto) params.set('crypto', f.crypto);
      if (f.interval) params.set('interval', f.interval);
      if (f.outcome) params.set('outcome', f.outcome);
      if (f.from) params.set('from', f.from);
      if (f.to) params.set('to', f.to);

      const data = await api<AlgoDataResponse>(
        `/algo/data?${params.toString()}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setFilterOptions(data.filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    void loadData(page());
  }

  function applyFilters(newFilters: AlgoDataFilters) {
    setFilters(newFilters);
    setPage(0);
    void loadData(0);
  }

  function clearFilters() {
    setFilters({ crypto: null, interval: null, outcome: null, from: '', to: '' });
    setPage(0);
    void loadData(0);
  }

  function goToPage(nextPage: number) {
    const maxPage = Math.max(0, Math.ceil(total() / ALGO_DATA_PAGE_SIZE) - 1);
    const clamped = Math.max(0, Math.min(nextPage, maxPage));
    setPage(clamped);
    void loadData(clamped);
  }

  onMount(() => {
    void loadData(0);
  });

  return {
    items,
    total,
    page,
    pageCount,
    loading,
    error,
    filters,
    filterOptions,
    refresh,
    applyFilters,
    clearFilters,
    goToPage,
  };
}
```

**Step 2: Verify compiles**

Run: `npx tsc --noEmit --project packages/frontend/tsconfig.json 2>&1 | grep useCryptoAlgoData`
Expected: no output.

---

### Task 6: Frontend — Filter bar component

**Objective:** Dynamic filter bar with crypto, interval, outcome selects (options from DB), date range, clear button.

**Files:**
- Create: `packages/frontend/src/components/CryptoAlgoDataFilters.tsx`

**Step 1: Write the component**

```tsx
// packages/frontend/src/components/CryptoAlgoDataFilters.tsx
import { For, Show } from 'solid-js';
import type { AlgoDataFilterOptions, AlgoDataFilters } from '../hooks/useCryptoAlgoData';

interface Props {
  filters: AlgoDataFilters;
  filterOptions: AlgoDataFilterOptions;
  onApply: (filters: AlgoDataFilters) => void;
  onClear: () => void;
}

export function CryptoAlgoDataFilters(props: Props) {
  const hasActiveFilters = () => {
    const f = props.filters;
    return (
      f.crypto !== null ||
      f.interval !== null ||
      f.outcome !== null ||
      f.from !== '' ||
      f.to !== ''
    );
  };

  return (
    <div class="algo-data-filters">
      {/* Crypto select — populated from DB distinct values */}
      <label class="algo-data-filter">
        <span class="algo-data-filter-label">Crypto</span>
        <select
          class="input input-sm"
          value={props.filters.crypto ?? 'all'}
          onChange={(e) =>
            props.onApply({
              ...props.filters,
              crypto: e.currentTarget.value === 'all' ? null : e.currentTarget.value,
            })
          }
        >
          <option value="all">Toutes</option>
          <For each={props.filterOptions.cryptoSymbols}>
            {(symbol) => <option value={symbol}>{symbol}</option>}
          </For>
        </select>
      </label>

      {/* Interval select — populated from DB distinct values */}
      <label class="algo-data-filter">
        <span class="algo-data-filter-label">Intervalle</span>
        <select
          class="input input-sm"
          value={props.filters.interval ?? 'all'}
          onChange={(e) =>
            props.onApply({
              ...props.filters,
              interval: e.currentTarget.value === 'all' ? null : e.currentTarget.value,
            })
          }
        >
          <option value="all">Tous</option>
          <For each={props.filterOptions.intervals}>
            {(interval) => <option value={interval}>{interval}</option>}
          </For>
        </select>
      </label>

      {/* Outcome select — up / down / all */}
      <label class="algo-data-filter">
        <span class="algo-data-filter-label">Résultat</span>
        <select
          class="input input-sm"
          value={props.filters.outcome ?? 'all'}
          onChange={(e) =>
            props.onApply({
              ...props.filters,
              outcome: e.currentTarget.value === 'all' ? null : e.currentTarget.value,
            })
          }
        >
          <option value="all">Tous</option>
          <For each={props.filterOptions.winningOutcomes}>
            {(outcome) => (
              <option value={outcome}>
                {outcome === 'up' ? 'Marché UP' : outcome === 'down' ? 'Marché DOWN' : outcome}
              </option>
            )}
          </For>
        </select>
      </label>

      {/* Date range — from */}
      <label class="algo-data-filter">
        <span class="algo-data-filter-label">Du</span>
        <input
          class="input input-sm"
          type="datetime-local"
          value={props.filters.from}
          onInput={(e) =>
            props.onApply({ ...props.filters, from: e.currentTarget.value })
          }
        />
      </label>

      {/* Date range — to */}
      <label class="algo-data-filter">
        <span class="algo-data-filter-label">Au</span>
        <input
          class="input input-sm"
          type="datetime-local"
          value={props.filters.to}
          onInput={(e) =>
            props.onApply({ ...props.filters, to: e.currentTarget.value })
          }
        />
      </label>

      {/* Clear button */}
      <Show when={hasActiveFilters()}>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => props.onClear()}
        >
          Effacer les filtres
        </button>
      </Show>
    </div>
  );
}
```

**Step 2: Verify compiles**

Run: `npx tsc --noEmit --project packages/frontend/tsconfig.json 2>&1 | grep CryptoAlgoDataFilters`
Expected: no output.

---

### Task 7: Frontend — Data table component

**Objective:** Paginated table displaying the filtered surveillance snapshots.

**Files:**
- Create: `packages/frontend/src/components/CryptoAlgoDataTable.tsx`

**Step 1: Write the component**

```tsx
// packages/frontend/src/components/CryptoAlgoDataTable.tsx
import { For, Show } from 'solid-js';
import type { AlgoDataSnapshotDto } from '../hooks/useCryptoAlgoData';

interface Props {
  items: AlgoDataSnapshotDto[];
  total: number;
  page: number;
  pageCount: number;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
}

function formatPrice(price: number | null): string {
  if (price == null) return '—';
  return (price * 100).toFixed(1) + '¢';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function outcomeLabel(outcome: string | null): string {
  if (outcome === 'up') return 'UP';
  if (outcome === 'down') return 'DOWN';
  return '—';
}

function outcomeClass(outcome: string | null): string {
  if (outcome === 'up') return 'algo-outcome-up';
  if (outcome === 'down') return 'algo-outcome-down';
  return 'algo-outcome-neutral';
}

export function CryptoAlgoDataTable(props: Props) {
  return (
    <div class="algo-data-table-wrapper">
      <Show when={props.error}>
        <div class="algo-data-error">Erreur: {props.error}</div>
      </Show>

      <Show when={props.loading}>
        <div class="algo-data-loading">Chargement…</div>
      </Show>

      <Show when={!props.loading && props.items.length === 0}>
        <div class="algo-empty">Aucune donnée en base. Les fenêtres de marché apparaîtront ici une fois capturées.</div>
      </Show>

      <Show when={!props.loading && props.items.length > 0}>
        <div class="algo-data-table-scroll">
          <table class="algo-data-table">
            <thead>
              <tr>
                <th>Crypto</th>
                <th>Intervalle</th>
                <th>Début</th>
                <th>Fin</th>
                <th>Open UP</th>
                <th>Open DOWN</th>
                <th>Close UP</th>
                <th>Close DOWN</th>
                <th>Résultat</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(row) => (
                  <tr>
                    <td class="algo-cell-crypto">{row.cryptoSymbol ?? '—'}</td>
                    <td>{row.interval ?? '—'}</td>
                    <td class="algo-cell-date">{formatDate(row.marketStartAt)}</td>
                    <td class="algo-cell-date">{formatDate(row.marketEndAt)}</td>
                    <td class="algo-cell-price">{formatPrice(row.openUpPrice)}</td>
                    <td class="algo-cell-price">{formatPrice(row.openDownPrice)}</td>
                    <td class="algo-cell-price">{formatPrice(row.closeUpPrice)}</td>
                    <td class="algo-cell-price">{formatPrice(row.closeDownPrice)}</td>
                    <td class={`algo-cell-outcome ${outcomeClass(row.winningOutcome)}`}>
                      {outcomeLabel(row.winningOutcome)}
                    </td>
                    <td>
                      <Show when={row.unresolvedAt}>
                        <span class="badge badge-warning">Non résolu</span>
                      </Show>
                      <Show when={!row.unresolvedAt && row.closeCapturedAt}>
                        <span class="badge badge-success">Clôturé</span>
                      </Show>
                      <Show when={!row.unresolvedAt && !row.closeCapturedAt && row.openCapturedAt}>
                        <span class="badge badge-info">En cours</span>
                      </Show>
                      <Show when={!row.unresolvedAt && !row.closeCapturedAt && !row.openCapturedAt}>
                        <span class="badge">—</span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div class="algo-data-pagination">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={props.page === 0}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            ← Précédent
          </button>
          <span class="algo-pagination-info">
            {props.page + 1} / {props.pageCount} ({props.total} entrées)
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={props.page >= props.pageCount - 1}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            Suivant →
          </button>
        </div>
      </Show>
    </div>
  );
}
```

**Step 2: Verify compiles**

Run: `npx tsc --noEmit --project packages/frontend/tsconfig.json 2>&1 | grep CryptoAlgoDataTable`
Expected: no output.

---

### Task 8: Frontend — ERD schema component

**Objective:** ERD-style display of the 4 algo tables with their columns, types, and descriptions (Section 2).

**Files:**
- Create: `packages/frontend/src/components/CryptoAlgoSchemaERD.tsx`

**Step 1: Write the component**

```tsx
// packages/frontend/src/components/CryptoAlgoSchemaERD.tsx
import { For, Show } from 'solid-js';
import { ALGO_ERD_TABLES, type ErdTable } from '../lib/algo-data-erd';

function ErdTableSection(props: { table: ErdTable }) {
  return (
    <div class="algo-erd-table">
      <div class="algo-erd-table-header">
        <span class="algo-erd-entity">{props.table.entity}</span>
        <span class="algo-erd-table-name">{props.table.table}</span>
      </div>
      <table class="algo-erd-columns">
        <thead>
          <tr>
            <th>Colonne</th>
            <th>Type</th>
            <th>Null</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.table.columns}>
            {(col) => (
              <tr>
                <td class="algo-erd-col-name">
                  <code>{col.name}</code>
                </td>
                <td class="algo-erd-col-type">
                  <code>{col.type}</code>
                </td>
                <td class="algo-erd-col-null">
                  <Show when={col.nullable} fallback={<span class="badge badge-success">NOT NULL</span>}>
                    <span class="badge">NULL</span>
                  </Show>
                </td>
                <td class="algo-erd-col-desc">{col.description}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export function CryptoAlgoSchemaERD() {
  return (
    <section class="algo-panel algo-panel-full">
      <div class="algo-panel-header">
        <h2 class="algo-panel-title">
          <Icon name="database" />
          Schéma des tables de données
        </h2>
        <span class="algo-panel-count">{ALGO_ERD_TABLES.length} tables</span>
      </div>
      <p class="algo-erd-intro">
        Structure des tables PostgreSQL utilisées par le module crypto-algo.
        Ces tables stockent les données de marchés binaires Up/Down Polymarket.
      </p>
      <div class="algo-erd-grid">
        <For each={ALGO_ERD_TABLES}>
          {(table) => <ErdTableSection table={table} />}
        </For>
      </div>
    </section>
  );
}
```

> **Pitfall:** The `Icon` component is used above — make sure to add `import { Icon } from './Icon';` at the top of the file.

---

### Task 9: Frontend — Main data tab component

**Objective:** Compose the filter bar + data table (Section 1) and ERD schema (Section 2) into the "Données" tab.

**Files:**
- Create: `packages/frontend/src/components/CryptoAlgoDataTab.tsx`

**Step 1: Write the component**

```tsx
// packages/frontend/src/components/CryptoAlgoDataTab.tsx
import { useCryptoAlgoData } from '../hooks/useCryptoAlgoData';
import { CryptoAlgoDataFilters } from './CryptoAlgoDataFilters';
import { CryptoAlgoDataTable } from './CryptoAlgoDataTable';
import { CryptoAlgoSchemaERD } from './CryptoAlgoSchemaERD';

export function CryptoAlgoDataTab() {
  const data = useCryptoAlgoData();

  return (
    <div class="crypto-algo-data-tab">
      {/* Section 1: Data table with dynamic filters */}
      <section class="algo-panel algo-panel-full">
        <div class="algo-panel-header">
          <h2 class="algo-panel-title">
            Données crypto enregistrées
          </h2>
          <span class="algo-panel-count">{data.total()} fenêtres</span>
        </div>
        <CryptoAlgoDataFilters
          filters={data.filters()}
          filterOptions={data.filterOptions()}
          onApply={data.applyFilters}
          onClear={data.clearFilters}
        />
        <CryptoAlgoDataTable
          items={data.items()}
          total={data.total()}
          page={data.page()}
          pageCount={data.pageCount()}
          loading={data.loading()}
          error={data.error()}
          onPageChange={data.goToPage}
        />
      </section>

      {/* Section 2: ERD-style schema reference */}
      <CryptoAlgoSchemaERD />
    </div>
  );
}
```

---

### Task 10: Frontend — Tab system in `CryptoAlgoPage.tsx`

**Objective:** Add the Dashboard / Données tab switcher to the Crypto Algo page, keeping all existing content under "Dashboard".

**Files:**
- Modify: `packages/frontend/src/components/CryptoAlgoPage.tsx`

**Step 1: Add tab system**

At the top of `CryptoAlgoPage.tsx`, add imports:

```typescript
import { For, Show } from 'solid-js';
import {
  CRYPTO_ALGO_PAGE_TABS,
  type CryptoAlgoPageTab,
  UI_KEYS,
  usePersistedEnum,
} from '../lib/ui-persistence';
import { CryptoAlgoDataTab } from './CryptoAlgoDataTab';
```

Inside `CryptoAlgoPage` function, add the tab signal after the existing hooks:

```typescript
const [tab, setTab] = usePersistedEnum(
  UI_KEYS.cryptoAlgoTab,
  'dashboard',
  CRYPTO_ALGO_PAGE_TABS,
);

const TAB_LABELS: Record<CryptoAlgoPageTab, string> = {
  dashboard: 'Dashboard',
  data: 'Données',
};
```

In the JSX return, wrap the existing content in a `<Show when={tab() === 'dashboard'}>` block, and add the tab bar + "Données" tab:

```tsx
return (
  <div class="crypto-algo-page-v2">
    <CryptoAlgoHeader ... />

    {/* Tab bar */}
    <div class="panel-tabs crypto-algo-page-tabs">
      <For each={[...CRYPTO_ALGO_PAGE_TABS]}>
        {(id) => (
          <button
            type="button"
            class={`panel-tab ${tab() === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        )}
      </For>
    </div>

    <Show when={tab() === 'dashboard'}>
      <CryptoAlgoCapitalDashboard ... />
      <div class="algo-two-col">
        <CryptoAlgoLiveMarketsPanel ... />
        <CryptoAlgoFutureMarketsPanel ... />
      </div>
      <CryptoAlgoInactiveMarketsPanel ... />
      <CryptoAlgoSurveillancePanel ... />
      <CryptoAlgoExecutionsPanel ... />
      <CryptoAlgoPositionsPanel ... />
    </Show>

    <Show when={tab() === 'data'}>
      <CryptoAlgoDataTab />
    </Show>
  </div>
);
```

> **Note:** The existing poll interval in `onMount` should remain — it refreshes the dashboard data. The data tab has its own `onMount` via `useCryptoAlgoData`. No conflict.

---

### Task 11: Frontend API cache configuration

**Objective:** Add the new `/algo/data` route to the API cache exclusion list (it's time-sensitive data) and the TTL config.

**Files:**
- Modify: `packages/frontend/src/api.ts`

**Step 1: Update `shouldUseGetCache`**

In `shouldUseGetCache` (line 17-28), add the exclusion:

```typescript
function shouldUseGetCache(path: string): boolean {
  return (
    !path.startsWith('/algo/markets-prices') &&
    !path.startsWith('/algo/market-chart') &&
    !path.startsWith('/market-chart') &&
    !path.startsWith('/sim-execution-stats') &&
    !path.startsWith('/algo/worker-queue-status') &&
    !path.startsWith('/system/overview') &&
    !path.startsWith('/system/crypto-algo-monitor') &&
    !path.startsWith('/algo/data')           // <-- NEW
  );
}
```

**Step 2: Update `getCacheTtl`**

In `getCacheTtl` (line 30-49), add to the dynamic TTL block:

```typescript
  if (
    path.startsWith('/copied-positions') ||
    path.startsWith('/simulation-balance') ||
    // ... existing entries ...
    path.startsWith('/algo/worker-queue-status') ||
    path.startsWith('/algo/data')              // <-- NEW
  ) {
    return CACHE_TTL_DYNAMIC;
  }
```

---

### Task 12: CSS styles

**Objective:** Add styles for the filter bar, data table, ERD tables, and tab bar.

**Files:**
- Modify: `packages/frontend/src/styles.css` (append at end)

**Step 1: Add CSS**

Append the following styles at the end of `styles.css`:

```css
/* === Crypto Algo Data Tab === */
.crypto-algo-page-tabs {
  margin-bottom: 1rem;
}

.algo-data-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.algo-data-filter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.algo-data-filter-label {
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.algo-data-table-wrapper {
  overflow: visible;
}

.algo-data-table-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.algo-data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.algo-data-table th {
  text-align: left;
  padding: 0.5rem 0.75rem;
  background: var(--surface-elevated);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

.algo-data-table td {
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.algo-data-table tbody tr:hover {
  background: var(--surface-elevated);
}

.algo-cell-crypto { font-weight: 600; }
.algo-cell-date { color: var(--muted); font-size: 0.8rem; }
.algo-cell-price { font-variant-numeric: tabular-nums; }
.algo-cell-outcome { font-weight: 600; text-align: center; }
.algo-outcome-up { color: var(--success); }
.algo-outcome-down { color: var(--danger); }
.algo-outcome-neutral { color: var(--muted); }

.algo-data-pagination {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0;
  justify-content: center;
}

.algo-pagination-info {
  color: var(--muted);
  font-size: 0.85rem;
}

.algo-data-error {
  color: var(--danger);
  padding: 0.75rem;
  background: var(--danger-bg);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.algo-data-loading {
  color: var(--muted);
  padding: 1rem;
  text-align: center;
}

/* ERD section */
.algo-erd-intro {
  color: var(--muted);
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.algo-erd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 1rem;
}

.algo-erd-table {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.algo-erd-table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: var(--surface-elevated);
  border-bottom: 1px solid var(--border);
}

.algo-erd-entity { font-weight: 600; }
.algo-erd-table-name { color: var(--muted); font-family: var(--font-mono, monospace); font-size: 0.8rem; }

.algo-erd-columns {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.algo-erd-columns th {
  text-align: left;
  padding: 0.4rem 0.5rem;
  color: var(--muted);
  font-size: 0.7rem;
  text-transform: uppercase;
  border-bottom: 1px solid var(--border);
}

.algo-erd-columns td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.algo-erd-col-name code,
.algo-erd-col-type code {
  font-size: 0.75rem;
}

.algo-erd-col-desc {
  color: var(--muted);
  font-size: 0.75rem;
}

.algo-erd-col-null { text-align: center; }
```

---

### Task 13: Documentation updates

**Objective:** Update `docs/api.md` and `docs/frontend.md` to reflect the new routes, tab system, and components.

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/frontend.md`

**Step 1: Update `docs/api.md` — Crypto-Algo section**

Add two rows to the Crypto-Algo routes table (after the `algo/optimize-report` row, line 213):

```markdown
| GET | `/api/algo/data` | JWT | Données crypto enregistrées (snapshots de surveillance filtrés par crypto, intervalle, outcome, plage de dates — pagination `limit` max 200, `offset`) |
| GET | `/api/algo/data/filters` | JWT | Options de filtre dynamiques (symboles crypto distincts, intervalles, outcomes) pour la barre de filtre de l'onglet Données |
```

**Step 2: Update `docs/frontend.md`**

Update the `Crypto-Algo` row in the page table (line 29) to mention the tab system:

```markdown
| **Crypto-Algo** | `CryptoAlgoPage` : onglets **Dashboard** (marchés sélectionnés par l'algo, surveillance OHLC, positions, exécutions, settings, rapport) et **Données** (`CryptoAlgoDataTab` — table des données BDD avec filtres dynamiques, ERD schéma) |
```

Add new component entries to the arborescence (after line 131, `SurveillanceHistoryCard.tsx`):

```markdown
│   ├── CryptoAlgoDataTab.tsx          onglet Données (filtres + table + ERD)
│   ├── CryptoAlgoDataFilters.tsx      barre de filtres dynamiques (crypto, intervalle, outcome, dates)
│   ├── CryptoAlgoDataTable.tsx        table paginée des snapshots de surveillance
│   ├── CryptoAlgoSchemaERD.tsx        affichage ERD des tables algo (colonnes, types, descriptions)
```

Add new hook entry (after line 157, `useCryptoAlgoSurveillance.ts`):

```markdown
│   ├── useCryptoAlgoData.ts       données crypto-algo (filtres dynamiques, pagination)
```

Add new lib entry (after line 175, `algo-surveillance`):

```markdown
                                  algo-data-erd (ERD schema constants for algo tables),
```

Update the `APP_PAGES` code block (line 14) to mention the new tab constant:

```typescript
export const APP_PAGES = ['simulation', 'real', 'leaderboard', 'markets', 'wallet', 'crypto-algo', 'system'] as const;
export const CRYPTO_ALGO_PAGE_TABS = ['dashboard', 'data'] as const;
```

---

### Task 14: Build verification

**Objective:** Verify the full build passes with all changes.

**Step 1: Build core package**

Run: `npx tsc --noEmit --project packages/core/tsconfig.json 2>&1 | grep -E "algo-data|algo-data.service"`
Expected: no output.

**Step 2: Build backend package**

Run: `npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | grep -E "algo-data|algo-data"`
Expected: no output.

**Step 3: Build frontend**

Run: `npm run build --workspace packages/frontend 2>&1 | tail -20`
Expected: build succeeds (Vite build completes without errors).

> **Pitfall:** `vite build` can hang in foreground mode. If it takes more than 60s, run with `background=true` and `notify_on_complete=true`.

**Step 4: Lint check**

Run: `npm run lint 2>&1 | grep -E "algo-data|CryptoAlgoData|useCryptoAlgoData"`
Expected: no output (no new lint errors in new files).

---

## Verification Checklist

- [ ] No new entity or migration needed (confirmed: all 4 tables already exist and are registered in `data-source.ts`)
- [ ] Backend route uses `requireJwt` (consistent with all algo routes)
- [ ] Backend route registered in `index.ts` with `jwtLimiter`
- [ ] Import uses `.js` extension (ESM convention)
- [ ] Service exported from `packages/core/src/services/index.ts`
- [ ] Types exported from `packages/core/src/lib/algo-data.types.ts`
- [ ] Frontend `api.ts` cache updated for `/algo/data`
- [ ] `ui-persistence.ts` updated with `CryptoAlgoPageTab` type and `CRYPTO_ALGO_PAGE_TABS`
- [ ] `CryptoAlgoPage.tsx` renders tab bar + Dashboard/Données switch
- [ ] Filter bar is dynamic (options come from DB distinct values via `/api/algo/data/filters`)
- [ ] Table is paginated (25 rows/page, max 200 per API call)
- [ ] ERD section shows all 4 algo tables with column metadata
- [ ] CSS appended to `styles.css` (not a new file)
- [ ] `docs/api.md` updated with 2 new route rows
- [ ] `docs/frontend.md` updated with tab system + new components
- [ ] Build passes (`npm run build`)
- [ ] Lint passes for new files
- [ ] No `safeInterval` needed (no worker timers in this feature)
- [ ] No shutdown lifecycle needed (read-only feature, no timers)

## Risks & Tradeoffs

1. **Filter options in every response** — `listFiltered` returns `filters` (distinct values) on every call, not just the first. This adds a small overhead (3 lightweight DISTINCT queries) to each paginated request. Alternative: separate `/filters` endpoint only. Tradeoff: extra round-trip vs slight overhead. The `/filters` endpoint exists for manual refresh but the combined response avoids a flash of empty filter bar on initial load.

2. **ERD is static** — The ERD schema is hardcoded in `algo-data-erd.ts` rather than queried from `information_schema`. This is intentional: the schema changes only via migrations, and a runtime query would add latency + coupling. If a migration adds columns, the ERD constant must be updated manually.

3. **`algo_price_ticks` not in the data table** — The high-frequency tick table (1 row/second/market) is too verbose for a paginated table browser. It's included in the ERD section for reference, but the data table focuses on `algo_surveillance_snapshots` (one row per market window). If the user wants tick-level browsing later, a separate "tick viewer" with per-conditionId drill-down would be more appropriate.

4. **No WebSocket updates** — The data tab is a snapshot browser, not a live feed. It loads on mount and on filter change. No WebSocket subscription is needed — the surveillance data is historical (market windows that have opened/closed).
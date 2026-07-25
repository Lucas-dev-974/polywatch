# PATCH — Enregistrement des ticks de marché par conditionId (non-crypto)

**Date :** 2026-07-06
**Version cible :** Polywatch v1.1
**Auteur :** Audit architecture — analyse du flux de données marché
**Statut :** ✅ Implémenté (2026-07-06)

---

## 1. Résumé

Créer un nouveau système d'enregistrement des ticks de marché pour les positions **non-crypto**, calqué sur `AlgoPriceTick` (crypto). L'objectif est de remplacer le modèle actuel défectueux (`MarketPositionTick` par `copiedPositionId`) par un modèle **par `conditionId`**, **timer-based**, **indépendant des positions**.

Le `MarketPositionTick` existant est **conservé** pour le suivi individuel de position (PnL, évolution par position). Le nouveau système est **additif**.

---

## 2. Modifications détaillées

### 2.1 Nouvelle entité : `MarketPriceTick`

**Fichier :** `packages/core/src/entities/MarketPriceTick.ts`

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Tick persisted on a timer (1s) for every tracked market, regardless of open positions. */
@Entity('market_price_ticks')
@Index(['conditionId', 'recordedAt'])
@Index(['recordedAt'])
export class MarketPriceTick {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'condition_id' })
  conditionId!: string;

  @Column({ type: 'text', name: 'asset_id', nullable: true })
  assetId!: string | null;

  @Column({ type: 'real', name: 'best_bid', nullable: true })
  bestBid!: number | null;

  @Column({ type: 'real', name: 'best_ask', nullable: true })
  bestAsk!: number | null;

  @Column({ type: 'real', name: 'mid_price', nullable: true })
  midPrice!: number | null;

  @Column({ type: 'real', name: 'spread', nullable: true })
  spread!: number | null;

  @Column({ type: 'real', name: 'spread_percent', nullable: true })
  spreadPercent!: number | null;

  @Column({ type: 'real', name: 'executable_bid_vwap', nullable: true })
  executableBidVwap!: number | null;

  @Column({ type: 'real', name: 'executable_ask_vwap', nullable: true })
  executableAskVwap!: number | null;

  @Column({ type: 'real', name: 'last_trade_price', nullable: true })
  lastTradePrice!: number | null;

  @Column({ type: 'timestamp', name: 'recorded_at' })
  recordedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
```

**Justification :**
- Pas de `copiedPositionId` → 1 ligne = 1 tick pour 1 marché, point
- `assetId` nullable car certains contextes peuvent ne pas l'avoir
- Tous les champs prix sont nullables (marché vide = tick quand même, avec des nulls)
- `recordedAt` explicite (pas `@CreateDateColumn`) pour contrôler précisément le timestamp

---

### 2.2 Migration TypeORM

**Fichier :** `packages/core/src/migrations/CreateMarketPriceTicks1700000000027.ts`

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketPriceTicks1700000000027 implements MigrationInterface {
  name = 'CreateMarketPriceTicks1700000000027';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE market_price_ticks (
        id SERIAL PRIMARY KEY,
        condition_id TEXT NOT NULL,
        asset_id TEXT,
        best_bid REAL,
        best_ask REAL,
        mid_price REAL,
        spread REAL,
        spread_percent REAL,
        executable_bid_vwap REAL,
        executable_ask_vwap REAL,
        last_trade_price REAL,
        recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE INDEX idx_market_price_ticks_condition_recorded
        ON market_price_ticks (condition_id, recorded_at);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_market_price_ticks_recorded
        ON market_price_ticks (recorded_at);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS market_price_ticks;`);
  }
}
```

---

### 2.3 Nouveau service : `MarketPriceTickService`

**Fichier :** `packages/core/src/services/market-price-tick.service.ts`

```typescript
import type { DataSource } from 'typeorm';
import pino from 'pino';
import { MarketPriceTick } from '../entities/MarketPriceTick.js';

const log = pino({ name: 'market-price-tick' });

export interface MarketPriceTickRecordInput {
  conditionId: string;
  assetId?: string | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  midPrice?: number | null;
  spread?: number | null;
  spreadPercent?: number | null;
  executableBidVwap?: number | null;
  executableAskVwap?: number | null;
  lastTradePrice?: number | null;
}

export interface MarketPriceTickDto {
  conditionId: string;
  assetId: string | null;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  executableBidVwap: number | null;
  executableAskVwap: number | null;
  lastTradePrice: number | null;
  recordedAt: string;
}

function toDto(row: MarketPriceTick): MarketPriceTickDto {
  return {
    conditionId: row.conditionId,
    assetId: row.assetId,
    bestBid: row.bestBid,
    bestAsk: row.bestAsk,
    midPrice: row.midPrice,
    spread: row.spread,
    spreadPercent: row.spreadPercent,
    executableBidVwap: row.executableBidVwap,
    executableAskVwap: row.executableAskVwap,
    lastTradePrice: row.lastTradePrice,
    recordedAt:
      row.recordedAt instanceof Date
        ? row.recordedAt.toISOString()
        : new Date(row.recordedAt).toISOString(),
  };
}

export class MarketPriceTickService {
  constructor(private readonly ds: DataSource) {}

  private repo() {
    return this.ds.getRepository(MarketPriceTick);
  }

  async recordTick(input: MarketPriceTickRecordInput): Promise<void> {
    try {
      const row = this.repo().create({
        conditionId: input.conditionId,
        assetId: input.assetId ?? null,
        bestBid: input.bestBid ?? null,
        bestAsk: input.bestAsk ?? null,
        midPrice: input.midPrice ?? null,
        spread: input.spread ?? null,
        spreadPercent: input.spreadPercent ?? null,
        executableBidVwap: input.executableBidVwap ?? null,
        executableAskVwap: input.executableAskVwap ?? null,
        lastTradePrice: input.lastTradePrice ?? null,
        recordedAt: new Date(),
      });
      await this.repo().save(row);
    } catch (err) {
      log.warn({ err, conditionId: input.conditionId }, 'failed to record market price tick');
    }
  }

  async listTicks(
    conditionId: string,
    options?: { from?: Date; to?: Date; limit?: number },
  ): Promise<MarketPriceTickDto[]> {
    const limit = Math.max(1, Math.min(options?.limit ?? 5000, 10000));
    const qb = this.repo()
      .createQueryBuilder('t')
      .where('t.condition_id = :conditionId', { conditionId })
      .orderBy('t.recorded_at', 'ASC')
      .take(limit);

    if (options?.from) {
      qb.andWhere('t.recorded_at >= :from', { from: options.from });
    }
    if (options?.to) {
      qb.andWhere('t.recorded_at <= :to', { to: options.to });
    }

    const rows = await qb.getMany();
    return rows.map(toDto);
  }

  async deleteOlderThan(maxAgeMs: number): Promise<number> {
    const deadline = new Date(Date.now() - maxAgeMs);
    const result = await this.repo()
      .createQueryBuilder()
      .delete()
      .where('recorded_at < :deadline', { deadline })
      .execute();
    return result.affected ?? 0;
  }
}
```

**Justification :** Calqué sur `AlgoPriceTickService` pour une interface cohérente. Mêmes signatures, mêmes limites.

---

### 2.4 Export dans l'index

**Fichier :** `packages/core/src/services/index.ts`

Ajouter :
```typescript
export { MarketPriceTickService } from './market-price-tick.service.js';
export type { MarketPriceTickRecordInput, MarketPriceTickDto } from './market-price-tick.service.js';
```

**Fichier :** `packages/core/src/entities/index.ts`

Ajouter :
```typescript
export { MarketPriceTick } from './MarketPriceTick.js';
```

---

### 2.5 Nouveau recorder : `MarketPriceTickRecorder`

**Fichier :** `packages/worker/src/processors/market-tracking/market-price-tick-recorder.ts`

```typescript
import pino from 'pino';
import type { PolymarketConnectionManager } from '../../polymarket/connection-manager.js';
import type { OpenPositionTracker } from './open-position-tracker.js';
import { MarketPriceTickService, type MarketPriceTickRecordInput } from '@polywatch/core';

const log = pino({ name: 'market-price-tick-recorder' });

/**
 * Timer-based recorder that persists market price ticks for ALL tracked markets
 * (not just those with open positions), at a fixed interval (default 1s).
 *
 * This is the non-crypto equivalent of the crypto-algo PriceTickRecorder.
 */
export class MarketPriceTickRecorder {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly connectionManager: PolymarketConnectionManager,
    private readonly tracker: OpenPositionTracker,
    private readonly tickService: MarketPriceTickService,
    intervalMs = 1_000,
  ) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    log.info({ intervalMs: this.intervalMs }, 'market price tick recorder started');
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('market price tick recorder stopped');
    }
  }

  private async tick(): Promise<void> {
    try {
      const assetIds = this.tracker.getAllTrackedAssetIds();
      if (assetIds.length === 0) return;

      const rows: MarketPriceTickRecordInput[] = [];

      for (const assetId of assetIds) {
        const positions = this.tracker.getPositions(assetId);
        if (positions.length === 0) continue;

        const conditionId = positions[0]!.conditionId;
        const metrics = this.connectionManager.getMetricsCache().get(assetId);
        if (!metrics) continue;

        const bestBid = metrics.bestBid ?? null;
        const bestAsk = metrics.bestAsk ?? null;
        const midPrice =
          bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
        const spread =
          bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
        const spreadPercent =
          midPrice != null && midPrice > 0 && spread != null
            ? spread / midPrice
            : null;

        rows.push({
          conditionId,
          assetId,
          bestBid,
          bestAsk,
          midPrice,
          spread,
          spreadPercent,
          executableBidVwap: metrics.bestBid ?? null,
          executableAskVwap: metrics.bestAsk ?? null,
          lastTradePrice: metrics.lastTradePrice ?? null,
        });
      }

      if (rows.length > 0) {
        for (const row of rows) {
          await this.tickService.recordTick(row);
        }
      }
    } catch (err) {
      log.warn({ err }, 'market price tick cycle failed');
    }
  }
}
```

**Note :** Ce recorder utilise `OpenPositionTracker` pour connaître les assetIds suivis. Si à l'avenir on veut tracker des marchés sans position ouverte (watchlist), il faudra une source de "marchés suivis" plus large.

---

### 2.6 Nouvelle route backend

**Fichier :** `packages/backend/src/routes/market-chart.ts`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import type { DataSource } from 'typeorm';
import { MarketPriceTickService } from '@polywatch/core';
import { requireJwt } from '../middleware/auth.js';
import { CONDITION_ID_PATTERN } from '../lib/condition-id.js';

const conditionIdSchema = z.string().regex(CONDITION_ID_PATTERN);

export interface MarketChartPoint {
  t: number;
  bestBid: number | null;
  bestAsk: number | null;
  midPrice: number | null;
  spread: number | null;
  spreadPercent: number | null;
  lastTradePrice: number | null;
}

export interface MarketChartResponse {
  conditionId: string;
  points: MarketChartPoint[];
}

export function createMarketChartRouter(ds: DataSource): Router {
  const router = Router();
  const service = new MarketPriceTickService(ds);

  router.get('/:conditionId', requireJwt, async (req, res) => {
    const parsedId = conditionIdSchema.safeParse(req.params.conditionId);
    if (!parsedId.success) {
      res.status(400).json({ error: 'invalid_condition_id' });
      return;
    }

    const ticks = await service.listTicks(parsedId.data);
    const points: MarketChartPoint[] = ticks.map((t) => ({
      t: Date.parse(t.recordedAt),
      bestBid: t.bestBid,
      bestAsk: t.bestAsk,
      midPrice: t.midPrice,
      spread: t.spread,
      spreadPercent: t.spreadPercent,
      lastTradePrice: t.lastTradePrice,
    }));

    res.json({ conditionId: parsedId.data, points } satisfies MarketChartResponse);
  });

  return router;
}
```

**Montage dans `backend/src/index.ts` :**
```typescript
app.use('/api/market-chart', jwtLimiter, createMarketChartRouter(ds));
```

---

### 2.7 Frontend : étendre `positionToMarketChartContext`

**Fichier :** `packages/frontend/src/lib/position-market-chart.ts`

Le filtre `isUpDownCryptoMarket()` est **conservé** mais il ne bloque plus les marchés non-crypto — il sert à détecter s'il faut extraire le symbole crypto. Toute position avec un `conditionId` non vide peut ouvrir le dialog :

```typescript
export function positionToMarketChartContext(
  pos: Position,
): MarketChartContext | null {
  if (!pos.conditionId) return null;

  // Pour les marchés crypto Up/Down : extraire symbole + intervalle
  if (isPositionUpDownMarket(pos)) {
    const parsed = parseCryptoUpDownQuestion(pos.marketQuestion);
    return {
      conditionId: pos.conditionId,
      question: pos.marketQuestion,
      cryptoSymbol: parsed?.cryptoSymbol ?? null,
      interval: normalizeInterval(parsed?.interval),
      marketStartAt: extractStartDateFromQuestion(pos.marketQuestion),
      marketEndAt: pos.marketEndDate,
    };
  }

  // Pour les marchés non-crypto : pas de symbole/intervalle
  return {
    conditionId: pos.conditionId,
    question: pos.marketQuestion,
    cryptoSymbol: null,
    interval: null,
    marketStartAt: extractStartDateFromQuestion(pos.marketQuestion),
    marketEndAt: pos.marketEndDate,
  };
}
```

**Note :** `isPositionUpDownMarket()` est conservé et exporté car le test l'utilise. La fonction `normalizeInterval()` est conservée pour transformer le placeholder `—` en `null`.

---

### 2.8 Hook frontend : `useMarketChart` avec route dédiée

**Fichier :** `packages/frontend/src/hooks/useMarketChart.ts`

Le hook prend un paramètre `isCryptoUpDown` qui détermine quelle route appeler :

```typescript
export function useMarketChart(conditionId: string, isCryptoUpDown = false) {
  // ...
  async function reload() {
    if (isCryptoUpDown) {
      // Route crypto-algo : points Up/Down avec métriques enrichies
      const data = await fetchMarketChart(conditionId);
      setPoints(data.points);
    } else {
      // Route générique : points bid/ask/mid → mapper vers UpDownPricePoint
      const data = await api<GenericMarketChartResponse>(`/market-chart/...`);
      setPoints(data.points.map((p) => ({ t: p.t, up: p.midPrice, down: null })));
    }
  }
}
```

**Fichier :** `packages/frontend/src/components/MarketChartDialog.tsx`

Le dialog détecte si le marché est crypto Up/Down via `cryptoSymbol != null` et passe le flag au hook :

```typescript
const isCryptoUpDown = () => props.cryptoSymbol != null;
const chart = useMarketChart(props.conditionId, isCryptoUpDown());
```

**Fichier :** `packages/frontend/src/lib/market-chart.ts`

Le titre par défaut est passé de `'Cours Up/Down'` à `'Cours marché'` pour les marchés non-crypto.

---

### 2.9 Worker : démarrer le recorder

**Fichier :** `packages/worker/src/index.ts`

Ajouter après l'initialisation de `MarketTickRecorder` :

```typescript
import { MarketPriceTickService, MarketPriceTickRecorder } from '@polywatch/core';

// Dans la fonction setup/start :
const marketPriceTickService = new MarketPriceTickService(ds);
const marketPriceTickRecorder = new MarketPriceTickRecorder(
  connectionManager,
  openPositionTracker,
  marketPriceTickService,
  1_000, // 1s interval
);
marketPriceTickRecorder.start();

// Dans le shutdown :
marketPriceTickRecorder.stop();
```

---

## 3. Fichiers modifiés (récapitulatif)

| # | Fichier | Type | Modification |
|---|---------|------|-------------|
| 1 | `packages/core/src/entities/MarketPriceTick.ts` | 🟢 Nouveau | Entité `market_price_ticks` |
| 2 | `packages/core/src/entities/index.ts` | 🟡 Modification | Export `MarketPriceTick` |
| 3 | `packages/core/src/migrations/CreateMarketPriceTicks1700000000027.ts` | 🟢 Nouveau | Migration |
| 4 | `packages/core/src/services/market-price-tick.service.ts` | 🟢 Nouveau | Service CRUD |
| 5 | `packages/core/src/services/index.ts` | 🟡 Modification | Export service + types |
| 6 | `packages/worker/src/processors/market-tracking/market-price-tick-recorder.ts` | 🟢 Nouveau | Recorder timer-based |
| 7 | `packages/worker/src/index.ts` | 🟡 Modification | Démarrer/arrêter recorder |
| 8 | `packages/backend/src/routes/market-chart.ts` | 🟢 Nouveau | Route `GET /api/market-chart/:conditionId` |
| 9 | `packages/backend/src/index.ts` | 🟡 Modification | Monter la route |
| 10 | `packages/frontend/src/lib/position-market-chart.ts` | 🟡 Modification | Conserver parsing crypto + autoriser non-crypto |
| 11 | `packages/frontend/src/hooks/useMarketChart.ts` | 🟡 Modification | Route dédiée + mapping midPrice→up |
| 12 | `packages/frontend/src/components/MarketChartDialog.tsx` | 🟡 Modification | Passer `isCryptoUpDown` au hook |
| 13 | `packages/frontend/src/lib/market-chart.ts` | 🟡 Modification | Titre fallback `'Cours marché'` |
| 14 | `packages/frontend/src/lib/position-market-chart.test.ts` | 🟡 Modification | Tests mis à jour pour nouveau comportement |

---

## 4. Tests & vérification

| Test | Commande | Résultat attendu |
|------|----------|------------------|
| Build core | `npm run build -w @polywatch/core` | ✅ Compile |
| Build backend | `npm run build -w @polywatch/backend` | ✅ Compile |
| Build frontend | `npm run build -w @polywatch/frontend` | ✅ Compile |
| Build worker | `npm run build -w @polywatch/worker` | ✅ Compile |
| Tests core | `npm run test -w @polywatch/core` | ✅ 411+ pass |
| Migration | `npm run migrate` | ✅ Table créée |
| Timer actif | Démarrer worker | ✅ 1 tick/s dans `market_price_ticks` |
| Route API | `GET /api/market-chart/:conditionId` | ✅ Points retournés |
| Dialog crypto | Cliquer "Cours Marché" sur position crypto | ✅ Inchangé : "BTC · 5m" avec métriques enrichies |
| Dialog sport | Cliquer "Cours Marché" sur position sport | ✅ Titre "Cours marché", courbe midPrice |

---

## 5. Risques & mitigations

| Risque | Mitigation |
|--------|-----------|
| Double écriture (MarketPositionTick + MarketPriceTick) | Assumé — les deux servent des besoins différents. Le volume est ~1 tick/s par marché, négligeable |
| `OpenPositionTracker` ne couvre que les marchés avec positions ouvertes | Pour l'instant c'est suffisant. À terme, ajouter une watchlist de marchés suivis |
| Route `/api/market-chart/` en conflit avec `/api/algo/market-chart/` | Pas de conflit — chemins différents (`/api/market-chart/` vs `/api/algo/market-chart/`) |
| Purge des vieux ticks | Ajouter un cleanup horaire (comme pour AlgoPriceTick) dans une prochaine itération |

---

## 6. Documentation à mettre à jour

- `docs/api.md` — Ajouter `GET /api/market-chart/:conditionId`
- `docs/architecture.md` — Ajouter la route et le recorder
- `docs/code/04-worker.md` — Ajouter `MarketPriceTickRecorder`
- `docs/code/05-backend.md` — Ajouter la route
- `docs/modele-donnees.md` — Ajouter l'entité `MarketPriceTick`
- `docs/v1-1/audits/2026-07-06_audit-market-tick-recorder.md` — Marquer comme résolu

---

*Patch généré suite à l'audit du 2026-07-06 — Polywatch v1.1.*

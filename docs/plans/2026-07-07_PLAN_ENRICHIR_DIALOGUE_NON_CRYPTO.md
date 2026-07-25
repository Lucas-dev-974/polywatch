# Plan: Enrichissement du dialogue de graphique pour les marchés non-crypto

## Objectif

Rendre le dialogue de graphique pour les marchés non-crypto (sport, politique, etc.) aussi complet que celui des marchés crypto, mais adapté à leur nature mono-prix (pas de dualité Up/Down).

## Etat des lieux

### Ce que le dialogue non-crypto a déjà
- Ligne de prix `midPrice` (mappée sur `up`)
- Lignes entrée/SL/TP (ajoutées récemment)
- `MarketChartMeta` avec question et fenêtre de marché

### Ce qui manque
- **Tooltip enrichi** : affiche seulement "Up: X, Down: N/A" -- pas de bid/ask/spread
- **Overlays** : bandes bid/ask, signaux, positions, price gap, illiquidité -- tous désactivés car `metrics` est absent
- **Panneau de debug** : masqué car conditionné par `isCryptoUpDown()`
- **Légende** : montre "Up" et "Down" même pour les marchés non-crypto

### Cause racine
1. La route `/api/market-chart` renvoie déjà `bestBid`, `bestAsk`, `spread`, `spreadPercent`, `lastTradePrice` dans `MarketChartPoint` -- mais le hook `useMarketChart` les jette
2. Le champ `metrics` de `UpDownPricePoint` n'est jamais peuplé pour les marchés non-crypto
3. Le `MarketChartDebugPanel` est conditionné par `isCryptoUpDown()`
4. Les labels "Up"/"Down" ne sont pas adaptés au contexte mono-prix

## Architecture de la solution

```mermaid
graph TD
    subgraph Backend
        A[GET /market-chart/:conditionId] --> B[MarketPriceTickService.listTicks]
        B --> C[MarketPriceTickDto]
        C --> D[MarketChartPoint]
    end

    subgraph Frontend
        E[useMarketChart hook] --> F{isCryptoUpDown?}
        F -- non --> G[api /market-chart]
        G --> H[Map response to UpDownPricePoint + populate metrics]
        H --> I[UpDownPricePoint[] with metrics]
        I --> J[UpDownPriceChart]
        I --> K[MarketChartDebugPanel]
        J --> L[Tooltip adapte: Prix, Spread, Dernier echange]
        J --> M[Overlays: bandes bid/ask]
        J --> N[Legende: cache Down si hasDownData==false]
        K --> O[Debug: Spread, Dernier echange, Staleness, WS healthy, Fin marche]
    end
```

## Phases d'implementation

### Phase 1: Exposer les metriques deja disponibles (frontend uniquement)

**Objectif** : Utiliser les donnees que la route renvoie deja (`bestBid`, `bestAsk`, `spread`, `spreadPercent`, `lastTradePrice`) pour peupler le champ `metrics` de `UpDownPricePoint`.

#### Fichier: `packages/frontend/src/hooks/useMarketChart.ts`

Modifier le mapping des points pour les marches non-crypto. Actuellement :

```typescript
setPoints(
  data.points.map((p) => ({
    t: p.t,
    up: p.midPrice,
    down: null,
  })),
);
```

Remplacer par :

```typescript
setPoints(
  data.points.map((p) => ({
    t: p.t,
    up: p.midPrice,
    down: null,
    metrics: {
      upBid: p.bestBid,
      upAsk: p.bestAsk,
      downBid: null,
      downAsk: null,
      upSpreadPct: p.spreadPercent,
      downSpreadPct: null,
      upAskVwap: null,
      downAskVwap: null,
      upLiquidityStatus: null,
      downLiquidityStatus: null,
      priceGap: null,
      secondsUntilEnd: null,
      bookStalenessMs: null,
      wsHealthy: null,
      upBidSize: null,
      upAskSize: null,
      downBidSize: null,
      downAskSize: null,
      upLastTradePrice: p.lastTradePrice,
      downLastTradePrice: null,
      upLastTradeSize: null,
      downLastTradeSize: null,
      upDelta1s: null,
      downDelta1s: null,
      openPositionsCount: 0,
      openExposureUsd: null,
      unrealizedPnl: null,
      lastSignalOutcome: null,
      lastSignalConfidence: null,
      lastSignalStrategyId: null,
      signalAgeMs: null,
    } satisfies AlgoPriceTickMetrics,
  })),
);
```

**Impact** : Cette seule modification active automatiquement :
- Le tooltip enrichi (bid, ask, spread, lastTradePrice)
- Les overlays (bandes bid/ask, signaux, positions, gap, illiquidite) -- mais ils seront vides car les champs correspondants sont null
- La legende avec les toggles d'overlay

### Phase 2: Adapter les composants frontend

#### Fichier: `packages/frontend/src/components/MarketChartDialog.tsx`

**2a** : Remplacer le guard `isCryptoUpDown()` par une condition basee sur la presence de points pour afficher le debug panel :

```typescript
// Avant
<Show when={isCryptoUpDown()}>
  <MarketChartDebugPanel points={chart.points()} hoverPoint={hoverPoint} />
</Show>

// Apres
<Show when={chart.points().length > 0}>
  <MarketChartDebugPanel points={chart.points()} hoverPoint={hoverPoint} />
</Show>
```

**Note** : Le `MarketChartDebugPanel` a deja son propre guard interne (`<Show when={props.points.length > 0}>`), donc ce changement est securise.

#### Fichier: `packages/frontend/src/components/UpDownPriceChart.tsx`

**2c** : Adapter la legende `UpDownChartLegend` pour masquer le swatch "Down" quand il n'y a pas de donnees down.

Ajouter `hasDownData` aux props de `UpDownChartLegend` :

```typescript
function UpDownChartLegend(props: {
  toggles: ChartOverlayToggles;
  onToggle: (key: keyof ChartOverlayToggles) => void;
  metricsAvailable: boolean;
  activeMetrics: () => AlgoPriceTickMetrics | undefined;
  hasPositionLevels: boolean;
  hasDownData: boolean;  // NOUVEAU
}) {
```

Conditionner l'affichage du swatch Down :

```typescript
// Remplacer les lignes 91-98 :
<div class="updown-chart-legend-items">
  <span class="updown-chart-legend-item">
    <span class="updown-chart-legend-swatch" style={{ background: up }} />
    Up
  </span>
  <Show when={props.hasDownData}>
    <span class="updown-chart-legend-item">
      <span class="updown-chart-legend-swatch" style={{ background: down }} />
      Down
    </span>
  </Show>
</div>
```

Calculer `hasDownData` dans `UpDownPriceChart` et le passer a la legende :

```typescript
const hasDownData = createMemo(() => props.points.some((p) => p.down != null));

// Dans le JSX, passer hasDownData a UpDownChartLegend :
<UpDownChartLegend
  toggles={toggles()}
  onToggle={toggleOverlay}
  metricsAvailable={metricsAvailable()}
  activeMetrics={activeMetrics}
  hasPositionLevels={props.positionLevels != null}
  hasDownData={hasDownData()}
/>
```

**2d** : Adapter le tooltip dans `UpDownChartSvg` pour les marches non-crypto.

Remplacer les lignes 574-575 du tooltip :

```typescript
// Avant :
<div>Up: {formatUpDownPriceCents(point().up)}</div>
<div>Down: {formatUpDownPriceCents(point().down)}</div>

// Apres :
<div>Prix: {formatUpDownPriceCents(point().up)}</div>
<Show when={point().down != null}>
  <div>Down: {formatUpDownPriceCents(point().down)}</div>
</Show>
```

**2e** : Adapter la section des metriques dans le tooltip (lignes 576-606).

Remplacer le bloc `<Show when={point().metrics}>` existant par un bloc adapte qui masque les champs non pertinents pour les marches non-crypto :

```typescript
<Show when={point().metrics}>
  {(m) => (
    <>
      <div class="updown-chart-tooltip-divider" />
      <Show when={m().downSpreadPct != null}>
        {/* Mode crypto Up/Down : afficher les deux spreads */}
        <div>Spread Up: {m().upSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
        <div>Spread Down: {m().downSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
        <div>VWAP Up: {formatUpDownPriceCents(m().upAskVwap ?? null)}</div>
        <div>Liquidite Up: {fmtLiquidityStatus(m().upLiquidityStatus)}</div>
        <div>Liquidite Down: {fmtLiquidityStatus(m().downLiquidityStatus)}</div>
        <Show when={m().upDelta1s != null}>
          <div>Delta Up 1s: {formatUpDownPriceCents(m().upDelta1s)}</div>
        </Show>
      </Show>
      <Show when={m().downSpreadPct == null && m().upSpreadPct != null}>
        {/* Mode non-crypto : affichage simplifie */}
        <div>Spread: {m().upSpreadPct?.toFixed(2) ?? 'N/A'}%</div>
        <Show when={m().upLastTradePrice != null}>
          <div>Dernier echange: {formatUpDownPriceCents(m().upLastTradePrice)}</div>
        </Show>
      </Show>
      <Show when={m().lastSignalOutcome}>
        <div>
          Signal: {m().lastSignalOutcome} (
          {((m().lastSignalConfidence ?? 0) * 100).toFixed(0)}%)
        </div>
      </Show>
    </>
  )}
</Show>
```

#### Fichier: `packages/frontend/src/components/MarketChartDebugPanel.tsx`

**2f** : Adapter le panneau de debug pour les marches non-crypto.

Modifier `executionFields` pour detecter le mode non-crypto via un prop explicite `isCryptoUpDown` (passe depuis `MarketChartDialog`) :

Ajouter `isCryptoUpDown` aux props :

```typescript
export interface MarketChartDebugPanelProps {
  points: UpDownPricePoint[];
  hoverPoint: () => UpDownPricePoint | null;
  isCryptoUpDown: boolean;  // NOUVEAU
}
```

Modifier `executionFields` :

```typescript
const executionFields = createMemo((): DebugField[] => {
  const m = metrics();
  if (!props.isCryptoUpDown) {
    // Mode non-crypto : labels adaptes, pas de dualite Up/Down
    return [
      { label: 'Spread', value: fmtDebugPct(m?.upSpreadPct), valueClass: debugSpreadValueClass(m?.upSpreadPct) },
      { label: 'Dernier echange', value: formatUpDownPriceCents(m?.upLastTradePrice ?? null) },
      { label: 'Staleness', value: fmtDebugMs(m?.bookStalenessMs) },
      { label: 'WS healthy', value: fmtDebugBool(m?.wsHealthy), valueClass: debugWsValueClass(m?.wsHealthy) },
      { label: 'Fin marche', value: fmtDebugSeconds(m?.secondsUntilEnd) },
    ];
  }
  // Mode crypto Up/Down existant (code original inchange)
  return [
    { label: 'Spread Up', value: fmtDebugPct(m?.upSpreadPct), valueClass: debugSpreadValueClass(m?.upSpreadPct) },
    { label: 'Spread Down', value: fmtDebugPct(m?.downSpreadPct), valueClass: debugSpreadValueClass(m?.downSpreadPct) },
    { label: 'VWAP ask Up', value: formatUpDownPriceCents(m?.upAskVwap ?? null) },
    { label: 'VWAP ask Down', value: formatUpDownPriceCents(m?.downAskVwap ?? null) },
    { label: 'Liquidite Up', value: fmtLiquidityStatus(m?.upLiquidityStatus) },
    { label: 'Liquidite Down', value: fmtLiquidityStatus(m?.downLiquidityStatus) },
    { label: 'Liquidite marche', value: fmtLiquidityStatus(resolveMarketLiquidityStatus(m?.upLiquidityStatus, m?.downLiquidityStatus)) },
    { label: 'Price gap', value: fmtDebugGap(m?.priceGap) },
    { label: 'Staleness', value: fmtDebugMs(m?.bookStalenessMs) },
    { label: 'WS healthy', value: fmtDebugBool(m?.wsHealthy), valueClass: debugWsValueClass(m?.wsHealthy) },
    { label: 'Fin marche', value: fmtDebugSeconds(m?.secondsUntilEnd) },
  ];
});
```

Modifier `strategyFields` pour masquer les champs non pertinents en mode non-crypto :

```typescript
const strategyFields = createMemo((): DebugField[] => {
  const m = metrics();
  const unrealizedPnl =
    m?.unrealizedPnl != null && Number.isFinite(m.unrealizedPnl)
      ? m.unrealizedPnl
      : undefined;

  if (!props.isCryptoUpDown) {
    // Mode non-crypto : seulement les champs pertinents
    return [
      { label: 'Positions ouvertes', value: String(m?.openPositionsCount ?? 0) },
      { label: 'Exposure', value: fmtDebugUsd(m?.openExposureUsd) },
      { label: 'PnL latent', value: fmtDebugUsd(m?.unrealizedPnl), valueClass: pnlClass(unrealizedPnl) },
      { label: 'Dernier signal', value: formatSignal(m) },
      { label: 'Strategie', value: m?.lastSignalStrategyId ?? DEBUG_EMPTY },
      { label: 'Age signal', value: fmtDebugMs(m?.signalAgeMs) },
    ];
  }

  // Mode crypto Up/Down existant (code original inchange)
  return [
    { label: 'Positions ouvertes', value: String(m?.openPositionsCount ?? 0) },
    { label: 'Exposure', value: fmtDebugUsd(m?.openExposureUsd) },
    { label: 'PnL latent', value: fmtDebugUsd(m?.unrealizedPnl), valueClass: pnlClass(unrealizedPnl) },
    { label: 'Dernier signal', value: formatSignal(m) },
    { label: 'Strategie', value: m?.lastSignalStrategyId ?? DEBUG_EMPTY },
    { label: 'Age signal', value: fmtDebugMs(m?.signalAgeMs) },
    { label: 'Delta Up 1s', value: m?.upDelta1s != null ? formatUpDownPriceCents(m.upDelta1s) : DEBUG_EMPTY },
    { label: 'Delta Down 1s', value: m?.downDelta1s != null ? formatUpDownPriceCents(m.downDelta1s) : DEBUG_EMPTY },
  ];
});
```

Modifier la section `summaries` pour adapter les labels en mode non-crypto :

```typescript
<Show when={summaries().avgUpSpreadPct != null || summaries().maxPriceGap != null}>
  <div class="market-chart-debug-summary">
    <Show when={props.isCryptoUpDown}>
      <span>
        Spread moy. Up: {fmtDebugPct(summaries().avgUpSpreadPct)} -- Down:{' '}
        {fmtDebugPct(summaries().avgDownSpreadPct)}
      </span>
    </Show>
    <Show when={!props.isCryptoUpDown}>
      <span>
        Spread moy.: {fmtDebugPct(summaries().avgUpSpreadPct)}
      </span>
    </Show>
    <span>Gap max: {fmtDebugGap(summaries().maxPriceGap)}</span>
  </div>
</Show>
```

#### Fichier: `packages/frontend/src/components/MarketChartDialog.tsx`

**2g** : Passer `isCryptoUpDown` a `MarketChartDebugPanel` :

```typescript
<Show when={chart.points().length > 0}>
  <MarketChartDebugPanel
    points={chart.points()}
    hoverPoint={hoverPoint}
    isCryptoUpDown={isCryptoUpDown()}
  />
</Show>
```

### Phase 3: Enrichissement backend (metriques agregees) -- DIFFERE

**Objectif** : Ajouter les metriques enrichies (positions ouvertes, PnL, signaux) pour les marches non-crypto.

Cette phase est differee car elle necessite d'identifier les services backend existants pour les positions et signaux, et de les injecter dans la route. Elle sera traitee dans un plan ulterieur.

**Ce qui est deja couvert par les Phases 1-2** :
- Les champs `openPositionsCount`, `openExposureUsd`, `unrealizedPnl`, `lastSignalOutcome`, `lastSignalConfidence`, `lastSignalStrategyId`, `signalAgeMs` sont deja dans le mapping frontend (initialises a 0 ou null)
- Le panneau de debug et le tooltip les affichent deja conditionnellement
- Quand le backend les exposera, il suffira de mettre a jour le mapping dans `useMarketChart.ts` pour les peupler

### Phase 4: Overlays adaptes

**Objectif** : Activer les overlays pertinents pour les marches non-crypto.

Les overlays suivants fonctionneront automatiquement une fois que `metrics` est peuple :
- **Bandes bid/ask** : `buildBidAskBandPath` utilise `upBid`/`upAsk` -- fonctionnera car ces champs sont peuples par la Phase 1
- **Signaux** : `findSignalMarkerIndices` utilise `signalAgeMs` -- aucun marqueur tant que le backend ne peuple pas ce champ
- **Positions** : `findPositionOpenIndices` utilise `openPositionsCount` -- aucun marqueur tant que le backend ne peuple pas ce champ
- **Price gap** : `findPriceGapIndices` utilise `priceGap` -- aucun marqueur tant que le backend ne peuple pas ce champ
- **Illiquidite** : `findIlliquidIndices` utilise `upLiquidityStatus`/`downLiquidityStatus` -- aucun marqueur tant que le backend ne peuple pas ce champ

Aucune modification des fonctions d'overlay n'est necessaire car elles tolerant les valeurs null.

## Fichiers modifies (recapitulatif)

| Fichier | Phase | Modification |
|---------|-------|-------------|
| `packages/frontend/src/hooks/useMarketChart.ts` | 1 | Mapper les donnees API vers `UpDownPricePoint.metrics` |
| `packages/frontend/src/components/MarketChartDialog.tsx` | 2a, 2g | Supprimer le guard `isCryptoUpDown()` pour le debug panel ; passer `isCryptoUpDown` en prop |
| `packages/frontend/src/components/UpDownPriceChart.tsx` | 2c, 2d, 2e | Adapter legende (swatch Down conditionnel), tooltip (labels Prix, metriques adaptees) |
| `packages/frontend/src/components/MarketChartDebugPanel.tsx` | 2f | Adapter executionFields, strategyFields, summaries pour mode non-crypto via prop `isCryptoUpDown` |

## Tests de verification

1. Ouvrir le graphique d'un marche non-crypto (sport, politique)
2. Verifier que le tooltip au survol montre : Prix, Spread, Dernier echange (pas VWAP, liquidite Up/Down, Delta Up/Down)
3. Verifier que la legende montre "Up" seulement (pas "Down")
4. Verifier que les toggles d'overlay sont visibles (Bandes bid/ask notamment)
5. Verifier que le panneau de debug s'affiche avec les champs adaptes (Spread, Dernier echange, Staleness, WS healthy, Fin marche)
6. Verifier que les graphiques crypto fonctionnent toujours (regression) : tooltip complet, legende Up+Down, debug panel complet
7. Verifier que les lignes entree/SL/TP sont toujours visibles
8. Verifier que le toggle "Entree / SL / TP" est toujours present et fonctionnel

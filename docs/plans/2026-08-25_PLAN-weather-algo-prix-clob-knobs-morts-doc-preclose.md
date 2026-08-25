# Plan — Weather algo : prix CLOB, knobs morts, doc pre-close

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟡 **En attente d'implémentation** — vague **C** du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constats couverts** : #3 (prix Gamma vs CLOB), #6 (allowedComparisons string vs tableau), #7 (knobs UI sans effet), #8 (doc pre-close vs code)

---

## 📋 Contexte

Quatre constats de l'audit concernent la qualité de la décision d'entrée et la cohérence doc/code/knobs :

- **#3** : les stratégies décident sur `outcomePrices` Gamma, mais l'entry pipeline fill sur CLOB. L'edge du signal peut avoir disparu au fill.
- **#6** : `allowedComparisons` — l'UI stocke une string (select), le runtime attend un tableau.
- **#7** : knobs UI sans effet live (`minTimeToClose`, `minBidToAskRatio`, `allowedMarketTags`, `signalScoreSizingEnabled`).
- **#8** : doc pre-close vs code — `WEATHER_PRE_CLOSE` retiré (migration `0116`) mais encore dans la doc.

**Décisions produit** : knobs morts → tout retirer du bag + UI (alléger).

> **Correction revue 2026-08-25** : `runMode` n'a **pas** `market` dans ses args (le marché est chargé dans `runWeatherEntryPipeline` via `ensureTradableMarket`, puis non passé). `WeatherPositionForecast` n'a **pas** de colonne `marketPrice`. Ne **pas** supprimer `entryDepthRetryMax` / `getWeatherEntryDepthRetryMax` (le retry profondeur s'en sert). Coercer `allowedComparisons` string→tableau dans `getStrategyParams`, pas seulement à l'enregistrement UI.

---

## Phase 1 — Ré-évaluer l'edge contre le prix CLOB avant enqueue (constat #3)

### Problème

`evaluateBucketGate` et `WeatherHighestYesStrategy` lisent `market.outcomePrices` (Gamma). L'entry pipeline (`weather-entry-pipeline.ts`) refetch un ask VWAP executable côté CLOB. Si le prix CLOB a bougé, l'edge calculé sur Gamma n'est plus valide au moment du fill.

### Patch

1. **Passer `market` de `runWeatherEntryPipeline` vers `runMode`** (déjà chargé L103 via `ensureTradableMarket`). Ne pas relire Gamma, ne pas utiliser `signal.targetDate` pour `hoursToResolution` (après le plan date-unique, `targetDate` = `dateKey` météo, pas la résolution).

2. **Ajouter la ré-évaluation après le refetch CLOB** (`fetchExecutablePrices` à `estimatedTargetQty`, ~L367) et **avant** la garde MOS / depth retry :

```ts
const clobYesPrice = askVwap;
const hoursToResolution = market.endDate
  ? Math.max(0, (new Date(market.endDate).getTime() - Date.now()) / 3_600_000)
  : DEFAULT_HOURS_TO_RESOLUTION_FALLBACK;

if (signal.strategyId !== WEATHER_HIGHEST_YES_STRATEGY_ID) {
  const clobEdge = signal.forecastProbability - clobYesPrice;
  const clobDynamicMinEdge = resolveDynamicMinEdge(
    signal.forecastStdDev,
    hoursToResolution,
    bag.minEdge,
  );
  if (clobEdge <= clobDynamicMinEdge) {
    log.warn({ conditionId: signal.conditionId, clobEdge, clobDynamicMinEdge }, 'weather entry skipped — CLOB edge below threshold');
    return 'Edge CLOB insuffisant';
  }
} else if (
  clobYesPrice < bag.minYesPrice ||
  (bag.maxYesPrice != null && clobYesPrice > bag.maxYesPrice)
) {
  return 'Prix CLOB hors plage highest-yes';
}
```

Importer `DEFAULT_HOURS_TO_RESOLUTION_FALLBACK` depuis `../constants.js` (déjà `24`).

3. **Prix CLOB et snapshot** : l'entité `WeatherPositionForecast` n'a **pas** `marketPrice`. **Ne pas** ajouter de colonne. `signal.marketPrice = clobYesPrice` en mémoire. Le fill utilise `finalAskVwap`.

4. **Mutabilité** : `runMode` sim puis real partagent le même objet `signal`. Assigner `signal.marketPrice` au premier mode OK (même ask). Ne pas muter `forecastProbability`.

### Fichiers touchés

- `packages/weather-algo/src/processors/weather-entry-pipeline.ts`
- Tests : `weather-entry-pipeline.test.ts` (cas CLOB edge < Gamma edge → skip)

### Risques

- Performance : un calcul d'edge supplémentaire (négligeable).
- Faux négatifs : si le spread CLOB est large au moment du refetch, l'ask VWAP peut être temporairement haut. Le depth retry compense déjà. Documenter que c'est une garde de sécurité, pas une garantie de fill au prix d'edge.

---

## Phase 2 — Retirer les knobs morts du bag + UI (constats #6, #7)

### Décision produit

Retirer du bag et de l'UI : `minTimeToClose`, `minBidToAskRatio`, `allowedMarketTags`, `signalScoreSizingEnabled`. Garder `allowedComparisons` (utile pour highest-yes) mais corriger le typage.

### Patch

1. **Retirer du `WeatherStrategyParamsBag`** (`strategy-catalog.ts`) :

```ts
// À SUPPRIMER du bag :
// - minTimeToClose
// - minBidToAskRatio
// - allowedMarketTags
// - signalScoreSizingEnabled
```

2. **Retirer des schemas UI** (`sharedParamsSchemas`, `highestYesParamsSchemas`) : les entries correspondantes.

3. **Retirer des consumers** :
   - `policy.ts` : `getWeatherMinBidToAskRatio` seulement. **Conserver** `getWeatherEntryDepthRetryMax` et `bag.entryDepthRetryMax` — `fetchEntryAskLiquidityWithRetries` s'en sert. Ce n'est **pas** un knob mort.
   - `weather-entry-pipeline.ts` : retirer `bag.signalScoreSizingEnabled`. `ModeSizingParams.signalScoreSizingEnabled` **reste** (crypto s'en sert) : passer **`false`** en dur. Garder `multiplier: 1`.

4. **Migration** : migration TypeORM pour retirer les clés du JSON `weatherAlgoStrategyParams` stocké. `sanitizeWeatherStrategyParams` (qui filtre sur `DEFAULT_WEATHER_STRATEGY_PARAMS`) gère déjà le retrait automatiquement (les clés absentes du bag default sont dropped). Donc pas de migration DB nécessaire — `sanitize` nettoie au prochain save.

5. **`allowedComparisons` (constat #6)** — **ne pas** convertir seulement à l'enregistrement UI :

- Le bag runtime attend `WeatherComparison[] | null`. L'UI `kind: 'select'` persiste une **string**. Des lignes déjà sauvées sont déjà des strings.
- `validateWeatherStrategyParamsUpdate` exige `typeof value === 'string'` pour un select : un tableau échouerait au PATCH.
- Le default **UI** du schéma est `'exact'`, le default **runtime** du bag est `null` (= toutes les comparaisons). Convertir le default UI en `['exact']` au save **changerait** highest-yes (toutes → exact-only) : bug fantôme.

**Patch** :
1. Dans `getStrategyParams` : si `allowedComparisons` est une string non vide → `[valeur]` ; si `''` / `null` / `[]` → `null` (toutes acceptées, rétrocompat).
2. Dans `validateWeatherStrategyParamsUpdate` : accepter string **ou** `string[]` pour cette clé.
3. UI : option « Toutes » (`null`). Ne pas traiter le default schéma `'exact'` comme default runtime. Aligner le default UI du select sur `null` / « Toutes ».

4. Tests `strategy-catalog` : `allowedComparisons: 'exact'` (string) → `['exact']` ; `null` → toutes.

5. **Ne pas** toucher `minTimeToClose` **crypto** (`crypto-algo-strategy-params.ts`) — homonyme, autre bag.

### Fichiers touchés

- `packages/core/src/weather/strategy-catalog.ts` (bag, schemas, defaults)
- `packages/core/src/risk/policy.ts` (getters à supprimer)
- `packages/weather-algo/src/processors/weather-entry-pipeline.ts` (usage signalScoreSizingEnabled)
- `packages/frontend/src/components/WeatherAlgoStrategiesTab.tsx` (allowedComparisons, knobs retirés)
- Tests : `strategy-catalog.test.ts` (sanitize, defaults)

---

## Phase 3 — Aligner la doc pre-close (constat #8)

### Problème

`WEATHER_PRE_CLOSE` a été retiré du code (migration `DropWeatherPreClose1700000000116`, `getWeatherPreCloseParams` → `false`). Mais la doc produit et la doc code le mentionnent encore comme actif.

### Patch

1. **`docs/weather-algo.md`** : retirer `WEATHER_PRE_CLOSE` de la section §3 (sorties). Documenter que les positions tiennent jusqu'à résolution / SL/TP / drift / bucket.

2. **`docs/code/08-weather-algo.md`** : idem dans la section « Sorties ». Retirer `closeBeforeResolutionHours` du pipeline entry (§ « Pipeline entry »). Retirer `WEATHER_PRE_CLOSE` de la liste des sorties.

3. **`docs/backtest.md`** : retirer la ligne `WEATHER_PRE_CLOSE` de la table des exit reasons (si présente comme actif — vérifier).

4. **`docs/architecture.md`**, **`docs/code/01-architecture.md`**, **`docs/code/04-worker.md`**, **`docs/code/09-backtest.md`**, **`docs/backtest.md`** : retirer les mentions **actives** (pipeline live). Les audits historiques dans `docs/weather-algo-audits-plans/` et `docs/audits/` **ne pas** réécrire.

5. **Type union** `WEATHER_PRE_CLOSE` conservé (`types/index.ts`, `close-signal.ts`, liste `sim-reset-redis-hygiene` WEATHER_CLOSE_DEDUPE_REASONS) — positions / jobs legacy.

### Fichiers touchés

- `docs/weather-algo.md`
- `docs/code/08-weather-algo.md`
- `docs/code/01-architecture.md`
- `docs/code/04-worker.md`
- `docs/code/09-backtest.md`
- `docs/backtest.md`
- `docs/architecture.md`

---

## Checklist de validation

### Phase 1 (prix CLOB)
- [ ] Ré-évaluation edge CLOB dans `runMode` (forecast strategies)
- [ ] Ré-évaluation prix CLOB dans `[minYesPrice, maxYesPrice]` (highest-yes)
- [ ] Test : CLOB edge < Gamma edge → skip
- [ ] `market` passé de `runWeatherEntryPipeline` → `runMode` (`hoursToResolution` via `market.endDate`)
- [ ] `signal.marketPrice` mémoire = ask CLOB ; **pas** de colonne snapshot
- [ ] `entryDepthRetryMax` **conservé**

### Phase 2 (knobs morts)
- [ ] `minTimeToClose`, `minBidToAskRatio`, `allowedMarketTags`, `signalScoreSizingEnabled` retirés du bag
- [ ] Schemas UI mis à jour
- [ ] `sanitizeWeatherStrategyParams` nettoie les clés legacy au prochain save
- [ ] `allowedComparisons` : coerce string→tableau dans `getStrategyParams` ; `null` reste « toutes »
- [ ] Tests `strategy-catalog.test.ts` mis à jour

### Phase 3 (doc pre-close)
- [ ] `weather-algo.md` : pre-close retiré
- [ ] `code/08-weather-algo.md` : pre-close retiré
- [ ] `backtest.md` / `architecture.md` / `code/01` / `code/04` / `code/09` : mentions live nettoyées
- [ ] Type `WEATHER_PRE_CLOSE` conservé (rétro-compat base)

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #3, #6, #7, #8
- Canvas : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)
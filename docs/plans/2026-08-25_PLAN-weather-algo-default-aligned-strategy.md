# Plan — Weather algo : passer `weather-forecast-aligned` en default live

**Date** : 2026-08-25
**Auteur** : Assistant IA
**Statut** : 🟡 **En attente d'implémentation** — vague **D** du [plan maître](./2026-08-25_PLAN-weather-algo-implementation-master.md)
**Référence audit** : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md)
**Constat couvert** : #2 (best-edge = long-shots)

---

## 📋 Contexte

Le default live actuel est `weather-forecast` (best-edge). `pickBestEdgeBucket` maximise `forecastProb − yesPrice`, ce qui pousse vers les paliers bon marché (long-shots, win rate bas). Déjà visible dans le PnL live historique (paliers `0.00–0.20` dominent).

**Décision produit** : passer `weather-forecast-aligned` en default live. Cette stratégie sélectionne le palier dont la fourchette contient le forecast mean (`selectForecastAlignedBucket`), puis applique les gates edge. Elle est plus directionnelle et moins exposée aux queues.

> **Revue 2026-08-25** : default **JSON vide / invalide seulement**. Pas de migration `'["weather-forecast"]'`. Pas d'inversion du catalogue (forecast reste first-wins si les deux sont cochées). Phase 2 : **aligned `minEdge` défaut `0.08`** ; forecast et highest-yes restent à `0.10`. Overlay via defaults **par stratégie** dans `getStrategyParams` (aujourd'hui un seul bag commun). Une config déjà sauvée avec `minEdge: 0.1` sur aligned **ne bouge pas**.

---

## Phase 1 — Changer le default du catalogue

### Problème

`parseWeatherAlgoStrategies` (`strategy-catalog.ts:330-345`) retourne `[WEATHER_FORECAST_STRATEGY_ID]` quand `weatherAlgoStrategies` est vide / invalide. C'est le default when no config.

### Patch

1. **Changer le default** de `parseWeatherAlgoStrategies` :

```ts
// strategy-catalog.ts
export function parseWeatherAlgoStrategies(raw: string | null | undefined): WeatherStrategyId[] {
  if (!raw || raw.trim() === '') {
    return [WEATHER_FORECAST_ALIGNED_STRATEGY_ID]; // ← CHANGÉ
  }
  // ... reste inchangé ...
}
```

2. **Ne pas migrer les configs live.** `parseWeatherAlgoStrategies` ne s'applique que si le JSON est vide / invalide. Une BDD avec `'["weather-forecast"]'` **reste sur forecast**. Pour passer en aligned : cocher aligned dans l'UI (ou vider la colonne). Documenter ça clairement dans le changelog.

3. **Ne pas inverser l'ordre du catalogue.** `getOrdered` suit `WEATHER_STRATEGY_CATALOG`. Inverser changerait silencieusement le first-wins pour tous les users qui ont déjà forecast + aligned activés. Laisser forecast en premier dans le catalogue.

### Fichiers touchés

- `packages/core/src/weather/strategy-catalog.ts` (`parseWeatherAlgoStrategies`, `getStrategyParams`, descriptions catalogue)
- Tests : `strategy-catalog.test.ts` (default JSON vide → aligned ; ordre catalogue inchangé ; aligned sans stored → minEdge 0.08 ; stored `minEdge: 0.12` gagne ; stored `minEdge: null` → **0.08** pas 0.10)

---

## Phase 2 — Différencier les gates des deux stratégies forecast

### Problème

`weather-forecast` et `weather-forecast-aligned` partagent `evaluateBucketGate` avec les mêmes gates (`minEdge`, `maxForecastStd`, `minForecastProbability`). Si les deux sont activées avec les mêmes paramètres, `weather-forecast-aligned` ne produit jamais un trade distinct (first-wins catalogue si aligned est en premier, ou l'inverse). Le constat #5 de l'audit.

### Patch

1. **Defaults différents par stratégie** — overlay dans `getStrategyParams` :

```ts
const PER_STRATEGY_DEFAULTS: Partial<Record<WeatherStrategyId, Partial<WeatherStrategyParamsBag>>> = {
  [WEATHER_FORECAST_ALIGNED_STRATEGY_ID]: { minEdge: 0.08 },
};
const catalogueAndPerStrategy = {
  ...DEFAULT_WEATHER_STRATEGY_PARAMS,
  ...PER_STRATEGY_DEFAULTS[strategyId],
};
const merged = { ...catalogueAndPerStrategy, ...stored };
// NULLABLE_ZERO puis NON_NULLABLE : restaurer depuis catalogueAndPerStrategy[key],
// PAS depuis DEFAULT seul — sinon minEdge null stocké sur aligned redevient 0.10.
```

- `weather-forecast-aligned` : `minEdge` **0.08** (le palier est déjà celui du mean ; seuil un peu plus bas).
- `weather-forecast` / `highest-yes` : `minEdge` catalogue **0.10** inchangé.
- Une ligne déjà persistée avec `minEdge` explicite **gagne** (spread `...stored` en dernier). Pas de migration JSON.

2. **Documenter** dans le catalogue : aligned = directionnel (palier du mean, minEdge 0.08) ; forecast = value-bet (max edge, minEdge 0.10, risque queue).

### Fichiers touchés

- `packages/core/src/weather/strategy-catalog.ts` (defaults per-strategy, descriptions)
- Tests : `strategy-catalog.test.ts`

### Risques

- `getStrategyParams` : overlay `PER_STRATEGY_DEFAULTS` ; `NON_NULLABLE` doit retomber sur `catalogueAndPerStrategy`, pas sur `DEFAULT` seul (sinon aligned `minEdge: null` → 0.10).

---

## Phase 3 — Validation et observation

1. **Smoke test live** : après activation de `weather-forecast-aligned` en default, observer un cycle complet (30 min). Vérifier :
   - Le signal émis porte bien le palier aligné (comparison = between, fourchette contenant le mean).
   - L'edge est positif mais potentiellement plus faible que les long-shots.
   - Pas de régression sur les positions ouvertes existantes (stratégie `weather-forecast`).

2. **Observation PnL (24-48 h)** : comparer la win rate et le PnL par palier de prix avant/après. Les paliers `0.20+` devraient dominer.

---

## Checklist de validation

- [ ] `parseWeatherAlgoStrategies` retourne `weather-forecast-aligned` par défaut (JSON vide seulement)
- [ ] Ordre du catalogue **inchangé** (forecast reste first-wins si les deux sont cochées)
- [ ] **Pas** de migration des configs `'["weather-forecast"]'` existantes
- [ ] Defaults per-strategy : aligned `minEdge` 0.08 ; forecast reste 0.10 ; stored gagne
- [ ] Tests `strategy-catalog.test.ts` mis à jour
- [ ] Smoke test live : signal aligned émis correctement
- [ ] Doc `weather-algo.md` / `code/08-weather-algo.md` : default = aligned

---

## Références

- Audit : [`docs/audits/2026-08-25_audit-weather-algo-moteur-live.md`](../audits/2026-08-25_audit-weather-algo-moteur-live.md) §4 #2, #5
- Canvas : [`weather-algo-engine-audit.canvas.tsx`](../../C:/Users/lcsystem/.cursor/projects/c-Users-lcsystem-Desktop-TradeInterface-Polytwatch-versioning-Polywatch-v1-1/canvases/weather-algo-engine-audit.canvas.tsx)
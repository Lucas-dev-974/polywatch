# Plan — Fix C7 (`proxyFallback` inutilisé) + C10 (asymétrie CDF) + C11 (tolérance `isForecastInBucket`) + C12 (clé unique upsert sans `metric`)

- **Date** : 2026-08-13
- **Statut** : proposé (non implémenté)
- **Scope** : `packages/backtest`, `packages/core`, `tools/`
- **Référence** : [`2026-08-11_audit-weather-algo-complet.md`](./2026-08-11_audit-weather-algo-complet.md)

**Objectif** : Corriger quatre constats de l'audit weather-algo restés actifs — **C10** (🔴 Critique, asymétrie de convention de bin CDF entre `or_below` et `or_above`), **C11** (🟡 Moyenne, asymétrie de tolérance dans `isForecastInBucket`), **C12** (🟡 Moyenne, index unique d'upsert sans `metric`), et **C7** (🟡 Moyenne, champ `proxyFallback` retourné mais jamais consommé).

C10 et C11 partagent le même fil conducteur : **aligner les conventions de discrétisation des buckets** (`or_below` / `or_above` / `exact` / `between`) entre la probabilité forecast-implied (CDF) et le classement d'appartenance au bucket. C12 est un durcissement de l'identité d'une ligne d'historique. C7 est un nettoyage de dead code / sémantique dans la résolution backtest.

---

## 1. Contexte et problème

### 1.1 C7 — `proxyFallback` toujours `true`, jamais consommé

`packages/backtest/src/adapters/weather/resolution.ts:23-35` retourne `proxyFallback: true` dans **les deux branches** (ligne 25 : forecast `null` ; ligne 34 : forecast présent). Le champ est déclaré dans `ResolutionResult` (ligne 15) mais **aucun consumer** ne le lit :

```15:16:packages/backtest/src/adapters/weather/resolution.ts
export interface ResolutionResult {
  winningOutcome: 'YES' | 'NO' | null;
  proxyFallback: boolean;
}
```

Le seul appelant, `weather-adapter.ts:575-588`, lit uniquement `res.winningOutcome` :

```588:595:packages/backtest/src/adapters/weather/weather-adapter.ts
if (res.winningOutcome == null) {
  this.warnOnce(
    ctx,
    'resolution_no_forecast',
    'Résolution impossible sans forecast — position laissée ouverte',
  );
  continue;
}
```

**Problème** : `proxyFallback: true` même quand le forecast est présent → le champ est **sémantiquement faux** et, de toute façon, **jamais lu**. C'est à la fois du dead code (champ inutilisé) et une information trompeuse.

### 1.2 C10 — Asymétrie de convention de bin dans les CDF (🔴 Critique)

`packages/core/src/weather/forecast-distribution.ts:49-71` :

```49:71:packages/core/src/weather/forecast-distribution.ts
export function computeCdfBelow(
  target: number,
  forecastMean: number,
  forecastStdDev: number,
): number {
  return normalCDF(target, forecastMean, forecastStdDev);
}

export function computeCdfAbove(
  target: number,
  forecastMean: number,
  forecastStdDev: number,
): number {
  // P(temp >= target) = 1 - P(temp < target) = 1 - CDF(target - 0.5)
  return 1 - normalCDF(target - 0.5, forecastMean, forecastStdDev);
}
```

- `computeCdfBelow(target)` = `normalCDF(target)` — **aucun décalage de bin** : `P(temp <= target)` au sens continu.
- `computeCdfAbove(target)` = `1 - normalCDF(target - 0.5)` — **décalage de −0.5** : `P(temp >= target)` avec la convention discrète (le bin de `target` couvre `[target − 0.5, target + 0.5)`).

La distribution continue utilisée par `buildTempProbabilityDistribution` (lignes 31-43) est discrétisée par bin de 1 °C : le températurage `k` reçoit `P(k − 0.5 <= temp < k + 0.5)`. Or `computeCdfBelow` et `computeCdfAbove` n'utilisent **pas la même convention** :

- Pour un marché **or_below** (`P(temp <= X)`, YES) : `computeCdfBelow(X)` = `CDF(X)` → YES = proba que la températurage soit `<= X` au continu. Le YES ne comprend **pas** la moitié haute du bin `X`.
- Pour un marché **or_above** (`P(temp >= X)`, YES) : `computeCdfAbove(X)` = `1 − CDF(X − 0.5)` → YES = proba que la températurage soit `>= X` en excluant tout `temp < X − 0.5`. Le YES **comprend** la moitié basse du bin `X`.

**Impact** : pour un marché or_below vs or_above au même seuil `X`, les deux probabilités YES n'utilisent pas la même convention de bin → **trou de 0.5 °C** dans la logique. Exemple à la limite : `temp = X − 0.4`. Pour or_below (YES = `temp <= X`), cette valeur gagne. Pour or_above (YES = `temp >= X`), cette valeur est correctement **exclue** (`X − 0.4 < X`). Le YES or_above est cohérent, mais le YES or_below **oublie** le bin `X` haute moitié par rapport à la convention discrète.

**La convention discrète (bin de 1 °C) est la référence** : `buildTempProbabilityDistribution` et `isForecastInBucket` (C11) l'utilisent. Pour être cohérent :
- `computeCdfBelow(X)` devrait être `CDF(X + 0.5)` (le YES or_below couvre `temp <= X`, i.e. jusqu'à la fin du bin `X`).
- `computeCdfAbove(X)` devrait être `1 − CDF(X − 0.5)` (le YES or_above couvre `temp >= X`, i.e. depuis le début du bin `X`).

### 1.3 C11 — Asymétrie de tolérance dans `isForecastInBucket`

`packages/core/src/weather/weather-exit-helpers.ts:38-58` :

```38:58:packages/core/src/weather/weather-exit-helpers.ts
switch (comparison) {
  case 'between': {
    const low = bounds.low ?? -Infinity;
    const high = bounds.high ?? Infinity;
    return forecastMean >= low - 0.5 && forecastMean <= high + 0.5;
  }
  case 'exact': {
    const target = bounds.target ?? NaN;
    return Math.abs(forecastMean - target) <= 0.5;
  }
  case 'or_below': {
    const target = bounds.target ?? NaN;
    return forecastMean <= target;
  }
  case 'or_above': {
    const target = bounds.target ?? NaN;
    return forecastMean >= target;
  }
```

- **`between`** : `[low − 0.5, high + 0.5]` (tolérance ±0.5 aux deux bornes).
- **`exact`** : `|mean − target| <= 0.5` (tolérance ±0.5).
- **`or_below`** : `mean <= target` — **aucune tolérance**.
- **`or_above`** : `mean >= target` — **aucune tolérance**.

**Impact** : un forecast mean à la limite du seuil est classé différemment selon le type de bucket. Ex. `target = 30`, `mean = 30.4` :
- `or_below` → `30.4 <= 30` = **false** (hors bucket).
- `exact` → `|30.4 − 30| = 0.4 <= 0.5` = **true** (dans le bucket).

Or la convention discrète de bin (même que C10) dit que le bin `30` couvre `[29.5, 30.5)`. `mean = 30.4` appartient au bin `30`, donc devrait être **dans** le bucket `or_below 30` et `exact 30`. L'asymétrie fait que `or_below`/`or_above` sont **plus stricts** que `exact`/`between`.

**Fix cohérent** :
- `or_below` : `forecastMean <= target + 0.5` (couverture du bin `target` inclus).
- `or_above` : `forecastMean >= target - 0.5` (couverture du bin `target` inclus).

### 1.4 C12 — Index unique d'upsert sans `metric`

`packages/core/src/services/weather-history-ingest.service.ts:657-676` :

```663:676:packages/core/src/services/weather-history-ingest.service.ts
await this.historyRepo()
  .createQueryBuilder()
  .insert()
  .values(rows)
  .orUpdate(
    ['price', 'ingest_job_id'],
    // L'intervalle fait partie de l'identité d'une ligne : on peut stocker
    // plusieurs séries (15 min, 1 h, …) pour la même ville/date. `metric`
    // reste hors de la clé — sans risque car un condition_id correspond à
    // un marché à métrique fixe.
    ['condition_id', 'side', 'recorded_at', 'fidelity_minutes'],
  )
  .execute();
```

La colonne `metric` est bien **stockée** (ligne 647 : `metric: input.metric`), mais **pas dans la clé d'upsert** (`orUpdate` conflit target) ni dans l'index unique de l'entité (`WeatherClobPriceHistory.ts:10` : `@Index(['conditionId', 'side', 'recordedAt', 'fidelityMinutes'], { unique: true })`).

```10:10:packages/core/src/entities/WeatherClobPriceHistory.ts
@Index(['conditionId', 'side', 'recordedAt', 'fidelityMinutes'], { unique: true })
```

**Impact** : si deux séries de métriques **différentes** existent pour le même `conditionId`, elles entreraient en collision sur la clé unique (le `conditionId` est unique → même `condition_id, side, recorded_at, fidelity_minutes` pour deux métriques) → l'upsert écraserait `price`/`ingest_job_id` de l'autre métrique. Le commentaire justifie le choix (« sans risque car un condition_id correspond à un marché à métrique fixe »), mais c'est **fragile** : un `conditionId` est stable mais l'hypothèse n'est **pas garantie par un invariant** (un marché pourrait être re-créé avec une autre métrique, ou le parser pourrait attribuer `metric` différemment).

**Fix** : inclure `metric` dans l'index unique de l'entité et dans la clé d'upsert. Migration requise (contrainte unique existante en base).

---

## 2. Décisions de design

| Q | Choix | Détail |
|---|-------|--------|
| **C7-proxyFallback** | Rendre le champ honnête : `proxyFallback: true` **uniquement** quand le forecast est `null` (ligne 25), `false` quand il est présent (ligne 34). | Le warning `resolution_proxy_forecast` (déjà émis côté adapter, ligne 604) reste le seul signal observable. Le champ devient sémantiquement correct. |
| **C7-no-consumer** | Ne pas introduire de nouveau consumer ; conserver le champ dans `ResolutionResult` pour compat | `proxyFallback` documente l'intent (« résolution approximée ») ; le rendre vrai n'est pas consommé mais reste exact. Aucun changement de contrat. |
| **C10-convention** | Aligner `computeCdfBelow` sur la convention discrète de bin (comme `computeCdfAbove` déjà fait) : `computeCdfBelow(target) = normalCDF(target + 0.5)` | Le YES or_below `P(temp <= X)` couvre le bin `X` entier → bornes hautes à `+0.5`. Symétrique de `computeCdfAbove` (`−0.5`). Les deux deviennent cohérents avec `buildTempProbabilityDistribution` et `isForecastInBucket`. |
| **C10-consumers** | Aucun impact de signature — seuls les callers de `computeCdfBelow` changent de valeur numérique | Le seul appelant direct est `computeMarketImpliedProbabilities` (ligne 105). Aucun test unitaire n'existe pour ces fonctions (vérifié : `forecast-distribution.test.ts` ne teste que `normalCDF` et `buildTempProbabilityDistribution`). |
| **C11-tolerance** | Ajouter la tolérance de bin à `or_below` (`<= target + 0.5`) et `or_above` (`>= target - 0.5`) | Aligne `isForecastInBucket` sur la convention de bin. Tests existants (verdict §7) tous **vérifiés** : aucune assertion de limite ne casse. |
| **C11-resolve** | Impact sur `resolveWeatherBucket` (C7) : `or_below`/`or_above` gagnent la tolérance → un forecast à la limite du seuil est résolu dans le bucket | Cohérent : la résolution utilise `isForecastInBucket`. |
| **C12-metric-key** | Ajouter `metric` à l'index unique de l'entité + à la clé d'upsert | Le `metric` est déjà stocké sur chaque ligne ; seule l'identité manque. Migration : drop + recreate la contrainte unique existante (même pattern que `AddClobHistoryIntervalToUniqueKey...0104`). |
| **C12-backward** | La migration recrée la contrainte unique **avec** `metric` en tête | Les lignes existantes : un `(condition_id, side, recorded_at, fidelity_minutes)` n'a qu'un seul `metric` → aucun doublon, la nouvelle contrainte s'applique sans nettoyage préalable. |

---

## 3. Architecture cible

### 3.1 C7 — Résolution backtest

```
resolveWeatherBucket(input):
  forecastMean == null  → { winningOutcome: null,  proxyFallback: true  }  // forecast absent (proxy)
  sinon                 → { winningOutcome: YES/NO, proxyFallback: false } // forecast réel utilisé
```

### 3.2 C10 — Convention CDF alignée (bin 1 °C)

```
or_below (P(temp <= X))   : computeCdfBelow(X) = normalCDF(X + 0.5)
or_above (P(temp >= X))   : computeCdfAbove(X) = 1 - normalCDF(X - 0.5)
exact    (P(temp = X))    : CDF(X + 0.5) - CDF(X - 0.5)          (inchangé)
between  (P(L <= temp <= H)) : CDF(H + 0.5) - CDF(L - 0.5)        (inchangé)
```

### 3.3 C11 — Tolérance `isForecastInBucket` alignée

```
or_below : forecastMean <= target + 0.5
or_above : forecastMean >= target - 0.5
exact    : |mean - target| <= 0.5          (inchangé)
between  : [low - 0.5, high + 0.5]         (inchangé)
```

### 3.4 C12 — Identité de ligne avec `metric`

```
Index unique WeatherClobPriceHistory :
  (condition_id, side, recorded_at, fidelity_minutes, metric)

orUpdate conflictTarget :
  ['condition_id', 'side', 'recorded_at', 'fidelity_minutes', 'metric']
```

---

## 4. Fichiers touchés

| Fichier | Changement | Constat |
|---------|------------|---------|
| `packages/core/src/weather/forecast-distribution.ts` | `computeCdfBelow(target)` → `normalCDF(target + 0.5)` | C10 |
| `packages/core/src/weather/weather-exit-helpers.ts` | `or_below` → `<= target + 0.5` ; `or_above` → `>= target - 0.5` | C11 |
| `packages/backtest/src/adapters/weather/resolution.ts` | `proxyFallback: true` → `false` sur la branche forecast présent (ligne 34) | C7 |
| `packages/core/src/entities/WeatherClobPriceHistory.ts` | `@Index([...])` : ajouter `metric` à l'index unique | C12 |
| `packages/core/src/services/weather-history-ingest.service.ts` | `orUpdate` conflictTarget : ajouter `metric` | C12 |
| `packages/core/src/migrations/AddMetricToClobHistoryUniqueKey*.ts` *(nouveau)* | drop + recreate la contrainte unique avec `metric` ; enregistrer dans `data-source.ts` | C12 |
| `packages/core/src/weather/forecast-distribution.test.ts` | Tests `computeCdfBelow` / `computeCdfAbove` (convention de bin) | C10 |
| `packages/core/src/weather/weather-exit-helpers.test.ts` | Tests limite `or_below` / `or_above` avec tolérance | C11 |
| `tools/weather-algo-rules-audit.ts` | *(aucun changement)* — utilise `isForecastInBucket` et `computeMarketImpliedProbabilities`, impacté indirectement par C11 (recomputed `inBucket` légèrement plus permissif) | C11 |

---

## 5. Détail des changements

### 5.1 C7 — `resolution.ts`

```typescript
// packages/backtest/src/adapters/weather/resolution.ts
export function resolveWeatherBucket(input: ResolutionInput): ResolutionResult {
  if (input.forecastMean == null) {
    // Pas de forecast réel : la résolution est approximée (proxy).
    return { winningOutcome: null, proxyFallback: true };
  }
  const comparison = input.bucketComparison as 'exact' | 'between' | 'or_below' | 'or_above';
  const bounds: BucketBounds = {
    low: input.bucketLow,
    high: input.bucketHigh,
    target: input.bucketTarget,
  };
  const inBucket = isForecastInBucket(input.forecastMean, comparison, bounds);
  // Forecast réel utilisé : pas de proxy.
  return { winningOutcome: inBucket ? 'YES' : 'NO', proxyFallback: false };
}
```

> Le warning `resolution_proxy_forecast` reste émis dans `weather-adapter.ts:604` quel que soit le chemin (résolution par forecast final). Ce warning documente l'approximation de la résolution elle-même (pas l'absence de forecast). Aucun changement requis côté adapter.

### 5.2 C10 — `forecast-distribution.ts`

```typescript
export function computeCdfBelow(
  target: number,
  forecastMean: number,
  forecastStdDev: number,
): number {
  // Convention de bin discrète (1 °C) : le bin du target couvre
  // [target - 0.5, target + 0.5). "Or below" = temp <= target, soit jusqu'à
  // la fin du bin du target. Symétrique de computeCdfAbove (qui soustrait 0.5).
  return normalCDF(target + 0.5, forecastMean, forecastStdDev);
}
```

`computeCdfAbove` reste inchangé (`1 - normalCDF(target - 0.5, ...)`), déjà aligné.

> **Effet sur `computeMarketImpliedProbabilities`** (ligne 105) : le YES `or_below` augmente d'environ la demi-largeur de bin (au plus ~0.5 °C d'écart de proba selon la densité au seuil). Le `noProb = 1 - yesProb` suit automatiquement. Aucun autre caller direct de `computeCdfBelow` (grep : seul `computeMarketImpliedProbabilities`).

### 5.3 C11 — `weather-exit-helpers.ts`

```typescript
case 'or_below': {
  const target = bounds.target ?? NaN;
  // Tolérance de bin : le bin du target couvre [target - 0.5, target + 0.5).
  return forecastMean <= target + 0.5;
}
case 'or_above': {
  const target = bounds.target ?? NaN;
  return forecastMean >= target - 0.5;
}
```

> **Impact sur la résolution (C7)** : `resolveWeatherBucket` utilise `isForecastInBucket` → `or_below`/`or_above` à la limite du seuil sont désormais résolus dans le bucket, cohérent avec `exact`/`between`.

### 5.4 C12 — Entité + upsert + migration

**`WeatherClobPriceHistory.ts`** :

```typescript
@Index(['conditionId', 'side', 'recordedAt', 'fidelityMinutes', 'metric'], { unique: true })
```

**`weather-history-ingest.service.ts`** (orUpdate conflict target) :

```typescript
.orUpdate(
  ['price', 'ingest_job_id'],
  // `metric` fait partie de l'identité d'une ligne : deux séries de métriques
  // différentes sur le même condition_id ne doivent pas s'écraser.
  ['condition_id', 'side', 'recorded_at', 'fidelity_minutes', 'metric'],
)
```

**Nouvelle migration `AddMetricToClobHistoryUniqueKey*.ts`** (même pattern que `AddClobHistoryIntervalToUniqueKey1700000000104`) :

```typescript
// packages/core/src/migrations/AddMetricToClobHistoryUniqueKey1700000000110.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetricToClobHistoryUniqueKey1700000000110 implements MigrationInterface {
  name = 'AddMetricToClobHistoryUniqueKey1700000000110';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'weather_clob_price_history_condition_id_side_recorded_at_fidelity_key'
        ) THEN
          ALTER TABLE weather_clob_price_history
            DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_metric_key UNIQUE (condition_id, side, recorded_at, fidelity_minutes, metric)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'weather_clob_price_history_condition_id_side_recorded_at_fidelity_metric_key'
        ) THEN
          ALTER TABLE weather_clob_price_history
            DROP CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_metric_key;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE weather_clob_price_history ADD CONSTRAINT weather_clob_price_history_condition_id_side_recorded_at_fidelity_key UNIQUE (condition_id, side, recorded_at, fidelity_minutes)`,
    );
  }
}
```

Enregistrer dans `packages/core/src/database/data-source.ts` : ajouter l'import **après** `AddUnitToWeatherPositionForecast1700000000109` (ligne 142) et l'entrée dans le tableau `migrations` **après** `AddUnitToWeatherPositionForecast1700000000109` (ligne 246), pour préserver l'ordre chronologique des migrations (la nouvelle migration est `...0110`, strictement après `...0109`).

---

## 6. Ordre d'implémentation

### Phase 1 — Core (C10 + C11, fonctions pures)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 1 | `computeCdfBelow` → `normalCDF(target + 0.5)` | `forecast-distribution.ts` | 2 min |
| 2 | `or_below` → `<= target + 0.5` ; `or_above` → `>= target - 0.5` | `weather-exit-helpers.ts` | 2 min |
| 3 | Tests `computeCdfBelow`/`computeCdfAbove` (convention de bin) | `forecast-distribution.test.ts` | 15 min |
| 4 | Tests limite `or_below`/`or_above` avec tolérance | `weather-exit-helpers.test.ts` | 10 min |
| 5 | Build core + tests | `npm run build -w @polywatch/core && npm test` | 5 min |

### Phase 2 — Backtest (C7)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 6 | `proxyFallback: false` sur la branche forecast présent | `resolution.ts` | 1 min |
| 7 | Build backtest | `npm run build -w @polywatch/backtest` | 2 min |

### Phase 3 — Core DB (C12)

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 8 | Ajouter `metric` à l'index unique de l'entité | `WeatherClobPriceHistory.ts` | 1 min |
| 9 | Ajouter `metric` au conflictTarget d'`orUpdate` | `weather-history-ingest.service.ts` | 1 min |
| 10 | Créer la migration + l'enregistrer | `AddMetricToClobHistoryUniqueKey1700000000110.ts` + `data-source.ts` | 10 min |
| 11 | Tests ingest (2 métriques distinctes, même conditionId → pas de collision) | `weather-history-ingest.service.test.ts` | 15 min |
| 12 | Build core + tests | `npm run build -w @polywatch/core && npm test` | 5 min |

### Phase 4 — Validation croisée

| # | Tâche | Fichier | Effort |
|---|-------|---------|--------|
| 13 | Vérifier que le tool `weather-algo-rules-audit.ts` compile toujours (impact C11) | `tools/` | 5 min |
| 14 | ReadLints sur tous les fichiers modifiés | — | 5 min |

**Effort total estimé** : ~1h30

---

## 7. Tests

| Composant | Test | Constat |
|-----------|------|---------|
| `computeCdfBelow` | `mean=0, std=1` : `target=-1` → ~0.1587 ; `target=0` → `CDF(0.5)` (~0.6915) — vérifie le décalage +0.5 | C10 |
| `computeCdfAbove` | `mean=0, std=1` : `target=0` → `1 − CDF(−0.5)` (~0.6915) — symétrique | C10 |
| Cohérence bin | `computeCdfBelow(X) + computeCdfAbove(X) − P(bin X)` ≈ 1, où `P(bin X) = CDF(X+0.5) − CDF(X−0.5)` — le bin `X` est compté dans les deux, on le soustrait une fois | C10 |
| Exhaustivité disjointe | `computeCdfBelow(X) + computeCdfAbove(X+1)` ≈ 1 (les deux moitiés disjointes de part et d'autre de `X+0.5`) | C10 |
| `computeMarketImpliedProbabilities` | `or_below` YES augmente conformément au décalage ; `noProb = 1 − yesProb` | C10 |
| `isForecastInBucket` `or_below` | `target=30`, `mean=30.4` → **true** (nouveau) ; `mean=30.6` → false | C11 |
| `isForecastInBucket` `or_above` | `target=35`, `mean=34.6` → **true** (nouveau) ; `mean=34.4` → false | C11 |
| Tests existants `or_below`/`or_above` | `(30, or_below {target:30})` true ; `(31, or_below {target:30})` false ; `(34, or_above {target:35})` false ; `(35, or_above {target:35})` true — **tous inchangés** | C11 |
| Tests existants `exact`/`between` | `(31.6, exact {target:31})` false ; `(34.6, between {low:32, high:34})` false — **inchangés** | C11 |
| `resolveWeatherBucket` | forecast présent → `proxyFallback: false` ; forecast `null` → `proxyFallback: true`, `winningOutcome: null` | C7 |
| `resolveWeatherBucket` (limite) | `or_below {target:30}`, mean `30.4` → `winningOutcome: 'YES'` (via C11) | C11 |
| Upsert C12 | 2 séries même `conditionId`, métriques `highest_temp`/`lowest_temp` → 2 lignes distinctes, pas de collision | C12 |
| Migration C12 | `up` recrée la contrainte avec `metric` ; `down` restaure sans `metric` | C12 |

> **Vérification des tests existants `isForecastInBucket`** (lu dans `weather-exit-helpers.test.ts` et `forecast-bucket-selector.test.ts`) :
> - `or_below {target:30}` : `mean=28` true (≤30.5), `mean=30` true (≤30.5), `mean=31` false (31 > 30.5) → **tous passent**.
> - `or_above {target:35}` : `mean=35` true (≥34.5), `mean=36` true (≥34.5), `mean=34` false (34 < 34.5) → **tous passent**.
> Aucune assertion de limite existante ne casse avec la tolérance ajoutée.

---

## 8. Risques résiduels

| Risque | Mitigation |
|--------|------------|
| **R-C10-1** : Le décalage `+0.5` de `computeCdfBelow` change la valeur numérique du YES `or_below` → impact sur les entrées `evaluateBucketGate` et les edges backtest. | Comportement **désiré** : aligne la convention. La variation est bornée (~demi-bin, typiquement < 0.5 °C d'écart de proba). Tests de régression sur `computeMarketImpliedProbabilities` ajoutés. |
| **R-C10-2** : Aucun test unitaire n'existait sur `computeCdfBelow`/`computeCdfAbove` (grep : absent de `forecast-distribution.test.ts`). | Les tests sont ajoutés dans le périmètre (§7). La couverture préexistante (normalCDF, distribution) reste verte. |
| **R-C11-1** : `tools/weather-algo-rules-audit.ts` recompute `inBucket` via `isForecastInBucket` — la tolérance rend `or_below`/`or_above` légèrement plus permissifs → quelques lignes « outOfBucketAtEntry » pourraient ne plus l'être. | Audit tool, pas une route production. Impact statistique mineur et cohérent avec la convention. Aucun code à changer. |
| **R-C11-2** : Le bucket selector (`forecast-bucket-selector.ts:57`) sélectionne le bucket via `isForecastInBucket` → `or_below`/`or_above` sélectionnent un bucket à la limite du seuil. | Aligné sur la convention de bin ; cohérent avec `exact`/`between` et avec la résolution (C7). |
| **R-C12-1** : Migration sur une table volumineuse — drop + recreate de contrainte unique sur Postgres. | Pattern déjà utilisé (`AddClobHistoryIntervalToUniqueKey...0104`). La contrainte est recréée avec le même index. À valider en env sur données réelles (index build). |
| **R-C12-2** : L'hypothèse « un conditionId a une métrique fixe » est déjà vraie en pratique → la clé `metric` ne change pas le comportement nominal. | Le fix est **défensif** : il garantit l'invariant au niveau schéma au lieu de reposer sur un commentaire. Aucun changement de données attendu. |
| **R-C7-1** : Changer `proxyFallback` à `false` pourrait casser un test ou un consumer futur. | Grep exhaustif : **aucun** consumer du champ dans le repo (seul `resolution.ts` le déclare/retourne). `ResolutionResult` est interne au package backtest. Aucun test existant sur `resolution.ts` (aucun `resolution.test.ts`). |

---

## 9. Checklist prod

- [ ] `npm run build -w @polywatch/core` — passe sans erreur
- [ ] `npm run build -w @polywatch/backtest` — passe sans erreur
- [ ] `npm test` — aucun nouveau échec (les échecs pré-existants hors périmètre restent)
- [ ] ReadLints — aucun nouveau lint error sur les fichiers modifiés
- [ ] `npm run migrate` — la migration `AddMetricToClobHistoryUniqueKey` s'applique (à exécuter en prod)
- [ ] Smoke test ingest : deux métriques distinctes sur un même `conditionId` ne s'écrasent plus (à valider en env)
- [ ] Smoke test backtest : `proxyFallback` correct selon la présence du forecast (à valider en env)
- [ ] `git diff --stat` — confirmer le périmètre des fichiers modifiés

---

## 10. Critère de complétude

- [ ] C10 : `computeCdfBelow(target)` = `normalCDF(target + 0.5)` (convention de bin alignée sur `computeCdfAbove`)
- [ ] C10 : `computeCdfAbove` inchangé (`1 − normalCDF(target − 0.5)`) — déjà aligné
- [ ] C10 : Tests de symétrie `computeCdfBelow(X) + computeCdfAbove(X)` ≈ 1
- [ ] C11 : `or_below` utilise `<= target + 0.5`
- [ ] C11 : `or_above` utilise `>= target - 0.5`
- [ ] C11 : Les tests existants `isForecastInBucket` (exact/between/or_below/or_above) passent toujours
- [ ] C11 : Tests de limite ajoutés (`or_below` 30.4 → true, `or_above` 34.6 → true)
- [ ] C7 : `proxyFallback: false` quand le forecast est présent (ligne 34)
- [ ] C7 : `proxyFallback: true` quand le forecast est `null` (ligne 25)
- [ ] C12 : `metric` ajouté à l'index unique de `WeatherClobPriceHistory`
- [ ] C12 : `metric` ajouté au conflictTarget d'`orUpdate`
- [ ] C12 : Migration `AddMetricToClobHistoryUniqueKey` créée + enregistrée dans `data-source.ts`
- [ ] C12 : Test d'upsert avec deux métriques distinctes sur le même `conditionId` → pas de collision
- [ ] Builds core / backtest + tests + lints passent
- [ ] Aucun fichier hors périmètre modifié

# Plan d'implémentation — Perf ridge plot : pré-calcul des séries (Reco 3)

**Date** : 2026-08-23
**Auteur** : Assistant IA
**Statut** : ✅ **APPLIQUÉ** — implémentation terminée, tests verts, build OK
**Référence** : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../../audits/2026-08-23_audit-perf-backtest-ridge-plot.md)
**Dépend de** : Reco 1 (downsampling) — les deux sont compatibles et additifs. Ce plan cible la **friction P4** (`Date.parse` répétés) et fournit la **base géométrique stable** (coordonnées temps/prix relatives) nécessaire à la reco 2.

---

## 🎯 Objectif

Éliminer **tous les `Date.parse` répétés** du chemin de rendu en enrichissant chaque série **une seule fois** d'un tableau de points géométriques pré-calculés (timestamps numériques + positions en unités **temps/prix relatives**, hors pixels). Le coût `Date.parse` devient **one-time par série** au lieu de **à chaque render**.

C'est la **fondation** de la reco 2 (découplage projection) : une fois que la série a une géométrie stable, `buildPath` ne fait plus que de la **projection affine** sans re-parser ni re-trier.

---

## 🔍 Contexte technique

### Friction P4 (audit) — `Date.parse` répété partout
Les timestamps ISO `p.t` sont **fixes** pour la durée de vie d'une série, mais sont re-parsés à chaque :
- `buildPath` (`scale.ts:79`) → chaque point, à chaque re-build (molette/zoom/frame).
- `nearestPrice` (`useRidgeHover.ts:59,68`) → chaque déplacement du hover.
- `playerTimeline` (`BacktestRidgeChart.tsx:88`) → tous les points, à chaque changement de `voies()`.
- `RidgePlayMarkers` (`RidgePlayMarkers.tsx:46,57`) et `RidgePositionMarkers` (`:28,38`) → à chaque re-éval.
- `activeVoieIndex` (`BacktestRidgeChart.tsx:117`) → à chaque tick du player.

### Type actuel (couche API)
```typescript
// packages/frontend/src/api.ts:1205
export interface BacktestMarketSeriesPoint { t: string; yesPrice: number | null; }
export interface BacktestMarketSeriesDto {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  metric: string | null;
  bucketComparison: string | null;
  bucketTarget: number | null;
  bucketLow: number | null;
  bucketHigh: number | null;
  unit: 'celsius' | 'fahrenheit' | null;
  forecastMean: number | null;
  forecastStdDev: number | null;
  points: BacktestMarketSeriesPoint[];
}
```

> ⚠️ **Ne pas modifier l'interface API** (`BacktestMarketSeriesDto`). L'enrichissement est **local au frontend**, produit par un étage dérivé (comme les buckets enrichis par `group.ts`), pour ne pas toucher au contrat backend et au golden snapshot.

---

## 🧱 Implémentation

### §1 — Nouveau type enrichi dans `ridge/types.ts`

```typescript
/** Point de série enrichi : timestamp pré-paré (ms) + géométrie native. */
export interface EnrichedPoint {
  /** Timestamp numérique (Date.parse) — pré-calculé, ne se re-parse jamais. */
  t: number;
  /** Prix YES brut (0..1 ou null si trou). */
  price: number | null;
}

export interface EnrichedSeries {
  conditionId: string;
  city: string | null;
  targetDateIso: string | null;
  forecastMean: number | null;
  forecastStdDev: number | null;
  points: EnrichedPoint[];   // triés par t croissant
  /** Index bornes pour accès rapide (voir §3). */
  minT: number;
  maxT: number;
}
```

### §2 — Fonction d'enrichissement dans `ridge/precompute.ts` (nouveau fichier)

```typescript
/** Enrichit une série : pre-parse les timestamps, pré-calcule bornes. Coût O(n) one-shot. */
export function enrichSeries(dto: BacktestMarketSeriesDto): EnrichedSeries {
  const points: EnrichedPoint[] = [];
  let minT = Infinity, maxT = -Infinity;
  for (const p of dto.points) {
    const t = Date.parse(p.t);
    if (Number.isNaN(t)) continue;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    points.push({ t, price: p.yesPrice ?? null });
  }
  // points déjà triés par t (données chronologiques) ; tri défensif optionnel.
  return { conditionId: dto.conditionId, city: dto.city, targetDateIso: dto.targetDateIso,
           forecastMean: dto.forecastMean, forecastStdDev: dto.forecastStdDev,
           points, minT, maxT };
}
```

> ⚠️ **⚠️ Éligibilité O(n) one-shot — invalidation (zone d'ombre résolue)** : `props.series` provient de `liveSeries()` (signal, `WeatherAlgoBacktestTab.tsx:158`), **remplacé à chaque poll**. Un cache clé **uniquement par `conditionId`** retournerait une **série périmée** au prochain poll.
>
> **Règle d'invalidation** : la clé du cache = **`conditionId` + référence de `dto.points`** (ou `dto.points.length + dto.points[0].t + dto.points[last].t`). Si `points` est une **nouvelle référence** (nouveau poll), on re-enrichit. Ne jamais cacher par `conditionId` seul.

> ⚠️ **⚠️ Préservation des champs métier (O 2)** : `groupVoies` (`group.ts`) lit `bucketComparison`, `bucketTarget`, `bucketLow`, `bucketHigh`, `unit` (tri `bucketSortKey`, label `bucketLabel`, couleur). **Ne PAS remplacer `bucket.series` par un `EnrichedSeries`** (perte de champs → tri/label cassés).
>
> **Approche retenue** : enrichir en **annexe** — stocker l'`EnrichedSeries` dans un **champ parallèle** du `BucketLine` (`ridge/types.ts`), **en gardant `bucket.series` intacte** pour tout ce qui est métier. `buildPath`/`nearestPrice` consomment l'annexe ; `groupVoies` continue de voir la série d'origine.

### §3 — Rebrancher les consommateurs sur les points enrichis

| Consommateur actuel | Remplacer par |
|---|---|
| `buildPath` (`scale.ts`) : boucle + `Date.parse(p.t)` | Itérer `enriched.points`, utiliser `p.t` numérique, prix `p.price` |
| `nearestPrice` (`useRidgeHover.ts:51`) : `Date.parse(points[mid].t)` + `slice(-maxTicks)` | `enriched.points` + recherche binaire sur `p.t` **dans la fenêtre `slice(-maxTicks)`** (même sémantique que l'actuel) |
| `playerTimeline` (`BacktestRidgeChart.tsx:80`) : `Date.parse(p.t)` | `enriched.points` → `p.t` direct (Set + tri déjà présents) |
| `RidgePlayMarkers` / `RidgePositionMarkers` (`Date.parse(entryAt/exitAt)`) | timestamps positions pré-calculés une fois (positions stables) |
| `activeVoieIndex` (`Date.parse(pos.entryAt)`) | index entryAt pré-calculé |

> ⚠️ **`nearestPrice` doit conserver la borne `maxTicks`** : l'actuel fait `s.points.slice(-n)` **avant** la recherche binaire (`useRidgeHover.ts:52-53`). Sur les points enrichis, la recherche binaire doit **se restreindre à `enriched.points.slice(-n)`** (ou aux indices `[len-n, len)`), sinon la sémantique « derniers N ticks » est perdue et le hover ciblerait des points hors fenêtre.

> Les **positions** (`entryAt`/`exitAt`) sont aussi stables : pré-calculer leurs timestamps numériques une fois (ex. dans `groupVoies` ou un `createMemo` par dataset).

### §4 — Projection découplée (base pour reco 2)

Avec les points enrichies, définir une **projection pure** séparée de la construction du path :

```typescript
/** Projection affine temps→pixel, pure et O(1). */
export function projectPoint(p: EnrichedPoint, scale: RidgeScale, voieTop: number) {
  return {
    px: scale.xPos(p.t),
    py: p.price == null ? null : scale.yPos(p.price, voieTop),
  };
}
```

`buildPath` ne fait plus que : filtrer `clipUntilT`/`maxTicks` sur `p.t`, projeter, segmenter (reco 1), assembler. **Aucun `Date.parse`.**

---

## 🧪 Tests (Vitest)

Créer `packages/frontend/src/components/backtest/ridge/precompute.test.ts`.

### §T1 — `enrichSeries`
- Points avec timestamps valides → `t` numérique correct, bornes `minT`/`maxT`.
- Timestamp invalide → point ignoré (pas de `NaN`).
- `yesPrice = null` → `price: null` conservé (trou), pas supprimé.
- Ordre préservé (t croissant).
- Série vide → `points: []`, bornes cohérentes.

### §T2 — `buildPath` sur séries enrichies
- **Régression** : même rendu visuel qu'avec `Date.parse` (comparer `d` sur un petit dataset réel).
- **Pas de re-parse** : `buildPath` n'appelle plus `Date.parse` (assertion par mock/spy si faisable, ou garantie par conception).
- **`maxTicks`/`clipUntilT`** : toujours respectés (basés sur `p.t` numérique).

### §T3 — `nearestPrice` enrichi
- Recherche binaire sur `p.t` retourne le bon prix, **dans la fenêtre `slice(-maxTicks)`**.
- `null` (trou) ignoré, borne pré-calculée `minT/maxT` pour early-exit.

### §T4 — Invalidation du cache (zone d'ombre Z1)
- Même `conditionId` + **même référence `points`** → seconde fois retourne la même référence enrichie (cache hit).
- Même `conditionId` + **nouvelle référence `points`** (nouveau poll) → **re-enrichit** (ne retourne PAS l'ancienne référence). Assertion : référence différente + nouveaux `t`.

---

## 🎨 Impact attendu

- **Supprime les `Date.parse` répétés** sur le chemin hot (P4).
- **Pré-requis** de la reco 2 : projection O(1) découplée → le pan/zoom et le player n'ont plus qu'à projeter des points numériques, pas re-parser.
- Coût one-shot `O(n)` par série, amorti sur toutes les frames.

### ⚠️ Limite (couplage reco 2)
Ce plan ne **réduit pas à lui seul** le `scan O(n)` à chaque interaction (reco 1 le borne pour le path ; reco 2 le découple). La pleine **fluidité molette/player** sur très gros volumes est atteinte en combinant **reco 1 (downsample) + reco 3 (pré-calcul) + reco 2 (projection découplée)**.

---

## 🔍 Vérification

1. `cd packages/frontend && npx vitest run src/components/backtest/ridge/precompute.test.ts` → verts.
2. Confirmer qu'aucun `Date.parse` ne subsiste dans `scale.ts`/`useRidgeHover.ts` (grep).
3. Lancer l'app, charger un backtest, vérifier : courbes identiques visuellement, hover réactif, zoom/player non-régression.
4. `npm run build` (racine).

---

## 📊 Checklist de revue

- [x] `EnrichedPoint` / `EnrichedSeries` ajoutés dans `ridge/types.ts`.
- [x] `enrichSeries` dans `ridge/precompute.ts` (new file), mémoïsé **avec invalidation** (clé `conditionId` + référence de `points`), jamais par `conditionId` seul.
- [x] Enrichissement en **annexe** d'un champ parallèle du `BucketLine` — `bucket.series` reste **intacte** (champs métier préservés pour `groupVoies`).
- [x] `buildPath`, `nearestPrice`, `playerTimeline`, markers, `activeVoieIndex` consomment les points enrichis (plus de `Date.parse` dans le chemin hot).
- [x] `nearestPrice` conserve la borne `slice(-maxTicks)` sur les points enrichis (même sémantique).
- [x] Positions pré-parse une fois (`RidgePlayMarkers.tsx`, `RidgePositionMarkers.tsx`, `BacktestMarketRidgeChart.tsx`).
- [x] `scale.ts` sans `Date.parse` sur le chemin enrichi (fallback seul conservé pour compat).
- [x] Tests §T1–§T4 verts (inclut §T4 : invalidation de cache — nouvelle référence `points` → re-enrichit).
- [x] Build + validation visuelle OK.

---

## 🔗 Références

- Audit : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../../audits/2026-08-23_audit-perf-backtest-ridge-plot.md) (friction P4).
- Dépend : plan reco 1 (downsampling) — le pré-calcul se combine avec le min-max.
- Donne la base : plan reco 2 (projection découplée / clipPath).

> 📝 **Post-implémentation** : déplacer vers `docs/plans/applied/` + INDEX.

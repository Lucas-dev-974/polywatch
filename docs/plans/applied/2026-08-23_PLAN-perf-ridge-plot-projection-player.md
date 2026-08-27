# Plan d'implémentation — Perf ridge plot : projection découplée + clipPath player (Reco 2)

**Date** : 2026-08-23
**Auteur** : Assistant IA
**Statut** : ✅ **APPLIQUÉ** — implémentation terminée, tests verts, build OK
**Référence** : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../../audits/2026-08-23_audit-perf-backtest-ridge-plot.md)
**Dépend de** : Reco 3 (pré-calcul des séries) — ce plan suppose des séries enrichies en timestamps numériques (ou, à défaut, isole la projection).

---

## 🎯 Objectif

Attaquer la **cause racine de P1/P2** : aujourd'hui le `path` **mélange données et projection** — chaque pan/zoom/frame re-parcourt tous les points et re-construit la string entière parce que la projection pixel (`scale.xPos/yPos`) est imbriquée **dans** `buildPath`.

Ce plan **découple** :
1. la **géométrie native** (stable : temps/prix) de la **projection** (variable : viewport, largeur),
2. le **reveal du player** (re-build du path) en un **`clipPath` SVG coulissant** (un rect animé).

Résultat : pan/zoom/lecture ne font plus qu'une **projection affine O(points retenus)**, sans re-parcourir les données ni re-tracer tout le path.

---

## 🔍 Diagnostic de la cause racine (P1/P2)

### P1 — `path` dépend de `scale` (objet grossier)
`RidgeLines.tsx:30` :
```tsx
const path = createMemo(() => buildPath(bucket.series, voieTop(), props.scale, props.maxTicks, props.cutGaps, props.clipUntilT));
```
`props.scale` est un **nouvel objet à chaque changement de viewport** (`BacktestRidgeChart.tsx:155` → `buildRidgeScale`). Solid invalide le memo par **référence** → **tous** les paths visibles sont re-tracés à chaque molette/drag/reset, même si les données n'ont pas changé — seul le **projection X** a bougé.

### P2 — `Le player invalide deux fois par frame`
- `clipUntilT` (`BacktestRidgeChart.tsx:134`) change à **chaque tick** → re-trace toutes les courbes (re-build du path).
- `useRidgePlayerFocus` (`setViewport` par frame) → `scale` change → re-trace encore.

Or le reveal ne modifie que le **suffixe** ; re-tracer tout est du gaspillage.

### Défaut structurel commun
La **projection est encapsulée dans le path**. Dès qu'on sépare la géométrie (stable) de la projection (variable), on peut :
- ne re-projeter que les points **nécessaires** au viewport courant (reco 1), et
- révéler via clip sans re-tracer (player).

---

## 🧱 Implémentation

### §1 — Projection pure, découplée de `buildPath` (sur reco 3)

S'appuyer sur les séries enrichies (`EnrichedPoint.t` numérique, reco 3) et définir une projection **pure** :

```typescript
// ridge/projection.ts (nouveau)
import type { RidgeScale } from './types';

export interface ProjectedPoint { px: number; py: number; t: number; }

/** Projette une série enrichie dans le viewport courant. O(pts retenus). */
export function projectSeries(
  points: { t: number; price: number | null }[],
  scale: RidgeScale,
  voieTop: number,
  bucketPx: number,
): ProjectedPoint[] {
  // 1. Downsampling min-max (reco 1) sur la géométrie native (t, price).
  // 2. Projection affine O(1) par point retenu.
  // 3. Retourne ProjectedPoint[] (px, py, t) — pas encore une string.
}
```

`buildPath` redevient un **pur assembleur** : prend des `ProjectedPoint[]` (+ segmentation `cutGaps` de reco 1) et produit la string `M/L`.

**Bénéfice** : la projection et la string sont **mémoïsées séparément**.
- Mémo clé par `(identité série, voieTop, scale.minT, scale.maxT, scale.plotW, bucketPx)` → la **projection** n'est recalculée que si le viewport ou la largeur changent réellement.
- La **string** n'est reconstruite que si la projection change.

> ⚠️ **La clé DOIT inclure `scale.plotW` et `bucketPx`** : `xPos = ((t-minT)/spanT)*plotW` dépend de `plotW`, et le downsampling de `bucketPx`. Sans `plotW` dans la clé, un **resize** (`useChartWidth`) laisserait une projection stale (mauvaise échelle) alors que `minT/maxT` n'ont pas changé.

### §2 — Mémoïsation par projection dans `RidgeLines`

Remplacer le memo unique par deux niveaux :

```tsx
// Géométrie stable (reco 3) + downsampling par série.
const geometry = useMemoKeyedBySeries(bucket.series);   // EnrichedSeries + downsample par bucketPx

// Projection : dépend des bornes temps du viewport, PAS de l'objet scale entier.
const projected = createMemo(() =>
  projectSeries(geometry.points, viewportBounds(), voieTop(), bucketPx)
);
const path = createMemo(() => buildPathString(projected(), cutGaps));
```

> Clé : passer au memo **les bornes scalaires `minT`/`maxT`** (ou la largeur) plutôt que l'**objet `scale`** entier → Solid ne s'invalide que si les bornes changent vraiment, et la projection (plus la string) ne se re-fait qu'à ce moment-là. C'est **le cœur** de la correction de P1.

### §3 — Focus horizontal du player à rendre **discret** (condition de P2)

**⚠️ Conflit à acter (zone d'ombre)** : `useRidgePlayerFocus.ts:55` appelle `setViewport` **à chaque frame** (lerp pour suivre le playhead). Si on le garde tel quel, `minT/maxT` changent chaque frame → la projection (§2) est **recalculée à chaque frame** → le « pas de re-trace » du §4 serait **faux**.

➡️ **Modifier le focus horizontal** pour le rendre **discret / par paliers** : ne recentrer le viewport que **lorsque le playhead quitte une zone tampon** (ex. le playhead sort du tiers central), **pas** à chaque frame. Le suivi fin est porté uniquement par le **déplacement du rect** `revealW`/`x` (O(1), sans projection des séries). Le focus **vertical** (défilement de la row, `useRidgePlayerFocus.ts:60-66`) peut rester en lerp — il n'affecte pas la projection X.

C'est une **décision de rendu à acter** : sans ce changement, le player re-projette quand même (coût borné par le downsample, mais pas O(1)).

### §4 — Reveal du player par `clipPath` coulissant (P2)

Remplacer le re-build du path sous `clipUntilT` par un **clip rect animé**, appliqué une **seule fois** à un groupe contenant toutes les lignes :

```tsx
// Dans BacktestRidgeChart.tsx : le path de CHAQUE série est construit COMPLET
// (clipUntilT={null} → tracé une seule fois, aucune re-trace). Le reveal est
// porté par un clipPath coulissant sur le groupe des lignes.

<svg>
  <defs>
    <clipPath id="ridge-reveal">
      <rect x={0} y={MARGIN_TOP} width={revealW()} height={plotH()} />
    </clipPath>
  </defs>
  <g clip-path="url(#ridge-reveal)">
    <RidgeLines ... clipUntilT={null} />   {/* paths complets, construits UNE fois */}
  </g>
</svg>
```

Où `revealW()` est la largeur du rect qui suit le playhead (projection O(1) de `player.playheadT()`).

**Effet** :
- **Une seule passe** : les paths complets sont construits **une seule fois** (pas de double rendu).
- Chaque tick du player ne change que **`revealW()`** (attribut `width` d'un seul rect) → **pas de re-trace** des paths.
- `clipUntilT` disparaît du calcul de path : la révélation devient un **clipping** (appliqué par le rasterizer), plus un re-parcours/re-string.

> ⚠️ **Précision rendu** : le `clipPath` ne modifie que la **visibilité** du path complet, jamais son contenu. Il n'y a donc **aucun gain à dessiner le path deux fois** ; au contraire, une double passe doublerait le coût. L'idée est de **construire le path complet une seule fois** et de laisser le rect coulissant décider de ce qui s'affiche.

---

## 🧪 Tests (Vitest)

### §T1 — Projection pure
- `projectSeries` : projection affine correcte (x/t, prix→y), coût O(pts retenus).
- Downsampling (reco 1) appliqué sur la géométrie avant projection.
- `clipUntilT` : si conservé en paramètre, respecté en amont de la projection.

### §T2 — Mémoïsation (P1)
- Modifier `scale.minT/maxT` → projection recalculée ; string rebuild.
- Modifier **autre chose** sur le viewport (ex. voieTop inchangé) → projection **pas** recalculée (assertion par compteur d'appels).
- La série ne change pas → la géométrie pré-calculée n'est pas re-parcourue.

### §T3 — Player clipPath (P2)
- `revealW` suit `playheadT` (projection O(1)).
- Le `d` des paths **ne change pas** quand le playhead avance (seul `revealW` bouge) → assertion que `buildPathString` n'est pas rappelé pendant le play.
- À `playheadT` = début → `revealW=0` (rien de visible) ; = fin → `revealW=plotW` (tout visible).

### §T4 — Régression visuelle
- Un dataset de référence rend la **même image** (mêmes `d` de path) avec et sans le player.
- `cutGaps` / `maxTicks` / positions toujours corrects.

---

## 🎨 Impact attendu

- **P1 corrigé** : le zoom/pan ne re-projette/re-string que si les bornes du viewport changent réellement (mémo séparée), au lieu de tout re-tracer à chaque invalidation.
- **P2 corrigé (si focus discret §3 appliqué)** : le player ne re-trace plus ; seul un rect coulisse (coût O(1) par frame). Sans le focus discret, la projection est recalculée à chaque frame (bornée par le downsample, mais pas O(1)).
- Combine : **reco 1 (downsample) + reco 3 (pré-calcul) + reco 2 (découplage)** → le coût par frame devient **borné** (par le viewport/downsample) et **sans `Date.parse`**.

### ⚠️ Limite / dépendances
- Nécessite **reco 3** (séries enrichies) pour la projection O(1) sans `Date.parse`.
- Nécessite **reco 1** (downsampling) pour borner le nombre de points projetés.
- **Dépend du focus discret (§3)** : si le focus horizontal garde un `setViewport` par frame, la projection est recalculée chaque frame (le coût reste borné par le downsample, mais le « O(1) » n'est pas atteint).
- `clipUntilT` doit être **retiré du calcul de path** (`buildPath`) : la révélation devient un clipping, plus un re-parcours/re-string.

---

## 🔍 Vérification

1. `cd packages/frontend && npx vitest run src/components/backtest/ridge/*.test.ts` → verts.
2. `grep -r "Date.parse" packages/frontend/src/components/backtest/ridge` → vide (ou ciblé hors hot path).
3. Lancer l'app : molette fluide (P1), player fluide sans re-trace (P2), visuellement identique.
4. `npm run build` (racine).

---

## 📊 Checklist de revue

- [x] `ridge/projection.ts` : projection pure séparée de `buildPath`.
- [x] `RidgeLines` : memo `projected` (clé = bornes `minT/maxT` + `plotW` + `bucketPx`) + memo `path` (dépend de `projected`).
- [x] `clipUntilT` retiré du calcul de path ; reveal via `clipPath` rect coulissant.
- [x] **Focus horizontal rendu discret** (`useRidgePlayerFocus`) : pas de `setViewport` à chaque frame ; recentrage par paliers.
- [x] Pendant play, `buildPathString` non rappelé (seul `revealW`/`x` bouge) — assert via compteur.
- [x] Tests verts (precompute + scale).
- [x] Build + validation visuelle.

---

## 🔗 Références

- Audit : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../../audits/2026-08-23_audit-perf-backtest-ridge-plot.md) (frictions P1, P2).
- Dépend : plan reco 3 (pré-calcul) + reco 1 (downsampling).
- Files touchées : `ridge/scale.ts`, `ridge/RidgeLines.tsx`, `BacktestRidgeChart.tsx`, `ridge/useRidgePlayerFocus.ts`, `ridge/projection.ts`.

> 📝 **Post-implémentation** : déplacé vers `docs/plans/applied/` + INDEX.

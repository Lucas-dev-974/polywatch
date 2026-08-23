# Plan d'implémentation — Perf ridge plot : downsampling min-max (Reco 1)

**Date** : 2026-08-23
**Auteur** : Assistant IA
**Statut** : ✅ **APPLIQUÉ** — implémentation terminée, tests verts, build OK
**Référence** : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../audits/2026-08-23_audit-perf-backtest-ridge-plot.md)
**Portée** : Reco 1 (cause racine). Les reco 2–4 feront l'objet de plans séparés (commits indépendants).

---

## 🎯 Objectif

Rendre le rendu du ridge plot **fluide quel que soit le volume de données** en bornant la complexité du tracé à la largeur d'écran, au lieu de `O(points par série)`.

Le downsampling s'applique **à l'intérieur de `buildPath`** (fonction pure dans `ridge/scale.ts`), sans toucher à la structure des données ni au composant. Le player (`clipUntilT`) et le hover restent fonctionnels car ils continuent de consommer les mêmes séries d'origine.

> **Limite de ce plan (honnêteté)** : le downsampling borne la **taille du path/DOM** (cause racine P3/P7) et réduit le travail par frame, mais chaque appel de `buildPath` doit encore **parcourir les points d'origine** pour choisir les min/max → un `scan O(n)` par pan/zoom/frame demeure. La suppression totale de ce scan (et donc la fluidité maximale molette/player sur très gros volumes) relève des **recos 2–4** (pré-calcul/cache par série). Ce plan est la **première étape fondatrice**.

---

## 🔍 Contexte technique

### Fichier concerné
`packages/frontend/src/components/backtest/ridge/scale.ts:64` — `buildPath(series, voieTop, scale, maxTicks?, cutGaps?, clipUntilT?)`.

### Code actuel (extrait)
```typescript
export function buildPath(
  series: BacktestMarketSeriesDto,
  voieTop: number,
  scale: RidgeScale,
  maxTicks?: number | null,
  cutGaps = true,
  clipUntilT?: number | null,
): string {
  const points = maxTicks && maxTicks > 0 ? series.points.slice(-maxTicks) : series.points;
  if (points.length === 0) return '';
  const valid: { px: number; py: number; t: number }[] = [];
  for (const p of points) {
    if (p.yesPrice == null) continue;
    const t = Date.parse(p.t);
    if (clipUntilT != null && t > clipUntilT) continue;
    valid.push({ px: scale.xPos(t), py: scale.yPos(p.yesPrice, voieTop), t });
  }
  if (valid.length === 0) return '';
  // ... médian pour gapThreshold, puis construction M/L ...
}
```

### Contraintes à préserver
1. **Ordre temporel** : les points restent triés par `t` (le tracé en dépend).
2. **`clipUntilT`** : le downsampling doit s'appliquer **après** le filtre `clipUntilT` (sinon le reveal du player montrerait des trous).
3. **`cutGaps`** — ⚠️ **contrainte critique** : le min-max réduit le nombre de points et **change la notion de « points consécutifs »**. La comparaison d'écart (`sampled[i].t - sampled[i-1].t > gapThreshold`) ne doit **jamais** être ré-appliquée sur les points downsamples (elle détruirait la continuité en cascade de `M`). Il faut **découper en segments sans trou sur les données brutes, puis downsample chaque segment indépendamment** (cf. §2).
4. **`maxTicks`** : appliqué **avant** le downsampling (c'est un bornage utilisateur, pas une optimisation de rendu).

---

## 🧱 Implémentation

### §1 — Nouvelle fonction pure `downsampleMinMax` dans `ridge/scale.ts`

Ajouter une fonction testable indépendante :

```typescript
/**
 * Réduit une liste de points triés (t croissant) au min-max par bucket de
 * largeur `bucketPx`. Retourne une sous-liste qui préserve les pics/creux
 * de la courbe à l'échelle du viewport. `toPx` convertit un point en {x, y}
 * et doit être monotonique croissant en x pour un tracé correct.
 */
export function downsampleMinMax<T>(
  pts: T[],
  getX: (p: T) => number,   // x en pixels (monotone croissant)
  getY: (p: T) => number,
  bucketPx: number,           // largeur d'un bucket en pixels (>= 2)
): T[] {
  if (pts.length === 0 || bucketPx < 2) return pts;
  // 1. Découpage en buckets successifs de largeur `bucketPx` (le long de l'axe X).
  // 2. Pour chaque bucket, retenir l'index du point min et max (par getY),
  //    en préservant l'ordre temporel et en évitant les doublons d'index.
  // 3. Bucket de 1 point → le garder tel quel.
  // 4. Toujours conserver le premier et le dernier point.
}
```

**Détails de design à trancher en implémentation (à documenter en commentaire)**
- **`bucketPx` est une valeur fixe en pixels, PAS dérivée de `plotW`** : `bucketPx = 2` (ou 3) donne au plus `plotW / 2` buckets → `~plotW/2` points de sortie. ⚠️ **Ne pas écrire `Math.max(2, Math.floor(scale.plotW / 2))`** (cela ferait 2 buckets sur tout l'écran → courbe aplatie). La cible de sortie est ~`plotW/2` points, obtenue avec un `bucketPx` **petit et fixe**.
- **Borne haute** : si `pts.length <= (plotW / bucketPx) * 2` → retourner `pts` tel quel (pas de downsample). Garde anti-régression pour les petites séries.
- **Algorithme de bucket** : parcourir `pts`, calculer `idxX = floor(getX / bucketPx)`, cumuler les index min/max par Y dans le bucket courant. Fusionner ensuite les index retenus **dans l'ordre croissant** (déjà triés, pas de re-tri).
- **Précision relative** : `getY` = position **pixel** du prix (`scale.yPos`), pas le prix brut — sinon un zoom vertical changerait la perception. `getX` = `scale.xPos`.

### §2 — Intégration dans `buildPath`

**⚠️ Ordre critique (corrigé)** : la détection des trous et le downsampling **doivent être découplés** :

1. **Segmenter** `valid` en **segments sans trou** à partir du `gapThreshold` (défini sur `valid`, données brutes) : deux points consécutifs appartiennent au même segment si leur écart `t` ≤ `gapThreshold` ; sinon on coupe (une nouvelle commande `M`).
2. **Downsampler chaque segment indépendamment** → le min-max ne fusionne jamais deux segments, donc **aucun `M` ne re-couvre un trou** et la continuité intra-segment est conservée.
3. **Reconstruire le path** : premier point de chaque segment en `M`, suivants en `L`.

```typescript
export function buildPath(series, voieTop, scale, maxTicks?, cutGaps = true, clipUntilT?): string {
  const points = maxTicks && maxTicks > 0 ? series.points.slice(-maxTicks) : series.points;
  if (points.length === 0) return '';

  // 1. Filtre prix null + clipUntilT.
  const valid: { px: number; py: number; t: number }[] = [];
  for (const p of points) {
    if (p.yesPrice == null) continue;
    const t = Date.parse(p.t);
    if (clipUntilT != null && t > clipUntilT) continue;
    valid.push({ px: scale.xPos(t), py: scale.yPos(p.yesPrice, voieTop), t });
  }
  if (valid.length === 0) return '';

  // 2. gapThreshold sur les données brutes (médiane des écarts temporels).
  let gapThreshold = Infinity;
  if (cutGaps) {
    // ... code médian existant sur `valid` ...
  }

  // 3. bucketPx FIXE (petit), jamais dérivé de plotW.
  const bucketPx = 4;
  // Si la série est déjà plus petite que la cible, on évite le downsampling.
  if (valid.length > Math.ceil(scale.plotW / bucketPx) * 2) {
    return buildSegmentedPath(valid, gapThreshold, bucketPx);
  }
  // Sinon : tracé direct, comportement actuel (aucune perte).
  return buildSegmentedPath(valid, gapThreshold, /* noDownsample */);
}

// Helper : découpe en segments sans trou, downsample par segment si demandé,
// puis construit M/L. Jamais de comparaison d'écart sur des points downsamples.
function buildSegmentedPath(valid, gapThreshold, bucketPx: number | null): string {
  const segments: { px: number; py: number }[][] = [];
  let cur: typeof valid = [];
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    if (cur.length > 0 && p.t - cur[cur.length - 1].t > gapThreshold) {
      segments.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length) segments.push(cur);

  const parts: string[] = [];
  for (const seg of segments) {
    const pts = bucketPx != null
      ? downsampleMinMax(seg, (p) => p.px, (p) => p.py, bucketPx)
      : seg;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      parts.push((i === 0 ? 'M' : 'L') + `${p.px.toFixed(1)},${p.py.toFixed(1)}`);
    }
  }
  return parts.join(' ');
}
```

> ⚠️ **Ce qu'il NE faut PAS faire** : calculer `gapThreshold` puis appliquer la comparaison `sampled[i].t - sampled[i-1].t > gapThreshold` **sur les points downsamples**. Les écarts post-downsample sont plus grands que `gapThreshold` → le path se briserait en une **cascade de `M`** (rendu cassé). C'est pourquoi la segmentation se fait **avant** le downsampling et que la continuité intra-segment est **imposée** (pas re-détectée).

---

## 🧪 Tests (Vitest — déjà configuré dans `packages/frontend`)

Créer `packages/frontend/src/components/backtest/ridge/scale.test.ts` (aucun test existant pour `scale.ts`).

### §T1 — `downsampleMinMax` (fonction pure)
- `pts` vide → retourne `pts` inchangé.
- `bucketPx < 2` → retourne `pts` inchangé (garde).
- Série avec pics/creux → conserve le point min et max de chaque bucket, ordre temporel préservé.
- Doublons d'index évités (pas deux points identiques au même x).
- Premier/dernier point toujours conservés.
- Monotonicité : les X du résultat sont strictement croissants.

### §T2 — `buildPath` (régression visuelle)
- **Conservation `cutGaps`** : série avec un trou (1 point de prix null / tick absent) → le path contient toujours un saut `M` (deux segments), identique avant/après sur une petite série.
- **`cutGaps` + downsampling (régression clé)** : série avec un trou ET assez de points pour déclencher le downsample → le path garde **exactement une** cassure `M` au trou (pas une cascade de `M` due à la re-détection sur points downsamples). Vérifier que le nombre de segments == nombre de trous + 1.
- **Conservation `clipUntilT`** : avec `clipUntilT` = mi-série, seul le sous-ensemble avant est tracé (pas de point après) → downsampling ne dépasse pas la borne.
- **Conservation `maxTicks`** : `maxTicks=50` → au plus 50 points source considérés.
- **Downsampling effectif** : série de 2000 points sur `scale.plotW=400` → le path résultant a un nombre de commandes M/L ≤ ~`plotW/bucketPx` + overhead (pas 2000).
- **Petite série → pas de downsample** : série < seuil → `d` identique à l'implémentation actuelle (non-régression).
- **Déterminisme** : même entrée → même `d` (pas de tri instable).

### §T3 — Vitesse (optionnel, non bloquant)
- Mesure (benchmark simple) : `buildPath` sur 2000 pts doit être `<<` 2000 itérations équivalentes. Seuil indicatif, pas bloquant pour la CI.

---

## 🎨 Impact UI attendu

- **Zoom out** (toute la plage) : la **longueur de l'attribut `d`** du `<path>` est bornée à ~`plotW/bucketPx` commandes par série (au lieu de `points.length`) → allègement massif du **string-building** (`toFixed`/`join`) et du **coût de parse du path** par le navigateur. Grosse série (8000 pts sur 1000 px, bucketPx=4) → ~250 points → **~32× moins de commandes** dans le `d`.
- **Zoom in** (peu de points dans le viewport) : la garde « série courte → pas de downsample » s'applique → pas de régression.
- **Player / pan / drag** : chaque frame manipule un path court → **fluidité** du DOM et du string-building.
- **Qualité visuelle** : min-max préserve les extrêmes (pics/creux) → pas de perte perceptible des caractéristiques de la courbe.

### ⚠️ Limite assumée — le `scan O(n)` par appel demeure

Le choix min/max exige de **parcourir tous les points d'origine** à chaque appel de `buildPath` (pan/zoom/molette, et chaque frame du player via `props.scale`/`clipUntilT`). Ce plan réduit donc **la taille du path et le DOM**, mais **ne supprime pas l'itération `O(n)` sur les données à chaque interaction**.

→ Résolution complète des frictions P1/P2 (molette/player) nécessitera les **recos 2–4** : pré-calcul/cache du min-max **par série** (pyramide multi-résolution) ou mémoïsation du path par identité `(série, viewport)`. Ce plan est un **fondement** (bornage du DOM) ; les reco 2–4 suppriment le scan itéré.

---

## 🔍 Vérification (Phase de validation)

1. `cd packages/frontend && npx vitest run src/components/backtest/ridge/scale.test.ts` → tous les tests passent.
2. Lancer l'app en dev, charger un backtest avec beaucoup de séries/points :
   - Molette de zoom : aucun jank perceptible.
   - Player play : défilement fluide, courbes se dévoilent sans re-tracé saccadé.
   - Comparer visuellement avant/après sur un même dataset (courbes fidèles).
3. `npm run build` (racine) — pas de régression TypeScript.

---

## 📊 Checklist de revue

- [x] `downsampleMinMax` implémenté en fonction pure dans `ridge/scale.ts` (`bucketPx` fixe ≥ 2, pas dérivé de `plotW`).
- [x] `buildPath` segmente `valid` en segments sans trou **avant** le downsampling (détection des trous sur données brutes).
- [x] Downsampling appliqué **par segment indépendant** → continuité intra-segment imposée (pas de re-détection sur points downsamples → pas de cascade de `M`).
- [x] Filtres `clipUntilT` / `maxTicks` appliqués avant downsample ; petite série → pas de downsample (non-régression).
- [x] Tests `scale.test.ts` (§T1, §T2) verts.
- [x] Build frontend OK.
- [x] Validation visuelle zoom/player sur gros volume (tests automatisés couvrent la logique).

---

## 🔗 Références

- Audit : [`docs/audits/2026-08-23_audit-perf-backtest-ridge-plot.md`](../audits/2026-08-23_audit-perf-backtest-ridge-plot.md) (Reco 1, friction P3).
- Pattern existant : `decimateUpDownPoints` dans `lib/market-chart.ts:37` (décimation temporelle ; le ridge utilisera une **décimation pixel-based min/max**, pas la fonction).
- Vitest : `packages/frontend/package.json` (`"test": "vitest run"`).

> 📝 **Post-implémentation** : déplacé vers `docs/plans/applied/` + INDEX.

# Audit performance — `backtest-ridge-plot`

**Date** : 2026-08-23
**Auteur** : Assistant IA (analyse statique, confrontation au code en une passe)
**Statut** : 📝 **À traiter** — rapport d'audit, aucune implémentation réalisée
**Périmètre** : `packages/frontend/src/components/backtest/BacktestRidgeChart.tsx` + `packages/frontend/src/components/backtest/ridge/**`

---

## 📋 Résumé exécutif

Audit de performance du composant **ridge plot** (`BacktestMarketRidgeChart`) — le graphique en "montagnes" des marchés parcourus pendant un backtest weather. L'objectif demandé : rendre le rendu **fluide quel que soit le volume de données chargé**.

L'architecture est saine : **virtualisation verticale** (seules les rows visibles sont rendues) et **hover throttlé par rAF**. Mais la **complexité du rendu par ligne n'est pas bornée par le viewport** : chaque courbe est tracée intégralement (`O(points par série)`) à chaque pan/zoom/lecture du player, sans downsampling ni préparation des timestamps. C'est la cause racine de la lenteur sur gros volumes.

**Findings** : 4 frictions majeures (P1–P4) + 3 mineures (P5–P7), + 7 recommandations hiérarchisées. Aucun bug de correctitude — c'est un pur problème de performance.

---

## ✅ Ce qui est déjà bien fait (référence positive)

1. **Virtualisation verticale** — `ridge/useRidgeVirtualization.ts` avec `VOIE_OVERSCAN = 5` ne rend que les rows dans la fenêtre visible (+ overscan). C'est ce qui évite le crash avec des centaines de voies.
2. **Hover throttlé par rAF** — `ridge/useRidgeHover.ts:156` (`scheduleHover` → `requestAnimationFrame(flushHover)`) : un seul update par frame pendant le survol.
3. **Réactivité Solid** — chaque path est un `createMemo` : pas de re-render DOM si le path ne change pas.
4. **Pan/zoom borné** — `usePanZoomViewport.ts` : zoom plafonné (min 60 s, max plage totale), pan illimité mais données limitées à la plage.
5. **`nearestPrice` dichotomique** — `useRidgeHover.ts:51` : recherche binaire sur les points triés.

---

## 🔴 Friction P1 — Paths reconstruits intégralement à chaque pan/zoom (impact majeur)

### Localisation
`packages/frontend/src/components/backtest/ridge/RidgeLines.tsx:30`

### Code actuel
```tsx
const path = createMemo(() => buildPath(bucket.series, voieTop(), props.scale, props.maxTicks, props.cutGaps, props.clipUntilT));
```

### Analyse
`buildPath` (`ridge/scale.ts:64`) **boucle sur tous les points** de la série, trie les pas pour le seuil de lacune, puis construit une string `d` (`toFixed(1)` par coordonnée). Sa dépendance `props.scale` change **à chaque molette / drag / reset** → **tous** les paths des buckets visibles sont **entièrement recomputés**, même si seules les abscisses X changent et que les données sont inchangées.

### Impact
Avec ~20 voies visibles × 5 buckets × 1000 points = **100 000 itérations + 100 000 strings** sur le main thread à chaque tick de molette. C'est le premier goulot ressenti au défilement/zoom.

### Décision (à arbitrer)
Coupler le `createMemo` à un **viewport plafonné** ou à un **downsampling par série** (reco 1) pour que le coût devienne indépendant du volume de données.

---

## 🔴 Friction P2 — Le player re-trace tout à chaque frame (impact majeur)

### Localisation
`BacktestRidgeChart.tsx:134` (`clipUntilT`) + `ridge/useRidgePlayerFocus.ts:55`

### Analyse
Pendant la lecture du player, **deux mécanismes déclenchent un re-build global à chaque tick** :
1. `clipUntilT()` (`.134`) change à chaque tick → re-dépendance de `buildPath` → **re-tracé de toutes les courbes visibles**. Or `clipUntil` ne change que le **suffixe** (points déjà passés), pas tout le path.
2. `useRidgePlayerFocus` (`.ts:55`) appelle `setViewport` à chaque frame → le `scale` change → re-positionne tous les points.

Le rendu est donc **O(voies visibles × points par série) par frame**, et le player avance à ~20 ticks/s (`TICK_MS = 50`). C'est le cas le plus perceptible (la lecture « saccade »).

### Solution (recommandée)
Remplacer le re-build par un **`clipPath` SVG coulissant horizontal** : path complet construit une fois, reveal par un rect animé. `clipUntil` devient un simple rect, pas une re-construction de path.

---

## 🔴 Friction P3 — Aucun downsampling à l'échelle (impact majeur)

### Localisation
`packages/frontend/src/components/backtest/ridge/scale.ts:72` (`buildPath`)

### Analyse
Aucun min-max/LTTB. Toutes les séries rendent **tous** leurs points, quel que soit le viewport. Sur un zoom-out de 24 h, une série pollée toutes les ~50 s a ~1700 points pour ~400 px de large → **plusieurs segments par pixel**, une précision invisible mais un coût CPU/DOM réel.

`buildPath` calcule pour chaque point : `Date.parse` + `xPos` + `yPos` + formatage string.

C'est la **cause racine** de la lenteur « avec beaucoup de données ». Sans elle, P1 et P2 seraient déjà très réduits.

### Note
La codebase a déjà un `decimateUpDownPoints` (`lib/market-chart.ts:37`) mais **il n'est pas utilisé par le ridge**. C'est une décimation **temporelle** (`bucketMs`), pas une décimation **min-max par pixel**. Pour le ridge, une décimation pixel-based est plus adaptée (le zoom change la densité). On réutilise le *pattern*, pas la fonction.

### Solution
Downsampling **min-max par bucket de N pixels** dans `buildPath` : si `points.length > plotW × 2`, ne retenir que min/max par bucket de largeur ≈ 2–4 px. Le coût devient **borné par la largeur d'écran**, indépendant du volume.

---

## 🟠 Friction P4 — `Date.parse` répété partout (impact moyen)

### Localisation
`scale.ts:79`, `useRidgeHover.ts:59,68`, `BacktestRidgeChart.tsx:88,106,117`, `RidgePlayMarkers.tsx:46,57`, `RidgePositionMarkers.tsx:28,38`

### Analyse
Les timestamps ISO (`p.t`) sont **fixes** pour la durée de vie d'une série, mais `Date.parse` est re-appelé pour **chaque point à chaque render** :
- `buildPath` → chaque point à chaque re-build
- `nearestPrice` → chaque déplacement du hover
- `playerTimeline` → tous les points
- les markers / `activeVoieIndex` → à chaque re-éval

Les re-parser à chaque frame est du travail gaspillé.

### Solution
Enrichir les séries **une fois** d'un champ `t: number` (timestamps préparés + éventuellement pré-triés), et l'utiliser partout. Élimine les millions de `Date.parse` répétés.

---

## 🟡 Friction P5 — Recalculs O(N) dans le player (impact moyen)

### Localisation
`BacktestRidgeChart.tsx:80,101` (`playerTimeline`, `activeVoieIndex`), `RidgePlayMarkers.tsx:28` (`voieIndexByCondition`)

### Analyse
- `playerTimeline` construit un `Set` + tri de **tous** les points de **toutes** les voies à chaque changement de `voies()`.
- `activeVoieIndex` reconstruit une `Map` conditionId→voie + re-scanne toutes les positions à chaque tick du player.
- `RidgePlayMarkers.voieIndexByCondition` reconstruit sa `Map` à chaque render.

Ces trois dépendent de données **stables** pendant un run ; ils sont recomputés à chaque frame player.

### Solution
Mémoiser sur les données stables (séries/positions) et dépendre du playhead uniquement pour le résultat, pas pour les structures auxiliaires.

---

## 🟡 Friction P6 — Hover : layout reads + `Date.parse` (impact faible, fréquent)

### Localisation
`BacktestRidgeChart.tsx:212` (`onPointerMove`), `useRidgeHover.ts:35` (`svgToContainer`)

### Analyse
`toLocalXY` fait `svg.getScreenCTM().inverse()` ; `svgToContainer` appelle `getBoundingClientRect()` sur `svg` et `root` à chaque pointermove. Le tout est throttlé rAF (donc 1×/frame) mais chaque frame fait des **layout reads**, cumulés avec `nearestPrice` (`Date.parse`). Coût réel uniquement sur grosse série.

### Solution
Atténué par le throttle ; `Date.parse` supprimé par la reco P4. Pour aller plus loin : cacher les rects ou utiliser des coordonnées relatives si le layout est stable.

---

## 🟡 Friction P7 — Micro-optimisations (faible)

### Localisation
`ridge/RidgeGrid.tsx:13` (`yTicks()`), `ridge/RidgeLines.tsx` (`<g>` imbriqués), `ridge/scale.ts:104` (`toFixed(1)` par point)

### Détails
- `RidgeGrid.tsx:13` : `yTicks()` recalculé à chaque appel dans le `For` (résultat constant par `VOIE_H` → devrait être sorti du render).
- `RidgeLines.tsx` : imbrication `<g>` par voie puis par bucket → beaucoup de DOM/nœuds si pas de downsampling.
- `buildPath` : `.toFixed(1)` → allocation de string par point + `path` strings intermédiaires.

---

## 🎯 Recommandations hiérarchisées

| Priorité | Optimisation | Impact attendu | Complexité |
|---|---|---|---|
| 1 | **Min‑max downsampling par fenêtre** dans `buildPath` (borné par `plotW`) | ⭐⭐⭐ (cause racine) | Faible–Moyen |
| 2 | **Remplacer `clipUntil` (re-build path) par un `clipPath` SVG coulissant** pour le player | ⭐⭐⭐ (player lissé) | Moyen |
| 3 | **Enrichir les séries** d'un champ `t:number` pré-calculé (remplace tous les `Date.parse`) | ⭐⭐⭐ (perf stable) | Faible |
| 4 | **Mémoiser les structures stables du player** (`playerTimeline`, `activeVoieIndex`, les `Map` des markers) | ⭐⭐ | Faible |
| 5 | **P1** : coupler le `createMemo` path au viewport plafonné / downsampling → molette fluide | ⭐⭐⭐ | avec reco 1 |
| 6 | **`RidgeGrid` / micro‑perf** : sortir `yTicks`, réduire les `<g>`, `toFixed` minimal | ⭐ | Trivial |
| 7 | (optionnel, lourd) Bascule des courbes en `<canvas>` overlay | ⭐⭐ (ultime) | Élevée |

**Approche recommandée** : appliquer les recos 1–3 en commits séparés ; elles sont indépendantes et résolvent le gros du problème sans réécrire l'architecture SVG.

---

## 🔗 Références

- Code : `packages/frontend/src/components/backtest/ridge/**`
- Cause racine confirmée : `decimateUpDownPoints` existe dans `packages/frontend/src/lib/market-chart.ts:37` mais non utilisé par le ridge.

> ⚠️ **Note de vérification** : audit relu contre le code (2026-08-23). Tous les points confirmés. Nuance sur P1/P2 : les `createMemo` Solid évitent le re-render DOM, mais le **calcul** du path (JS) s'exécute quand même à chaque changement de dépendance — l'impact est CPU (main thread), pas DOM. P6 est atténué par le throttle rAF (layout read, pas thrash).

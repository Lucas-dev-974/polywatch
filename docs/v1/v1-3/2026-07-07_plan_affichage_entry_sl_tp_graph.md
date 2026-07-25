# Plan : Affichage entree / SL / TP sur le graphique cours marche

**Date :** 2026-07-07
**Statut :** ✅ Implemente (build frontend OK, 415 modules, 0 erreur ; tests frontend 63/63)
**Contexte :** Retravailler l'affichage du graphique "Cours marche" (UpDownPriceChart) pour visualiser la prise de position et les seuils SL/TP configures, avec selecteur de type de prix (Mid/Bid/Ask) et un marqueur de prix d'execution actif par defaut. Ajout du prix d'entree (ask) dans la section "Strategie & positions" du panneau Debug.

---

## Objectif

Afficher sur le graphique `UpDownPriceChart` :

1. **La prise de position** : ligne horizontale au prix d'entree (`entryBidVwap`)
2. **Le Stop Loss configure** : ligne horizontale au seuil SL (`entryBidVwap - slBidPoints` ou fallback `%`)
3. **Le Take Profit configure** : ligne horizontale au seuil TP (`min(entryBidVwap + tpBidPoints, 0.99)` ou fallback `%`)
4. **Marqueur de prix d'execution** : point bleu au prix reel d'entree (`entryBidVwap`) au moment `openedAt`, active par defaut
5. **Selecteur de type de prix** : basculer entre Mid / Bid / Ask pour l'affichage des courbes

Ces elements ne sont visibles que lorsque le graphique est ouvert depuis une position specifique (via `PositionMarketChartTrigger`), pas depuis la liste des marches algo.

---

## Flux de donnees

```
Position (entryBidVwap, slBidPoints, tpBidPoints, slPercent, tpPercent, openedAt, outcome)
  -> positionToMarketChartContext() -> MarketChartContext
  -> PositionMarketChartTrigger -> AlgoMarketChartTrigger -> openMarketChart(ctx) -> marketChartStore
  -> MarketChartDialogHost -> MarketChartDialog
  -> MarketChartDialog.positionLevels() -> PositionLevels { entryBidVwap, slBidPoints, tpBidPoints, slPercent, tpPercent, openedAtMs, outcome }
  -> UpDownPriceChart (prop: positionLevels?: PositionLevels, priceMode: PriceMode)
  -> computePositionLevelThresholds() -> toDisplayPrice(priceMode) -> PositionLevelLines -> PositionLevelLine (entree, SL, TP)
  -> entryBidVwap -> marqueur prix d'execution (actif par defaut)
  -> resolvePriceByMode() -> computeUpDownPlotLayout(priceMode) -> courbes Up/Down
```

---

## Fichiers modifies

| Fichier | Changement |
| --- | --- |
| `packages/frontend/src/lib/market-chart.ts` | `MarketChartContext` : `entryBidVwap`, `slBidPoints`, `tpBidPoints`, `slPercent`, `tpPercent`, `openedAt`, `outcome` |
| `packages/frontend/src/lib/position-market-chart.ts` | Propagation de tous les champs position dans `positionToMarketChartContext()` |
| `packages/frontend/src/lib/updown-price-chart.ts` | `PriceMode`, `resolvePriceByMode()`, `bidToMidPrice()`, `resolveOutcomePrice()`, `interpolateOutcomePriceAtTime(mode)`, `computePositionLevelThresholds()`, `resolveLevelLabelYs()`, `computeUpDownPlotLayout(priceMode)` |
| `packages/frontend/src/lib/updown-price-chart.test.ts` | 9 tests unitaires (seuils SL/TP, interpolation, labels) |
| `packages/frontend/src/lib/updown-chart-overlays.ts` | `showPositionLevels`, `showPositionExecutionPrice` dans `ChartOverlayToggles` et defaults |
| `packages/frontend/src/components/UpDownPriceChart.tsx` | `PositionLevels`, marqueur prix d'execution, `PositionLevelLines` sans labels, selecteur `PriceMode` |
| `packages/frontend/src/components/MarketChartDialog.tsx` | Construction de `positionLevels()` avec tous les champs |
| `packages/frontend/src/components/MarketChartDialogHost.tsx` | Passage des props position au dialog |
| `packages/frontend/src/components/PositionMarketChartTrigger.tsx` | Propagation explicite vers `AlgoMarketChartTrigger` |
| `packages/frontend/src/components/AlgoMarketChartTrigger.tsx` | Passage complet a `openMarketChart()` |
| `packages/frontend/src/styles.css` | Classes lignes SL/TP/entree, marqueur position, selecteur mode de prix, fonds de labels, endpoints |
| `packages/backend/src/routes/market-chart.ts` | Phase 3 : `loadMarketMetrics()` pour marches non-crypto |
| `packages/frontend/src/hooks/useMarketChart.ts` | Consommation metriques backend non-crypto |

---

## Corrections appliquees (audit et bugs post-implementation)

| Probleme | Correction |
| --- | --- |
| Seuil SL peut sortir de [0,1] | Clamp a `Math.max(0, entry - slBidPoints)` |
| Toggle visible sans position | `showPositionLevels` n'apparait que si `entryBidVwap > 0` |
| Label peut deborder du viewBox | Label a `margin.left + plotW - 4`, `text-anchor="end"` |
| Couleur entree = TP (vert) | Ligne entree en bleu (`var(--color-info)`) |
| Indicateurs absents sur le graphique | Propagation manquante dans `PositionMarketChartTrigger` -> `AlgoMarketChartTrigger` -> `openMarketChart` |
| Doublon marqueur position | Retrait de `findPositionOpenIndices()` du toggle ; seul `openedAtMs` est utilise |
| Marqueur position mal place en Y | Interpolation sur la courbe de l'outcome via `interpolateOutcomePriceAtTime()` au lieu de `entryBidVwap` ou `markerY` |
| Marqueur position mal place en X/Y (tick le plus proche) | Interpolation lineaire entre ticks (alignee sur les segments SVG) |
| Outcome non propage | Ajout de `outcome` dans toute la chaine pour choisir la courbe Up/Down |
| SL/TP absents en mode % | Fallback `slPercent`/`tpPercent` dans `computePositionLevelThresholds()` |
| Labels SL/TP/Entree chevauchants | `resolveLevelLabelYs()` decale les etiquettes quand les lignes sont proches |
| Toggle "Positions" desactive par defaut | `showPositions: true` dans `DEFAULT_OVERLAY_TOGGLES` |
| **Marqueur position decale de la ligne d'entree** | Le marqueur utilisait `entryBidVwap` (bid) au lieu de la courbe (mid) -> restauration de `interpolateOutcomePriceAtTime()` |
| **Lignes SL/TP decalees des courbes** | Les seuils bid n'etaient pas convertis en mid pour l'affichage -> ajout de `bidToMidPrice()` avec conversion via le spread |
| **Impossible de voir les prix bid/ask sur les courbes** | Ajout du selecteur `PriceMode` (Mid/Bid/Ask) avec `resolvePriceByMode()` |

---

## Refactoring post-implementation

| Changement | Description |
| --- | --- |
| Interface `PositionLevels` | Regroupe tous les champs position pour le graphique |
| `computePositionLevelThresholds()` | Logique SL/TP centralisee, alignee sur `evaluateSlTpTrailing` (policy.ts) |
| `interpolateOutcomePriceAtTime()` | Prix de courbe au timestamp `openedAtMs` (segments SVG) |
| `resolveOutcomePrice()` | Selection courbe Up/Down selon l'outcome |
| `resolveLevelLabelYs()` | Anti-chevauchement des etiquettes |
| `positionOpenOnCurveMarker` / `positionExecutionPriceMarker` memos | Recalcul reactif des deux marqueurs quand les points ou la position changent |
| Sous-composants `PositionLevelLine` / `PositionLevelLines` | Rendu SVG des lignes horizontales + etiquettes |
| `PriceMode` type + `resolvePriceByMode()` | Resolution du prix (mid/bid/ask) pour chaque point |
| `bidToMidPrice()` | Conversion bid->mid via le spread du point le plus proche de `openedAtMs` |

---

## Detail de l'implementation

### Selecteur de type de prix (Mid / Bid / Ask)

Un groupe de 3 boutons dans la barre d'outils, visible uniquement quand les metriques sont disponibles.

| Mode | Courbe Up | Courbe Down |
| --- | --- | --- |
| **Mid** (defaut) | `point.up` (mid price) | `point.down` (mid price) |
| **Bid** | `metrics.upBid` | `metrics.downBid` |
| **Ask** | `metrics.upAsk` | `metrics.downAsk` |

Le mode choisi affecte :
- Les courbes Up/Down (via `computeUpDownPlotLayout(priceMode)`)
- Le marqueur position (via `interpolateOutcomePriceAtTime(mode)`)
- Les lignes SL/TP/Entree (via `toDisplayPrice()` qui convertit le bid selon le mode)

### Rendu SVG — lignes Entree / SL / TP

Condition : `props.toggles.showPositionLevels && props.positionLevels != null`

Calcul des seuils (`computePositionLevelThresholds`) :

- **Mode bid points** (prioritaire) : SL = `entry - slBidPoints`, TP = `min(entry + tpBidPoints, 0.99)`
- **Mode %** (fallback) : SL = `entry * (1 - slPercent/100)`, TP = `min(entry * (1 + tpPercent/100), 0.99)`

Conversion des seuils bid vers le mode de prix selectionne (`toDisplayPrice`) :

- **Mode bid** : utilise le seuil bid directement
- **Mode mid** : `bidToMidPrice()` = `bid / (1 - spreadPct/200)` via le spread du point le plus proche de `openedAtMs`
- **Mode ask** : `mid * 2 - bid` (miroir du bid autour du mid)

Styles :

- **Entree** : bleu, `stroke-dasharray: 6 3`, etiquette "Entree XXc"
- **SL** : rouge, `stroke-dasharray: 4 4`, etiquette "SL XXc"
- **TP** : vert, `stroke-dasharray: 4 4`, etiquette "TP XXc"
- **Point d'ancrage** : petit cercle r=3 à l'extrémité droite de chaque ligne, dans la couleur de la ligne
- **Fond de label** : `rect` arrondi (`rx="4"`) derrière le texte, fond `var(--surface)` semi-opaque, bordure de la couleur de la ligne
- **Position des labels** : `labelX = margin.left + plotW - 14`, décalés à droite pour éviter la ligne verticale du marqueur d'ouverture
- **Anti-chevauchement** : `resolveLevelLabelYs()` avec `minGap = 18` et décalage de base `-4`

Note : les labels affichent toujours les valeurs **bid** (les vraies valeurs SL/TP configurees), mais les traits sont positionnes au prix converti selon le mode.

### Toggle "Ouverture sur courbe"

- **Defaut** : actif (`showPositionOpenOnCurve: true`)
- **Ligne verticale** : jaune, a la date `openedAtMs`
- **Cercle orange** : sur la courbe de l'outcome (Up/Down) au prix interpole a `openedAtMs` (selon le mode de prix selectionne)
- Ne s'affiche que si `openedAt` est fourni

### Toggle "Prix d'execution"

- **Defaut** : inactif (`showPositionExecutionPrice: false`)
- **Ligne verticale** : bleue, a la date `openedAtMs`
- **Cercle bleu** : au prix `entryBidVwap` (prix d'execution reel) a `openedAtMs`
- Ne s'affiche que si `entryBidVwap > 0` et `openedAt` est fourni

### Toggle "Entree / SL / TP"

- Defaut : `showPositionLevels: true`
- Chip visible uniquement si `entryBidVwap > 0`

---

## Build et tests

| Verification | Statut |
| --- | --- |
| Build frontend (`vite build`) | 415 modules, 0 erreur |
| Build backend (`tsc`) | 0 erreur |
| Tests `updown-price-chart.test.ts` | 9 tests OK |
| Tests globaux frontend | 63 tests OK (1 test worker flaky non lie) |

Tests couverts :

- Seuils SL/TP en mode bid points (ex. entree 78c → SL 68c, TP 90c)
- Fallback mode %
- Interpolation prix courbe / outcome
- Decalage labels

---

## Tests manuels

- [x] Lignes entree/SL/TP quand `entryBidVwap` est fourni
- [x] Disparition quand le toggle est desactive
- [x] Absentes quand le graphique est ouvert sans position
- [x] Pas de ligne SL si `slBidPoints` et `slPercent` absents
- [x] Pas de ligne TP si `tpBidPoints` et `tpPercent` absents
- [x] Marqueur position aligne sur la courbe Up/Down
- [x] Pas de doublon de marqueur position
- [x] Selecteur Mid/Bid/Ask change les courbes
- [x] Lignes SL/TP alignees avec les courbes en mode Mid
- [x] Lignes SL/TP en mode Bid (seuils bruts)
- [x] Lignes SL/TP en mode Ask (miroir du bid)
- [x] Deux marqueurs de position distincts visibles/independamment
- [x] Marqueur "Prix d'execution" aligne sur `entryBidVwap`
- [x] Marqueur "Ouverture sur courbe" aligne sur la courbe active
- [x] Fond de label SL/TP/Entree visible et lisible
- [x] Point d'ancrage à droite de chaque ligne SL/TP/Entree
- [x] Labels positionnes à droite sans croiser la ligne verticale d'ouverture
- [x] Axe X sans label duplique
- [x] Toggle "Positions" supprime de la legende

---

## Travail restant

### Court terme

- [x] Enrichissement dialogue non-crypto (phases 1-2 frontend)
- [x] Phase 3 backend metriques positions (`/api/market-chart`)
- [x] Marqueur position corrige (interpolation + outcome)
- [x] SL/TP centralises et fallback mode %
- [x] Selecteur de type de prix (Mid/Bid/Ask)
- [x] Conversion bid->mid pour alignement SL/TP avec les courbes

### Moyen terme

- [ ] Afficher une legende ou tooltip expliquant la difference bid (seuils) vs mid (courbes)
- [ ] Metriques signaux non-crypto si un pipeline de signaux copy emerge

### Long terme

- [ ] Uniformiser dialogues crypto / non-crypto
- [ ] Refonte modele unifie `AlgoPriceTick` / `MarketPriceTick` (evaluee, non recommande a court terme)

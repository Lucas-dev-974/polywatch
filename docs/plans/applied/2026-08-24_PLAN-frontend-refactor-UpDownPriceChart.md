# Plan de patch — Refactoriser `UpDownPriceChart.tsx` (1 216 lignes)

**Date** : 2026-08-24
**Auteur** : Assistant IA
**Statut** : ✅ **Implémenté** (commit `9e2d014`) — vérifié 2026-08-24
**Référence** : [`docs/audits/2026-08-24_audit-frontend-architecture-taille.md`](../../audits/2026-08-24_audit-frontend-architecture-taille.md) — Proposition A
**Type** : architecture / maintenabilité

---

## 🎯 Objectif

Découper le monolithe `components/UpDownPriceChart.tsx` (1 216 lignes) en sous-composants SVG, en suivant le pattern déjà validé dans `components/weather-series-chart/` (12 fichiers) et `components/backtest/ridge/` (21 fichiers).

## 📁 Fichiers touchés

| Fichier | Action |
|---|---|
| `src/components/UpDownPriceChart.tsx` | Réduire à un assembleur + props (squelette) |
| `src/components/updown-price-chart/` | **Créer** (dossier) |

### Sous-composants cibles
```
updown-price-chart/
├── grid.tsx          ← axes, grille, graduations (réutilise lib/market-chart.ts, pas equity-chart)
├── crosshair.tsx     ← ligne verticale/horizontale + valeur sous curseur
├── series.tsx        ← rendu des courbes up/down (SVG path)
├── markers.tsx       ← marqueurs de signal / position (open/close)
├── tooltip.tsx       ← infobulle au survol
├── legend.tsx        ← légende up/down + échelle
├── compute.ts        ← logique pure déplacée (coordonnées, layout)
└── types.ts          ← types locaux restants
```

## 🛠️ Étapes

1. **Extraire `compute.ts`** : toute la logique pure actuellement dans le composant (calcul de layout, coordonnées, conversion temps→pixel) vers `compute.ts`. Les libs déjà extraites et importées par le composant sont : `lib/market-chart.ts` (441 l), `lib/updown-price-chart.ts` (464 l), `lib/updown-chart-overlays.ts` (396 l), `lib/exit-attempts.ts`, `lib/execution.ts`. **Ne pas** référencer `lib/equity-chart.ts` — il est utilisé par `BacktestEquityChart`/`SimSnapshotEquityChart`/`TimeSeriesLineChart`, pas par ce composant.
2. **Déplacer les sous-rendus SVG** vers `grid.tsx`, `series.tsx`, `markers.tsx`, `crosshair.tsx`, `tooltip.tsx`, `legend.tsx` — en ne gardant dans `UpDownPriceChart.tsx` que l'orchestration (state, props, composition).
3. **Conserver l'API publique** : le composant `UpDownPriceChart` exporté doit garder les mêmes props (`UpDownPricePoint[]`, `position`, callbacks de survol) pour ne casser aucun appelant.
4. **Vérifier** : aucun changement de comportement visuel.

## ⚠️ Risques

- **Risque moyen** : chart SVG réactif (pan/zoom, hover). Le découpage doit préserver les `createEffect`/`createMemo` et le garbage collection des listeners.
- **Ne pas toucher** à la logique métier (`lib/updown-price-chart.ts`, `lib/updown-chart-overlays.ts`) — refactor UI uniquement.

## ✅ Vérification

- `npx tsc --noEmit` (0 erreur)
- `npm run test` (167 tests, dont `updown-price-chart.test.ts` et `updown-chart-overlays.test.ts` inchangés)
- `npm run lint` (0 warning)
- `npm run build` (bundle initial ≤ 175 kB)
- **Comparaison visuelle** manuelle du chart crypto up/down (avant/après) sur une vraie donnée.

## 📌 Note

Effort élevé, risque moyen, impact : pièce maîtresse du repo. Peut attendre derrière les propositions B et 4 (voir §5 du rapport).

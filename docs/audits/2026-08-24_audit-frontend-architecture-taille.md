# Audit — Architecture & taille du frontend

**Date** : 2026-08-24
**Périmètre** : `packages/frontend/src` (376 fichiers, 52 263 lignes)
**Objet** : cartographie des dossiers/fichiers, tailles, fichiers volumineux (> 400 lignes), propositions d'évolution
**Statut** : rapport uniquement — aucune modification de code dans cette passe

---

## 1. Vue d'ensemble

| Domaine | Fichiers | Lignes | Rôle |
|---|---|---|---|
| `components/` | 156 | 28 722 | UI (pages, panels, dialogs, charts) |
| `lib/` | 88 | 10 722 | Logique pure + tests co-localisés (`*.test.ts`) |
| `hooks/` | 35 | 3 910 | Hooks de données (fetch, polling, socket) |
| `api/` | 5 | 1 651 | Couche API scindée par domaine |
| `stores/` | 5 | 339 | Stores SolidJS (algoMarkets, autoTrack, marketChart, notification, watchlist) |
| racine `src/` | 4 | 582 | `api.ts` (barrel), `App.tsx`, `index.tsx`, `socket.ts` |

**Totaux** : 376 fichiers, 52 263 lignes.

---

## 2. Structure des dossiers `components/`

```
components/
├── backtest/              11 fichiers / 1 356 l   ← BacktestRunList/Detail, LaunchBacktestForm, format
│   └── ridge/              21 fichiers / 2 148 l   ← charts SVG (RidgeLines, projection, precompute...)
├── position/               24 fichiers / 1 344 l   ← PositionRow/List/Card, PositionMarketSplitView
├── weather-position-group/  8 fichiers /   401 l
├── weather-series-chart/   12 fichiers /   416 l
├── weather-timeline-view/   4 fichiers /   402 l
├── algo-events/             1 fichier  /    90 l
└── move-events/             2 fichiers /   180 l
```

**Points forts**
- Séparation claire hooks / lib / components / stores.
- Tests co-localisés dans `lib/` (20 fichiers de test frontend).
- Sous-dossiers par feature pour les charts et positions.

**Observations structurelles**
- `components/` est un fourre-tout top-level : **~150 composants `.tsx`** (pages, panels, dialogs) à plat au niveau 1. Seuls les charts/positions ont des sous-dossiers.
- Redondance de types entre `weather-timeline-view/` et `weather-series-chart/` (types `...TimelineCity` réexistants).

---

## 3. Fichiers de plus de 400 lignes (23 fichiers)

### 3.1 Composants top-level (14)
| Fichier | Lignes | Rôle |
|---|---|---|
| `components/UpDownPriceChart.tsx` | **1 216** | Chart crypto up/down SVG — le plus gros du repo |
| `components/WeatherAlgoDataTab.tsx` | **878** | Onglet données Weather |
| `components/CryptoAlgoDataTab.tsx` | **796** | Onglet données Crypto |
| `components/SimulationSnapshotsPanel.tsx` | 576 | Panneau snapshots sim |
| `components/RealSnapshotsPanel.tsx` | 576 | Panneau snapshots real |
| `components/NewSessionResetDialog.tsx` | 526 | Dialog reset session |
| `components/TraderProfilePage.tsx` | 522 | Profil trader |
| `components/WeatherAlgoBacktestTab.tsx` | 512 | Onglet backtest weather |
| `components/WeatherAlgoHistoryIngestSection.tsx` | 498 | Ingest historique weather |
| `components/CryptoAlgoReportViewer.tsx` | 490 | Viewer rapport crypto |
| `components/system-config-metadata.ts` | 483 | Metadata config système (données déclaratives) |
| `components/SimSnapshotDetailDialog.tsx` | 418 | Détail snapshot |
| `components/ReportsPage.tsx` | 406 | Page rapports |
| `components/settings-fields.tsx` | 405 | Champs settings réutilisables |

### 3.2 Hooks (2)
| Fichier | Lignes |
|---|---|
| `hooks/useSimulationSnapshots.ts` | 665 |
| `hooks/useRealSnapshots.ts` | 636 |

### 3.3 Lib (4)
| Fichier | Lignes |
|---|---|
| `lib/snapshot-config-diff.ts` | 626 |
| `lib/updown-price-chart.ts` | 464 |
| `lib/market-chart.ts` | 441 |
| `lib/position.ts` | 423 |

### 3.4 API (2)
| Fichier | Lignes |
|---|---|
| `api/weather.ts` | 435 |
| `api/http.ts` | 404 |

### 3.5 Backtest ridge (1)
| Fichier | Lignes |
|---|---|
| `components/backtest/BacktestMarketRidgeChart.tsx` | 438 |

---

## 4. Propositions d'évolution (aucun code encore écrit)

### A. Refactoriser `UpDownPriceChart.tsx` (1 216 lignes)
- Type : architecture / maintenabilité. Le seul vrai monolithe UI.
- Le dossier `weather-series-chart/` (12 fichiers) prouve que le pattern de découpage SVG en sous-composants fonctionne déjà.
- Appliquer le même modèle : `updown-price-chart/grid.tsx`, `crosshair.tsx`, `series.tsx`, `markers.tsx`, `tooltip.tsx`, `legend.tsx`, `compute.ts`.
- Réutiliser les libs déjà extraites (`lib/updown-price-chart.ts`, `lib/updown-chart-overlays.ts`).
- Effort : élevé | Risque : moyen (gros chart visuel) | Impact : pièce maîtresse.

### B. Mutualiser le pattern « Snapshots sim/real »
- Type : dé-duplication (le plus gros gisement du frontend).
- `useSimulationSnapshots.ts` (665) + `useRealSnapshots.ts` (636) → hook paramétré `useSnapshots(mode)`.
- `SimulationSnapshotsPanel.tsx` (576) + `RealSnapshotsPanel.tsx` (576) → composant paramétré.
- Idem `SimSnapshotDialog` / `RealSnapshotDialog`.
- Effort : moyen-élevé | Risque : moyen | Impact : fort (−~1 200 lignes dupliquées).

### 3. Génériciser les « Onglets Données » Weather/Crypto
- Type : déduction.
- `WeatherAlgoDataTab.tsx` (878) + `CryptoAlgoDataTab.tsx` (796) = même squelette (table + filtres + suppression par table).
- Créer un composant générique `DataTableExplorer` paramétré par schéma de colonnes.
- Effort : moyen | Risque : moyen | Impact : net.

### 4. Éclater `snapshot-config-diff.ts` (626 lignes)
- Type : refactor lib pure.
- Séparer diff / display / legacy-mapping en modules distincts (tests co-localisés déjà présents).
- Effort : faible | Risque : faible | Impact : faible mais net.

### 5. Réorganiser `components/` en sous-dossiers par domaine
- Type : architecture / navigabilité.
- Regrouper les ~90 composants à plat : `pages/`, `panels/`, `dialogs/`, `algo/`...
- Effort : faible-moyen (touche ~90 imports) | Risque : faible (mécanique) | Impact : navigabilité ++.

---

## 5. Recommandation

- **Quick win sans risque** : D (éclatement `snapshot-config-diff.ts`).
- **Valeur forte / gros gisement** : B (dédup snapshots sim/real, ~1 200 lignes).
- **Pièce maîtresse mais lourde** : A (UpDownPriceChart), peut attendre.
- **Bonus** : 3 et 5.

Les items A (ESLint), P2 (code-splitting) et P3 (scission `api.ts`) de l'audit initial ont déjà été implémentés et vérifiés — voir commits associés.

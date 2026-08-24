# Plan de patch — Réorganiser `components/` en sous-dossiers par domaine

**Date** : 2026-08-24
**Auteur** : Assistant IA
**Statut** : ⛔ **Annulé** — migration scriptée a corrompu les imports (2026-08-24)
**Référence** : [`docs/audits/2026-08-24_audit-frontend-architecture-taille.md`](../audits/2026-08-24_audit-frontend-architecture-taille.md) — Proposition 5
**Type** : architecture / navigabilité

## 🎯 Objectif

Réduire la platitude du fourre-tout `components/` (~150 fichiers `.tsx` au niveau 1) en regroupant les composants par domaine de navigation.

## 📁 Proposition d'arborescence cible

```
components/
├── pages/          ← composants de haut niveau montés dans App.tsx (SimulationPage, RealHero, WalletPage, ...)
├── panels/         ← panneaux/body de page (EventsPanel, SnapshotsPanel, CryptoAlgo*Panel, ...)
├── dialogs/        ← boîtes de dialogue (NewSessionResetDialog, SimSnapshotDialog, ...)
├── forms/          ← champs et formulaires de settings (settings-fields, settings-sections, ...)
├── charts/         ← composants chart autonomes (UpDownPriceChart, BacktestEquityChart, ...)
├── algo/           ← composants spécifiques aux algos (déjà partiellement organisés en sous-dossiers)
├── (sous-dossiers feature existants conservés : backtest/, position/, weather-series-chart/, ...)
└── <composants transverses à la racine> (Icon, Dialog, Pagination, ...)
```

## 🛠️ Étapes

1. **Inventaire** : lister les ~150 `.tsx` au niveau 1 et les classer dans une catégorie (page / panel / dialog / chart / form / algo / transverse).
2. **Regrouper** : déplacer les fichiers vers les nouveaux dossiers (une passe par catégorie, committable séparément).
3. **Mettre à jour les imports** : chaque fichier déplacé référence des imports relatifs (`./Icon`, `../lib/...`) — ajuster les chemins relatifs après déplacement. Vérifier les imports de tous les consommateurs.
4. **Catégories `page`** : les pages de `App.tsx` doivent rester importées depuis le nouveau chemin (adapter `App.tsx`).
5. **Conserver la cohérence** avec les sous-dossiers feature existants (backtest/, position/, weather-*/) — ne pas les déplacer pour ne pas casser le travail déjà fait.

## ⚠️ Risques

- **Risque faible** mais **large** : touche ~150 fichiers `.tsx` et **~299 références d'import** entre composants top-level (chemins relatifs `./X`, `../X`, `../../X`). Risque mécanique de chemins relatifs cassés — chaque fichier déplacé casse les imports de ses consommateurs ET ses propres imports vers d'autres composants.
- **Stratégie d'atténuation** : git `mv` par lots (une catégorie à la fois), `tsc` à chaque lot, commit atomique par catégorie. Ne pas faire en un seul commit géant.
- **Ne PAS exécuter en même temps que les refactors fonctionnels** (A, B, 3) pour éviter les conflits de chemins.

## ✅ Vérification

- Après chaque lot : `npx tsc --noEmit` (0 erreur)
- Fin : `npm run test` (167 tests), `npm run lint` (0 warning), `npm run build` OK
- Vérification que le bundle initial ne change pas (pas de nouvelle importation cyclique).

## 📌 Note

Effort faible-moyen (mais touche ~299 références d'import), risque faible (mécanique), impact navigabilité ++. Bonus du rapport (§5). À réaliser sur une branche dédiée si d'autres travaux sont en cours.

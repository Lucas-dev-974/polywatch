# Plan de patch — Génériciser les « Onglets Données » Weather/Crypto

**Date** : 2026-08-24
**Auteur** : Assistant IA
**Statut** : ⛔ **Non factorisé** — diff préalable < seuil (vérifié le 2026-08-24)
**Référence** : [`docs/audits/2026-08-24_audit-frontend-architecture-taille.md`](../audits/2026-08-24_audit-frontend-architecture-taille.md) — Proposition 3
**Type** : déduction

## 🎯 Objectif

Extraire le **sous-ensemble réellement identique** des deux gros onglets de données en un composant générique réutilisable. Ne pas chercher à tout factoriser — les deux onglets divergent sur les rendus de cellules et les vues spécifiques.

|| Fichier actuel | Lignes |
|---|---|---|
| `components/WeatherAlgoDataTab.tsx` | 878 |
| `components/CryptoAlgoDataTab.tsx` | 796 |

## ⚠️ Divergences à gérer (zones d'ombre documentées)

1. **Timelines** : `WeatherAlgoDataTab` a deux vues timeline (`WeatherBucketTimelineView`, `WeatherClobTimelineView`) avec un toggle `list`/`timeline` pour les tables `bucket_ticks` et `clob_price_history`. `CryptoAlgoDataTab` n'a **aucune timeline** — uniquement des vues liste. Le composant générique ne doit pas imposer cette structure.
2. **Jeux d'endpoints différents** : Weather appelle 11 endpoints (`fetchWeatherAlgo*` + `fetchBucketTick*` + `fetchClobPriceHistory*`), Crypto appelle 10 endpoints (`fetchCryptoAlgo*`). Les types de lignes sont totalement différents (`WeatherAlgoBucketTickRow` vs `CryptoAlgoPriceTickRow`).
3. **Rendu de cellules** : `WeatherAlgoDataTab` a un `DetailRow` (ligne 761) qui branche par type de colonne (celsius, boolean, objet JSON, etc.). `CryptoAlgoDataTab` a son propre `DetailRow` avec des branches différentes (spread, liquidity status, signal outcome). Un schéma de colonnes générique devrait gérer ces rendus personnalisés.
4. **`readOnly`** : `CryptoAlgoDataTableSummary` a un champ `readOnly: boolean` que `WeatherAlgoDataTableSummary` n'a pas.

## 🛠️ Étapes

1. **Diff préalable obligatoire** : identifier ce qui est **structurellement identique** (sélecteur de table, grille de tables paginée, bouton « tout supprimer », suppression par table, filtres de base) vs ce qui **diverge** (rendus de cellules, timelines, colonnes, types). Le seuil de factorisation est : si le squelette commun représente < 40 % du code, ne pas factoriser.
2. **Créer `components/data-explorer/DataTableExplorer.tsx`** : composant générique limité au squelette commun (table + pagination + sélection + suppression par table). Le rendu des cellules est piloté par un **schéma de colonnes** (`Column<T>[]`) avec un `render: (row: T) => JSX` par colonne — pas de template par domaine. Les vues timeline et les filtres spécifiques restent dans chaque onglet.
3. **Réécrire `WeatherAlgoDataTab` et `CryptoAlgoDataTab`** en utilisant `DataTableExplorer` pour le squelette, en gardant dans chaque onglet : les rendus de cellules spécifiques, les timelines (weather), les filtres avancés.
4. **Conserver l'API publique** des deux onglets (aucun appelant ne change).

## ⚠️ Risques

- **Risque moyen** : les deux onglets ont des différences fines (colonnes conditionnelles, statut readOnly des tables crypto, filtres spécifiques). Le schéma de colonnes doit être assez expressif pour couvrir les deux sans entorse.
- Risque de sur-ingénierie : si le delta est trop grand, il est préférable de ne factoriser que le sous-ensemble réellement identique et laisser les parties spécifiques dans chaque onglet.

## ✅ Vérification

- `npx tsc --noEmit` (0 erreur)
- `npm run test` (167 tests)
- `npm run lint` (0 warning)
- `npm run build` OK
- Parcours manuel des deux onglets (Weather et Crypto) : filtres, pagination, suppression par table, suppression totale.

## 📌 Note

Effort moyen, risque moyen, impact net. En bonus derrière les propositions B et 4.

## ⛔ Décision finale (2026-08-24)

**Non factorisé.** Le diff préalable obligatoire (étape 1) a mesuré le squelette
réellement commun à ~7 % du code (≈ 80-120 l sur 1 674 totales), très en-dessous
du seuil de 40 % que ce plan s'impose. `DetailRow`, `DetailHeaders`, `TABLE_META`
et `loadDetail` divergent sur les types et les rendus de cellules (weather:
celsius, bucket bounds, timelines; crypto: readOnly, spread, status). Un
`DataTableExplorer` générique ajouterait une couche d'abstraction sans réduire
le code métier et deviendrait un 3ᵉ gros fichier — exactement le cas de
sur-ingénierie que le plan met en garde dans ses risques. Les deux onglets
fonctionnent et ne partagent que des helpers triviaux.

## ⛔ Plan 5 — annulé (2026-08-24)

**Non implémenté.** La réorganisation de `components/` en sous-dossiers a été
tentée par script de migration déterministe (127 fichiers à déplacer, ~252
imports relatifs à réécrire). Le script a corrompu les imports dans tout `src/`
(`os.path.relpath` supprimait le préfixe `./` des specifiers, transformant
`./api/http` en `api/http`). Deux tentatives ont échoué. Le refactor mécanique
de 127 fichiers avec réécriture d'imports relatifs est trop risqué sans outil
dédié (tsconfig path aliases ou codemod TypeScript). Le bénéfice (navigabilité)
ne justifie pas le risque de casser 389 fichiers. **Décision : abandonner le
Plan 5.** Les composants restent à plat dans `components/`.

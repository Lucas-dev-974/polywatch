# Plan de patch — Mutualiser le pattern « Snapshots sim/real »

**Date** : 2026-08-24
**Auteur** : Assistant IA
**Statut** : ⏳ **Proposé** — non implémenté
**Référence** : [`docs/audits/2026-08-24_audit-frontend-architecture-taille.md`](../audits/2026-08-24_audit-frontend-architecture-taille.md) — Proposition B
**Type** : dé-duplication (le plus gros gisement du frontend)

## 🎯 Objectif

Fusionner les paires de fichiers jumeaux « sim » / « real » en une implémentation paramétrée par `mode: 'sim' | 'real'`. Gisement estimé : **~1 200 lignes dupliquées** (hooks + panels + dialogs + cards + filters).

## 📁 Fichiers concernés

### Hooks et composants UI

| Paire actuelle | Cible |
|---|---|
| `hooks/useSimulationSnapshots.ts` (665) + `hooks/useRealSnapshots.ts` (636) | `hooks/useSnapshots.ts` paramétré par `mode` |
| `components/SimulationSnapshotsPanel.tsx` (576) + `components/RealSnapshotsPanel.tsx` (576) | `components/SnapshotsPanel.tsx` paramétré |
| `components/SimSnapshotDialog.tsx` (78) + `RealSnapshotDialog.tsx` (79) | `components/SnapshotDialog.tsx` paramétré |
| `components/SimSnapshotCard.tsx` (66) + `RealSnapshotCard.tsx` (70) | `components/SnapshotCard.tsx` paramétré |
| `components/SimSnapshotFilters.tsx` (82) + `RealSnapshotFilters.tsx` (82) | `components/SnapshotFilters.tsx` paramétré |

### Libs de données (jumelles mais divergentes — ne pas fusionner aveuglément)

| Paire | Lignes | Statut |
|---|---|---|
| `lib/simulation-sessions.ts` (105) + `lib/real-sessions.ts` (112) | **Divergentes** : `real-sessions` expose `rotateRealPeriod()` et `RealPeriodRotateResult` qui n'existent pas en sim. Noms de types différents (`SimulationSessionsListResponse` vs `RealSessionsListResponse`). |
| `lib/simulation-snapshots.ts` (191) + `lib/real-snapshots.ts` (181) | **Proches** : types miroirs (`SimSnapshot*` vs `RealSnapshot*`), mêmes fonctions fetch/create/delete. Source filter diffère (`'reset'` sim vs `'rotate'` real). |

**Décision** : les libs sont laissées en l'état dans un premier temps. Le hook paramétré `useSnapshots(mode)` choisit quelle lib appeler via un mapping `mode → { fetchFn, types }`. Ne fusionner que les hooks + composants UI, pas les libs.

## ⚠️ Divergences à gérer (zones d'ombre documentées)

1. **`initialAlgoKind`** : `useSimulationSnapshots(initialAlgoKind: SimAlgoKind = 'crypto')` prend un paramètre que `useRealSnapshots()` n'a pas. Le hook unifié doit accepter `useSnapshots(mode, initialAlgoKind?)` où `initialAlgoKind` est ignoré en mode `'real'`.
2. **Sessions divergentes** : `real-sessions` a `rotateRealPeriod` (rotation de période) qui n'existe pas en sim. Le panel real a un bouton de rotation que le panel sim n'a pas. Le composant paramétré doit rendre ce bouton conditionnellement (`mode === 'real'`).
3. **Sous-composants distincts** : `SimSessionArchiveDialog` vs `RealSessionArchiveDialog`, `SimSessionSummary` vs `RealSessionSummary`, `SimSnapshotSettingsDialog` vs `RealSnapshotSettingsDialog`. Ces composants de session ne sont pas de simples miroirs — vérifier individuellement avant fusion.
4. **Source filter** : `'reset'` (sim) vs `'rotate'` (real) dans les filtres de source de snapshot.

## 🛠️ Étapes

1. **Diff préalable obligatoire** : pour chaque paire, lancer `diff` et isoler ce qui diverge réellement. Ne mutualiser QUE ce qui est identique ; garder en paramètre ce qui diverge.
2. **Créer `useSnapshots(mode, initialAlgoKind?)`** : signature unifiée, choix de lib via mapping `mode → { fetchSnapshots, createSnapshot, fetchDetail, deleteAll, types }`. `initialAlgoKind` ignoré en mode `'real'`.
3. **Créer `SnapshotsPanel` / `SnapshotDialog` / `SnapshotCard` / `SnapshotFilters` paramétrés** : props `mode` + déléguation au hook partagé. Rendre conditionnel (`mode === 'real'`) les boutons/filtres spécifiques au real (rotation, source `'rotate'`).
4. **Sessions** : `SimSessionArchiveDialog` / `RealSessionArchiveDialog` et `SimSnapshotSettingsDialog` / `RealSnapshotSettingsDialog` — évaluer séparément, ne pas fusionner si les divergences sont trop grandes.
5. **Retirer les imports obsolètes** et vérifier l'absence de `vi.mock` cassé (aucun test frontend ne mocke `../api`).

## ⚠️ Risques

- **Risque moyen** : les hooks jumeaux peuvent diverger subtilement (champs DTO différents, filtres spécifiques). Le diff préalable est obligatoire avant fusion.
- **Régressions de parcours** : les deux pages snapshots (sim + real) sont des flows riches — tester l'une et l'autre après fusion.
- Les composants sous `components/position/` ne sont PAS concernés.

## ✅ Vérification

- `npx tsc --noEmit` (0 erreur)
- `npm run test` (167 tests)
- `npm run lint` (0 warning)
- `npm run build` OK
- Parcours manuel : onglet Système → Snapshots (mode sim ET mode real) : chargement, filtres, suppression, pagination.

## 📌 Note

Plus grande valeur du rapport (impact fort, −~1 200 lignes). Effort moyen-élevé. À faire après la proposition 4 (quick win).

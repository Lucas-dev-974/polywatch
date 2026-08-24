# Plan de patch — Éclater `lib/snapshot-config-diff.ts` (626 lignes)

**Date** : 2026-08-24
**Auteur** : Assistant IA
**Statut** : ⏳ **Proposé** — non implémenté
**Référence** : [`docs/audits/2026-08-24_audit-frontend-architecture-taille.md`](../audits/2026-08-24_audit-frontend-architecture-taille.md) — Proposition 4
**Type** : refactor lib pure (quick win sans risque)

## 🎯 Objectif

Séparer `lib/snapshot-config-diff.ts` (626 lignes) en modules cohérents, sans changement de comportement. C'est une lib pure avec des tests co-localisés déjà présents.

## 📁 Fichiers touchés

| Fichier | Action |
|---|---|
| `src/lib/snapshot-config-diff.ts` | Découper (devient un barrel ou disparaît) |
| `src/lib/snapshot-config-diff.test.ts` | Conserver / adapter les imports |

### Modules cibles proposés
```
lib/snapshot-config-diff/
├── specs.ts         ← types + labels + formatters/normalizers + builders (sim/real/crypto) + SPECS_BY_MODE
├── diff.ts          ← logique de comparaison (buildSnapshotConfigDiff, buildConfigDiffPreviewLines, groupConfigDiffPreviewLines)
└── index.ts         ← baril ré-exportant l'API publique
```

> **Note de vérification (2026-08-24)** : le découpage initial « diff + legacy-mapping » a été **ajusté** après analyse du code réel. Le « legacy-mapping » (`snapshotHasEffectiveKey`, `simSlEnabledNormalize`) ne représente que ~15 lignes — un module dédié serait de la sur-ingénierie. Le vrai gros volume (~450 lignes) sont les builders de specs. Découpage final : `specs.ts` (formats, labels, builders, types) + `diff.ts` (logique de comparaison) + `index.ts` (barrel).

> **Note** : `lib/snapshot-config-display.ts` (58 l) **existe déjà** comme module séparé avec son test (`snapshot-config-display.test.ts`). Il gère déjà le formatage/labels. Ne pas le recréer dans ce dossier — il reste à sa place actuelle.

## 🛠️ Étapes

1. **Cartographier les exports** de `snapshot-config-diff.ts` et leurs usages (grep des imports `from '../lib/snapshot-config-diff'` / `from '../snapshot-config-diff'`).
2. **Créer `specs.ts`** : déplacer types (`SnapshotConfigMode`, `ConfigDiffGroup`, `ConfigDiffFieldSpec`...), labels (`GROUP_LABELS`, `SIZING_MODE_LABELS`, `CRYPTO_ALGO_LABELS`), formatters/normalizers et les 3 builders (`buildSimFieldSpecs`, `buildRealFieldSpecs`, `buildCryptoAlgoFieldSpecs`) + `SPECS_BY_MODE`.
3. **Créer `diff.ts`** : déplacer `buildSnapshotConfigDiff`, `buildConfigDiffPreviewLines`, `groupConfigDiffPreviewLines`, et les types de sortie (`ConfigDiffRow`, `ConfigDiffPreviewLine`). Il importe `specs` et `sim-snapshot-compare`.
4. **Créer `index.ts`** qui re-exporte tout — les imports existants ne changent PAS (pattern baril déjà utilisé pour `api.ts`).
5. **Adapter le test** `snapshot-config-diff.test.ts` si ses imports profonds doivent changer, sinon le laisser.

## ⚠️ Risques

- **Risque faible** : lib pure, pas d'effet de bord, pas de dépendance circulaire à créer.
- Ne pas toucher au baril `api.ts` (sans rapport).

## ✅ Vérification

- `npx tsc --noEmit` (0 erreur)
- `npm run test` — dont `snapshot-config-diff.test.ts` et `snapshot-config-display.test.ts` (présents dans les 167 tests)
- `npm run lint` (0 warning)
- `npm run build` OK

## 📌 Note

Quick win recommandé en premier (effort faible, risque faible). Voir §5 du rapport.

# Hub Rapports d'analyse

Page **Rapports** (`ReportsPage`) : génération, historique, comparaison et application
de recommandations pour le **Crypto Algo en simulation** (`mode=sim`,
`reason=ALGO_OPEN`). Distinct des **snapshots simulation** (photo globale sim) — voir
[`snapshots-simulation.md`](./snapshots-simulation.md).

## Périmètre v1 (Phase 0)

| Inclus | Exclu |
|--------|--------|
| Positions `ALGO_OPEN` sim | Copy trading (`COPY_OPEN`, …) |
| Agrégats perf, surveillance, leviers | Mode réel |
| Tunables `crypto_algo_*` (config live au moment T) | Patch copy (`sim_sl_*`, …) |
| Recommandations auto-applicables | Estimation contrefactuelle $ |

Le **cash sim** affiché est le solde **global** du ledger (`simulation_balances`) —
contexte uniquement, pas le PnL algo isolé.

## UI

| Entrée | Comportement |
|--------|----------------|
| Système → Rapports | Hub complet : bibliothèque, éditeur, viewer, comparaison |
| Crypto Algo → **Rapport** | Dialog preview live (non persisté) |
| Crypto Algo → **Hub** | Ouvre la page Rapports |

### Page Rapports

- **Générer** : type `crypto_algo_optimize`, filtres optionnels `closedFrom` / `closedTo`
  (dates de fermeture), note libre → **enregistrement automatique** (3B).
- **Bibliothèque** : liste des rapports (label, scope, PnL, fingerprint).
- **Comparer** : sélectionner deux rapports (A/B) → tableau Δ métriques (snapshots figés).
- **Appliquer recommandations** : garde **fingerprint** config (voir ci-dessous).

Rétention : **50 rapports max** et **90 jours** (`AnalysisReportService.enforceRetention`).

## API REST

Montées sous `/api/reports` (`createReportsRouter`).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/reports` | Liste paginée `{ items, total }` |
| GET | `/api/reports/:id` | Détail `{ …summary, payload }` |
| POST | `/api/reports/generate` | Génère + enregistre (201) |
| GET | `/api/reports/compare?a=&b=` | Comparaison deux snapshots |
| PATCH | `/api/reports/:id` | Met à jour `{ label?, note? }` |
| DELETE | `/api/reports/:id` | Supprime (204) |

Preview live (non persistée) :

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/algo/optimize-report?closedFrom=&closedTo=` | Rapport à la volée + `configFingerprint` |

### Corps `POST /api/reports/generate`

```json
{
  "type": "crypto_algo_optimize",
  "label": "optionnel",
  "note": "optionnel",
  "params": {
    "closedFrom": "2026-07-01T00:00:00.000Z",
    "closedTo": "2026-07-10T23:59:59.999Z"
  }
}
```

## Config fingerprint & journal

### Fingerprint (`cryptoAlgoConfigFingerprint`)

Hash SHA-256 (16 hex) des champs `crypto_algo_*` impactant entrées/sorties
(`computeCryptoAlgoConfigFingerprint` dans `@polywatch/core`).

- Exposé sur `GET /api/config/crypto` et chaque rapport enregistré.
- **Apply recommandations** (dialog ou hub) envoie `expectedCryptoAlgoConfigFingerprint`
  dans `PUT /api/config/crypto` → **409** `config_fingerprint_mismatch` si la config live
  a changé depuis la génération.

Champs optionnels acceptés par `PUT /api/config/crypto` (hors schéma strict) :

- `expectedCryptoAlgoConfigFingerprint` : garde apply
- `revisionSource` : `api` | `report_apply` | `system`

### Table `risk_config_revisions`

Append-only à **chaque** `PUT /api/config/crypto` : `config_json` (API présentée),
`patch_json`, `config_fingerprint`, `source`, `created_at`.

Migration : `AddAnalysisReportsAndRiskConfigRevisions1700000000047`.

## Table `analysis_reports`

| Colonne | Rôle |
|---------|------|
| `type` | `crypto_algo_optimize` (extensible) |
| `params_json` | `{ mode, reason, closedFrom?, closedTo? }` |
| `payload_json` | Sortie `buildCryptoAlgoOptimizeReport()` figée |
| `config_fingerprint` | Fingerprint au moment T |
| `scope_summary` | Résumé lisible (périmètre + counts) |
| `positions_closed_count` / `positions_total_count` | Index liste |

## Builder core

- `loadCryptoAlgoOptimizeReport(ds, filters?)` — agrégation SQL + builder pur
- `buildCryptoAlgoOptimizeReport()` — verdict, leviers, recommandations
- `buildRecommendedCryptoAlgoConfig()` — patch `crypto_algo_*` conservateur
- `compareCryptoAlgoOptimizeReports(a, b)` — Δ PnL, win rate, SL, whipsaw, fingerprint

Filtre période : les positions **fermées** sont bornées par `closed_at` ; les positions
**non fermées** (open, cancelled, …) restent incluses dans les totaux — documenter
explicitement lors de l’interprétation d’une fenêtre temporelle.

## Distinction vs snapshots simulation

| | Snapshots sim | Rapports analyse |
|--|---------------|------------------|
| Question | État portefeuille sim à T ? | Comment optimiser / diagnostiquer l’algo ? |
| Donnée | JSON positions/execs/traders | Agrégats + leviers + reco |
| Périmètre | Sim globale | Typé (`ALGO_OPEN`, …) |
| Comparaison | Equity, cash, config copy | Δ métriques algo + fingerprint |

Lien futur possible : préremplir les dates du rapport depuis une session / une paire
de snapshots (non implémenté en v1).

## Phases roadmap (non livrées)

1. Comparatif temporel lié aux révisions `risk_config`
2. Rapport santé exécution (focus `exit_attempt_events`)
3. What-if non monétaire
4. Multi-périmètre (copy / sim global)
5. Readiness sim → réel

## Fichiers principaux

| Zone | Fichiers |
|------|----------|
| Core | `packages/core/src/crypto-algo/load-optimize-report-data.ts`, `optimize-report.ts`, `compare-reports.ts`, `config-fingerprint.ts`, `services/analysis-report.service.ts`, `services/risk-config-revision.service.ts` |
| Backend | `packages/backend/src/routes/reports.ts`, `routes/algo-optimize-report.ts`, `routes/config.ts` |
| Frontend | `ReportsPage.tsx`, `CryptoAlgoReportViewer.tsx`, `CryptoAlgoOptimizeReportDialog.tsx`, `lib/analysis-reports.ts` |
